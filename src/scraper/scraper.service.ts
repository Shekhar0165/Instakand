import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrowserService } from '../core/browser/browser.service';
import { ProxyService } from '../core/proxy/proxy.service';
import { RateLimiterService } from '../core/rate-limiter/rate-limiter.service';
import { AuthService } from '../core/auth/auth.service';
import { DataService } from '../data/data.service';
import { ProfileStrategy } from './strategies/profile.strategy';
import { HashtagStrategy } from './strategies/hashtag.strategy';
import { PostStrategy } from './strategies/post.strategy';
import { CommentStrategy } from './strategies/comment.strategy';
import { ReelStrategy } from './strategies/reel.strategy';
import {
    ScrapeJob,
    ProfileData,
    PostData,
    CommentData,
    ReelData,
    HashtagData,
} from '../common/interfaces';
import { generateJobId } from '../common/utils';

@Injectable()
export class ScraperService {
    private readonly logger = new Logger(ScraperService.name);

    constructor(
        private readonly configService: ConfigService,
        private readonly browserService: BrowserService,
        private readonly proxyService: ProxyService,
        private readonly rateLimiter: RateLimiterService,
        private readonly authService: AuthService,
        private readonly dataService: DataService,
        private readonly profileStrategy: ProfileStrategy,
        private readonly hashtagStrategy: HashtagStrategy,
        private readonly postStrategy: PostStrategy,
        private readonly commentStrategy: CommentStrategy,
        private readonly reelStrategy: ReelStrategy,
    ) { }

    /**
     * Scrape a user profile
     */
    async scrapeProfile(
        username: string,
        includePosts: boolean = true,
        postsLimit: number = 12,
    ): Promise<{ job: ScrapeJob; profile: ProfileData | null; posts: PostData[] }> {
        const jobId = generateJobId();
        const job = this.dataService.createJob({
            id: jobId,
            type: 'profile',
            status: 'processing',
            input: { username, limit: postsLimit },
            progress: 0,
            totalItems: includePosts ? postsLimit + 1 : 1, // +1 for profile
            scrapedItems: 0,
            createdAt: new Date(),
            startedAt: new Date(),
        });

        const contextId = `profile_${jobId}`;
        let profile: ProfileData | null = null;
        const posts: PostData[] = [];

        try {
            // Rate limit
            await this.rateLimiter.acquireToken();

            // Create browser context
            const proxy = this.proxyService.getNextProxy();
            await this.browserService.createContext(contextId, proxy);
            const page = await this.browserService.createPage(contextId);

            // Scrape profile
            profile = await this.profileStrategy.scrapeProfile(page, username);
            this.dataService.updateJob(jobId, { scrapedItems: 1, progress: 10 });

            if (profile && includePosts && !profile.isPrivate) {
                // Scrape posts
                await this.rateLimiter.acquireToken();
                const profilePosts = await this.profileStrategy.scrapeProfilePosts(
                    page,
                    username,
                    postsLimit,
                );
                posts.push(...profilePosts);
                this.dataService.updateJob(jobId, {
                    scrapedItems: 1 + posts.length,
                    progress: 100,
                });
            }

            // Mark success
            this.rateLimiter.reportSuccess();
            if (proxy) this.proxyService.markProxySuccess(proxy);


            this.dataService.updateJob(jobId, {
                status: 'completed',
                completedAt: new Date(),
            });

            this.logger.log(`Profile scrape completed: ${username}`);

        } catch (error) {
            this.logger.error(`Profile scrape failed: ${error.message}`);
            this.rateLimiter.reportWarning();
            this.dataService.updateJob(jobId, {
                status: 'failed',
                error: error.message,
                completedAt: new Date(),
            });
        } finally {
            await this.browserService.closeContext(contextId);
        }

        return { job: this.dataService.getJob(jobId)!, profile, posts };
    }

    /**
     * Scrape posts from a hashtag
     */
    async scrapeHashtag(
        hashtag: string,
        limit: number = 50,
        page: number = 1,
    ): Promise<{ job: ScrapeJob; hashtagData: HashtagData | null; posts: PostData[] }> {
        const jobId = generateJobId();
        const offset = (page - 1) * limit;
        const totalToScrape = offset + limit;

        const job = this.dataService.createJob({
            id: jobId,
            type: 'hashtag',
            status: 'processing',
            input: { hashtag, limit, page },
            progress: 0,
            totalItems: limit,
            scrapedItems: 0,
            createdAt: new Date(),
            startedAt: new Date(),
        });

        const contextId = `hashtag_${jobId}`;
        let hashtagData: HashtagData | null = null;
        let posts: PostData[] = [];

        try {
            await this.rateLimiter.acquireToken();

            const proxy = this.proxyService.getNextProxy();
            await this.browserService.createContext(contextId, proxy);
            const page = await this.browserService.createPage(contextId);

            const result = await this.hashtagStrategy.scrapeHashtag(page, hashtag, totalToScrape);
            hashtagData = result.hashtagData;
            posts = result.posts.slice(offset, offset + limit);

            this.rateLimiter.reportSuccess();
            if (proxy) this.proxyService.markProxySuccess(proxy);


            this.dataService.updateJob(jobId, {
                status: 'completed',
                scrapedItems: posts.length,
                progress: 100,
                completedAt: new Date(),
            });

            this.logger.log(`Hashtag scrape completed: #${hashtag} (${posts.length} posts)`);

        } catch (error) {
            this.logger.error(`Hashtag scrape failed: ${error.message}`);
            this.rateLimiter.reportWarning();
            this.dataService.updateJob(jobId, {
                status: 'failed',
                error: error.message,
                completedAt: new Date(),
            });
        } finally {
            await this.browserService.closeContext(contextId);
        }

        return { job: this.dataService.getJob(jobId)!, hashtagData, posts };
    }

    /**
     * Scrape a single post
     */
    async scrapePost(
        postUrl: string,
        includeComments: boolean = false,
        commentsLimit: number = 20,
    ): Promise<{ job: ScrapeJob; post: PostData | null; comments: CommentData[] }> {
        const jobId = generateJobId();
        const job = this.dataService.createJob({
            id: jobId,
            type: 'post',
            status: 'processing',
            input: { postUrl, includeComments, commentsLimit },
            progress: 0,
            totalItems: includeComments ? 2 : 1,
            scrapedItems: 0,
            createdAt: new Date(),
            startedAt: new Date(),
        });

        const contextId = `post_${jobId}`;
        let post: PostData | null = null;
        const comments: CommentData[] = [];

        try {
            await this.rateLimiter.acquireToken();

            const proxy = this.proxyService.getNextProxy();
            await this.browserService.createContext(contextId, proxy);
            const page = await this.browserService.createPage(contextId);

            post = await this.postStrategy.scrapePost(page, postUrl);
            this.dataService.updateJob(jobId, { scrapedItems: 1, progress: 50 });

            if (post && includeComments) {
                await this.rateLimiter.acquireToken();
                const postComments = await this.commentStrategy.scrapeComments(
                    page,
                    postUrl,
                    commentsLimit,
                );
                comments.push(...postComments);
            }

            this.rateLimiter.reportSuccess();
            if (proxy) this.proxyService.markProxySuccess(proxy);


            this.dataService.updateJob(jobId, {
                status: 'completed',
                scrapedItems: 1 + comments.length,
                progress: 100,
                completedAt: new Date(),
            });

            this.logger.log(`Post scrape completed: ${postUrl}`);

        } catch (error) {
            this.logger.error(`Post scrape failed: ${error.message}`);
            this.rateLimiter.reportWarning();
            this.dataService.updateJob(jobId, {
                status: 'failed',
                error: error.message,
                completedAt: new Date(),
            });
        } finally {
            await this.browserService.closeContext(contextId);
        }

        return { job: this.dataService.getJob(jobId)!, post, comments };
    }

    /**
     * Scrape comments from a post
     */
    async scrapeComments(
        postUrl: string,
        limit: number = 50,
    ): Promise<{ job: ScrapeJob; comments: CommentData[] }> {
        const jobId = generateJobId();
        const job = this.dataService.createJob({
            id: jobId,
            type: 'comments',
            status: 'processing',
            input: { postUrl, commentsLimit: limit },
            progress: 0,
            totalItems: limit,
            scrapedItems: 0,
            createdAt: new Date(),
            startedAt: new Date(),
        });

        const contextId = `comments_${jobId}`;
        let comments: CommentData[] = [];

        try {
            await this.rateLimiter.acquireToken();

            const proxy = this.proxyService.getNextProxy();
            await this.browserService.createContext(contextId, proxy);
            const page = await this.browserService.createPage(contextId);

            comments = await this.commentStrategy.scrapeComments(page, postUrl, limit);

            this.rateLimiter.reportSuccess();
            if (proxy) this.proxyService.markProxySuccess(proxy);


            this.dataService.updateJob(jobId, {
                status: 'completed',
                scrapedItems: comments.length,
                progress: 100,
                completedAt: new Date(),
            });

            this.logger.log(`Comments scrape completed: ${postUrl} (${comments.length} comments)`);

        } catch (error) {
            this.logger.error(`Comments scrape failed: ${error.message}`);
            this.rateLimiter.reportWarning();
            this.dataService.updateJob(jobId, {
                status: 'failed',
                error: error.message,
                completedAt: new Date(),
            });
        } finally {
            await this.browserService.closeContext(contextId);
        }

        return { job: this.dataService.getJob(jobId)!, comments };
    }

    /**
     * Scrape reels from a profile
     */
    async scrapeReels(
        username: string,
        limit: number = 12,
        includeDetails: boolean = false,
    ): Promise<{ job: ScrapeJob; reels: ReelData[] }> {
        const jobId = generateJobId();
        const job = this.dataService.createJob({
            id: jobId,
            type: 'reels',
            status: 'processing',
            input: { username, limit },
            progress: 0,
            totalItems: limit,
            scrapedItems: 0,
            createdAt: new Date(),
            startedAt: new Date(),
        });

        const contextId = `reels_${jobId}`;
        let reels: ReelData[] = [];

        try {
            await this.rateLimiter.acquireToken();

            const proxy = this.proxyService.getNextProxy();
            await this.browserService.createContext(contextId, proxy);
            const page = await this.browserService.createPage(contextId);

            reels = await this.reelStrategy.scrapeProfileReels(page, username, limit);

            // Optionally scrape details for each reel
            if (includeDetails && reels.length > 0) {
                for (let i = 0; i < reels.length; i++) {
                    await this.rateLimiter.acquireToken();
                    const details = await this.reelStrategy.scrapeReelDetails(page, reels[i].shortcode);
                    if (details) {
                        reels[i] = details;
                    }
                    this.dataService.updateJob(jobId, {
                        scrapedItems: i + 1,
                        progress: Math.round(((i + 1) / reels.length) * 100),
                    });
                }
            }

            this.rateLimiter.reportSuccess();
            if (proxy) this.proxyService.markProxySuccess(proxy);


            this.dataService.updateJob(jobId, {
                status: 'completed',
                scrapedItems: reels.length,
                progress: 100,
                completedAt: new Date(),
            });

            this.logger.log(`Reels scrape completed: ${username} (${reels.length} reels)`);

        } catch (error) {
            this.logger.error(`Reels scrape failed: ${error.message}`);
            this.rateLimiter.reportWarning();
            this.dataService.updateJob(jobId, {
                status: 'failed',
                error: error.message,
                completedAt: new Date(),
            });
        } finally {
            await this.browserService.closeContext(contextId);
        }

        return { job: this.dataService.getJob(jobId)!, reels };
    }

    /**
     * Scrape posts from a location
     */

    /**
     * Search posts by caption/keyword across all Instagram
     * Searches globally in posts and reels using hashtags and explore feed
     */
    async searchPostsByCaption(
        keyword: string,
        searchLimit: number = 100,
        resultLimit: number = 50,
    ): Promise<{ job: ScrapeJob; posts: PostData[] }> {
        const jobId = generateJobId();
        const job = this.dataService.createJob({
            id: jobId,
            type: 'search',
            status: 'processing',
            input: { keyword, searchLimit, resultLimit },
            progress: 0,
            totalItems: resultLimit,
            scrapedItems: 0,
            createdAt: new Date(),
            startedAt: new Date(),
        });

        const contextId = `search_${jobId}`;
        const matchingPosts: PostData[] = [];
        const seenShortcodes = new Set<string>();

        // Prepare search terms - extract hashtags and regular keywords
        const searchTerms = keyword.toLowerCase().split(/\s+/).map(kw => kw.replace(/^#/, ''));

        try {
            await this.rateLimiter.acquireToken();

            const proxy = this.proxyService.getNextProxy();
            await this.browserService.createContext(contextId, proxy);
            const page = await this.browserService.createPage(contextId);

            // Try to authenticate if credentials are available
            if (this.authService.hasCredentials()) {
                const loggedIn = await this.authService.ensureLoggedIn(page);
                if (loggedIn) {
                    this.logger.log('Searching with authenticated session');
                } else {
                    this.logger.warn('Authentication failed, searching without login');
                }
            }

            this.logger.log(`Global search for "${keyword}" across Instagram posts and reels`);

            // Strategy 1: Search via hashtags (most effective for public content)
            // Convert keywords to hashtags for searching
            for (const term of searchTerms) {
                if (matchingPosts.length >= resultLimit) break;

                this.logger.debug(`Searching hashtag: #${term}`);
                await this.rateLimiter.acquireToken();

                try {
                    const hashtagResult = await this.hashtagStrategy.scrapeHashtag(
                        page,
                        term,
                        Math.ceil(searchLimit / searchTerms.length),
                    );

                    for (const post of hashtagResult.posts) {
                        if (matchingPosts.length >= resultLimit) break;
                        if (seenShortcodes.has(post.shortcode)) continue;

                        seenShortcodes.add(post.shortcode);
                        matchingPosts.push(post);
                    }

                    this.dataService.updateJob(jobId, {
                        scrapedItems: matchingPosts.length,
                        progress: Math.round((matchingPosts.length / resultLimit) * 50),
                    });
                } catch (hashtagError) {
                    this.logger.debug(`Hashtag search for #${term} failed: ${hashtagError.message}`);
                }
            }

            // Strategy 2: Search via Instagram's explore/search API
            if (matchingPosts.length < resultLimit) {
                this.logger.debug('Attempting explore/search API');
                await this.rateLimiter.acquireToken();

                try {
                    // Try to search via Instagram's web search
                    const explorePosts = await this.searchViaExplore(page, keyword, searchLimit);

                    for (const post of explorePosts) {
                        if (matchingPosts.length >= resultLimit) break;
                        if (seenShortcodes.has(post.shortcode)) continue;

                        // Filter by keyword match in caption or hashtags
                        const captionLower = post.caption?.toLowerCase() || '';
                        const postHashtags = post.hashtags.map(h => h.toLowerCase());

                        const matches = searchTerms.some(term =>
                            captionLower.includes(term) || postHashtags.some(h => h.includes(term))
                        );

                        if (matches) {
                            seenShortcodes.add(post.shortcode);
                            matchingPosts.push(post);
                        }
                    }
                } catch (exploreError) {
                    this.logger.debug(`Explore search failed: ${exploreError.message}`);
                }
            }

            // Strategy 3: Get trending/recent reels if still need more
            if (matchingPosts.length < resultLimit) {
                this.logger.debug('Searching in reels via explore');
                await this.rateLimiter.acquireToken();

                try {
                    const reelPosts = await this.searchReelsViaExplore(page, keyword, searchLimit);

                    for (const post of reelPosts) {
                        if (matchingPosts.length >= resultLimit) break;
                        if (seenShortcodes.has(post.shortcode)) continue;

                        seenShortcodes.add(post.shortcode);
                        matchingPosts.push(post);
                    }
                } catch (reelError) {
                    this.logger.debug(`Reel search failed: ${reelError.message}`);
                }
            }

            this.rateLimiter.reportSuccess();
            if (proxy) this.proxyService.markProxySuccess(proxy);


            this.dataService.updateJob(jobId, {
                status: 'completed',
                scrapedItems: matchingPosts.length,
                progress: 100,
                completedAt: new Date(),
            });

            this.logger.log(`Global search completed: Found ${matchingPosts.length} posts/reels matching "${keyword}"`);

        } catch (error) {
            this.logger.error(`Search failed: ${error.message}`);
            this.rateLimiter.reportWarning();
            this.dataService.updateJob(jobId, {
                status: 'failed',
                error: error.message,
                completedAt: new Date(),
            });
        } finally {
            await this.browserService.closeContext(contextId);
        }

        return { job: this.dataService.getJob(jobId)!, posts: matchingPosts };
    }

    /**
     * Search via Instagram's explore/search page
     */
    private async searchViaExplore(
        page: any,
        keyword: string,
        limit: number,
    ): Promise<PostData[]> {
        const posts: PostData[] = [];

        try {
            // Navigate to explore page
            await page.goto('https://www.instagram.com/explore/', {
                waitUntil: 'networkidle',
                timeout: 30000
            });

            // Try to use the search functionality
            const searchButton = await page.$('[aria-label="Search"]');
            if (searchButton) {
                await searchButton.click();
                await page.waitForTimeout(1000);

                // Type the keyword
                await page.keyboard.type(keyword, { delay: 100 });
                await page.waitForTimeout(2000);

                // Extract posts from search results
                const postLinks = await page.$$eval('a[href*="/p/"], a[href*="/reel/"]', (links: any[]) =>
                    links.map(link => ({
                        href: link.getAttribute('href') || '',
                        img: link.querySelector('img')?.getAttribute('src') || '',
                        alt: link.querySelector('img')?.getAttribute('alt') || '',
                    }))
                );

                for (const link of postLinks) {
                    if (posts.length >= limit) break;

                    const shortcodeMatch = link.href.match(/\/(?:p|reel)\/([^/]+)/);
                    if (!shortcodeMatch) continue;

                    const shortcode = shortcodeMatch[1];
                    const isReel = link.href.includes('/reel/');

                    posts.push({
                        id: shortcode,
                        shortcode,
                        type: isReel ? 'reel' : 'image',
                        caption: link.alt,
                        likesCount: 0,
                        commentsCount: 0,
                        mediaUrl: link.img,
                        thumbnailUrl: link.img,
                        ownerUsername: '',
                        ownerId: '',
                        timestamp: new Date(),
                        hashtags: this.extractHashtagsFromText(link.alt),
                        mentions: this.extractMentionsFromText(link.alt),
                        isSponsored: false,
                        url: isReel ? `https://www.instagram.com/reel/${shortcode}/` : `https://www.instagram.com/p/${shortcode}/`,
                        scrapedAt: new Date(),
                    });
                }
            }
        } catch (error) {
            this.logger.debug(`Explore search error: ${error.message}`);
        }

        return posts;
    }

    /**
     * Search reels via Instagram's explore/reels page
     */
    private async searchReelsViaExplore(
        page: any,
        keyword: string,
        limit: number,
    ): Promise<PostData[]> {
        const posts: PostData[] = [];

        try {
            // Navigate to reels explore
            await page.goto('https://www.instagram.com/reels/', {
                waitUntil: 'networkidle',
                timeout: 30000
            });

            await page.waitForTimeout(2000);

            // Scroll to load more reels
            for (let i = 0; i < 3; i++) {
                await page.evaluate(() => window.scrollBy(0, 1000));
                await page.waitForTimeout(1500);
            }

            // Extract reel links
            const reelLinks = await page.$$eval('a[href*="/reel/"]', (links: any[]) =>
                links.map(link => ({
                    href: link.getAttribute('href') || '',
                    img: link.querySelector('img')?.getAttribute('src') || '',
                    alt: link.querySelector('img')?.getAttribute('alt') || '',
                }))
            );

            const searchTerms = keyword.toLowerCase().split(/\s+/).map(kw => kw.replace(/^#/, ''));

            for (const link of reelLinks) {
                if (posts.length >= limit) break;

                const shortcodeMatch = link.href.match(/\/reel\/([^/]+)/);
                if (!shortcodeMatch) continue;

                // Filter by keyword if we have caption/alt text
                const altLower = link.alt?.toLowerCase() || '';
                const matches = searchTerms.some(term => altLower.includes(term));

                if (matches || !link.alt) {
                    const shortcode = shortcodeMatch[1];

                    posts.push({
                        id: shortcode,
                        shortcode,
                        type: 'reel',
                        caption: link.alt,
                        likesCount: 0,
                        commentsCount: 0,
                        mediaUrl: link.img,
                        thumbnailUrl: link.img,
                        ownerUsername: '',
                        ownerId: '',
                        timestamp: new Date(),
                        hashtags: this.extractHashtagsFromText(link.alt),
                        mentions: this.extractMentionsFromText(link.alt),
                        isSponsored: false,
                        url: `https://www.instagram.com/reel/${shortcode}/`,
                        scrapedAt: new Date(),
                    });
                }
            }
        } catch (error) {
            this.logger.debug(`Reels explore error: ${error.message}`);
        }

        return posts;
    }

    /**
     * Extract hashtags from text
     */
    private extractHashtagsFromText(text: string): string[] {
        const matches = text?.match(/#[\w\u0080-\uFFFF]+/g) || [];
        return matches.map(tag => tag.slice(1).toLowerCase());
    }

    /**
     * Extract mentions from text
     */
    private extractMentionsFromText(text: string): string[] {
        const matches = text?.match(/@[\w.]+/g) || [];
        return matches.map(mention => mention.slice(1).toLowerCase());
    }

    /**
     * Scrape multiple direct URLs (profiles, posts, reels)
     */
    async scrapeDirectUrls(
        urls: string[],
        postsLimit: number = 12,
        includeComments: boolean = false,
    ): Promise<{ job: ScrapeJob; results: any[] }> {
        const jobId = generateJobId();
        const job = this.dataService.createJob({
            id: jobId,
            type: 'direct_urls',
            status: 'processing',
            input: { urls, postsLimit, includeComments },
            progress: 0,
            totalItems: urls.length,
            scrapedItems: 0,
            createdAt: new Date(),
            startedAt: new Date(),
        });

        const contextId = `urls_${jobId}`;
        const results: any[] = [];

        try {
            const proxy = this.proxyService.getNextProxy();
            await this.browserService.createContext(contextId, proxy);
            const page = await this.browserService.createPage(contextId);

            for (let i = 0; i < urls.length; i++) {
                const url = urls[i];
                await this.rateLimiter.acquireToken();

                try {
                    // Determine URL type and scrape accordingly
                    if (url.includes('/p/') || url.includes('/reel/')) {
                        // Post or Reel URL
                        const post = await this.postStrategy.scrapePost(page, url);
                        let comments: CommentData[] = [];

                        if (includeComments && post) {
                            comments = await this.commentStrategy.scrapeComments(page, url, 20);
                        }

                        results.push({ type: 'post', url, post, comments });
                    } else if (url.match(/instagram\.com\/[\w.]+\/?$/)) {
                        // Profile URL
                        const usernameMatch = url.match(/instagram\.com\/([\w.]+)/);
                        const username = usernameMatch?.[1];

                        if (username) {
                            const profile = await this.profileStrategy.scrapeProfile(page, username);
                            const posts = await this.profileStrategy.scrapeProfilePosts(page, username, postsLimit);
                            results.push({ type: 'profile', url, profile, posts });
                        }
                    } else if (url.includes('/explore/tags/')) {
                        // Hashtag URL
                        const hashtagMatch = url.match(/tags\/([^/]+)/);
                        const hashtag = hashtagMatch?.[1];

                        if (hashtag) {
                            const result = await this.hashtagStrategy.scrapeHashtag(page, hashtag, postsLimit);
                            results.push({ type: 'hashtag', url, hashtag: result.hashtagData, posts: result.posts });
                        }
                    } else {
                        results.push({ type: 'unknown', url, error: 'Unrecognized URL format' });
                    }

                    this.dataService.updateJob(jobId, {
                        scrapedItems: i + 1,
                        progress: Math.round(((i + 1) / urls.length) * 100),
                    });

                } catch (error) {
                    results.push({ type: 'error', url, error: error.message });
                }
            }

            this.rateLimiter.reportSuccess();
            if (proxy) this.proxyService.markProxySuccess(proxy);


            this.dataService.updateJob(jobId, {
                status: 'completed',
                scrapedItems: results.length,
                progress: 100,
                completedAt: new Date(),
            });

            this.logger.log(`Direct URLs scrape completed: ${results.length} URLs processed`);

        } catch (error) {
            this.logger.error(`Direct URLs scrape failed: ${error.message}`);
            this.rateLimiter.reportWarning();
            this.dataService.updateJob(jobId, {
                status: 'failed',
                error: error.message,
                completedAt: new Date(),
            });
        } finally {
            await this.browserService.closeContext(contextId);
        }

        return { job: this.dataService.getJob(jobId)!, results };
    }


    /**
     * Get system status
     */
    getSystemStatus() {
        return {
            rateLimiter: this.rateLimiter.getStatus(),
            proxy: this.proxyService.getStats(),
            jobs: this.dataService.getJobStats(),
            activeBrowsers: this.browserService.getActiveContextCount(),
        };
    }
}

