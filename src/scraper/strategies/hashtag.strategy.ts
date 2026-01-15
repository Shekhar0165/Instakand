import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Page, Response } from 'playwright';
import { PostData, HashtagData } from '../../common/interfaces';
import { humanDelay, randomDelay } from '../../common/utils';
import { AuthService } from '../auth.service';
import { RateLimiterService } from '../rate-limiter.service';

/**
 * Constants for Instagram's internal APIs
 * Note: These are fragile and can be changed by Instagram at any time.
 */
const INSTAGRAM_APP_ID = '936619743392459';
const HASHTAG_DOC_ID = '17875283437143507';
const HASHTAG_QUERY_HASH = '9b498c08113f1e09617a1703c22b2f32'; // May need updating!

@Injectable()
export class HashtagStrategy {
    private readonly logger = new Logger(HashtagStrategy.name);
    private readonly debugMode: boolean;

    constructor(
        private readonly configService: ConfigService,
        private readonly authService: AuthService,
        private readonly rateLimiter: RateLimiterService,
    ) {
        this.debugMode = this.configService.get<string>('DEBUG_SCREENSHOTS') === 'true';
    }

    /**
     * Main entry point for hashtag scraping with multiple fallback strategies
     */
    async scrapeHashtag(
        page: Page,
        hashtag: string,
        limit: number = 50,
    ): Promise<{ hashtagData: HashtagData | null; posts: PostData[] }> {
        const cleanHashtag = this.sanitizeHashtag(hashtag);
        this.logger.log(`Starting hashtag scrape: #${cleanHashtag} (limit: ${limit})`);

        await randomDelay(1000, 3000);

        // Strategy 1: Pagination-aware scraping (BEST with session cookie)
        this.logger.debug('Strategy 1: Pagination-Aware Scraping');
        const paginatedResult = await this.scrapeWithPagination(page, cleanHashtag, limit);
        if (paginatedResult.posts.length >= limit * 0.7) {
            this.logger.log(`✓ Strategy 1 succeeded: ${paginatedResult.posts.length} posts`);
            return paginatedResult;
        }

        // Strategy 2: Live Interception & Scrolling (fallback for logged-out)
        this.logger.debug('Strategy 2: Live Interception & Scrolling');
        const liveResult = await this.scrapeViaLiveInterception(page, cleanHashtag, limit);
        if (liveResult.posts.length > 0) {
            this.logger.log(`✓ Strategy 2 succeeded: ${liveResult.posts.length} posts`);
            return liveResult;
        }

        // Strategy 3: doc_id GraphQL
        this.logger.debug('Strategy 3: doc_id GraphQL');
        const docIdResult = await this.scrapeViaDocIdGraphQL(page, cleanHashtag, limit);
        if (docIdResult.posts.length > 0) {
            this.logger.log(`✓ Strategy 3 succeeded: ${docIdResult.posts.length} posts`);
            return docIdResult;
        }

        // Strategy 4: Web Info API
        this.logger.debug('Strategy 4: Web Info API');
        const webInfoResult = await this.scrapeViaWebInfoEndpoint(page, cleanHashtag, limit);
        if (webInfoResult.posts.length > 0) {
            this.logger.log(`✓ Strategy 4 succeeded: ${webInfoResult.posts.length} posts`);
            return webInfoResult;
        }

        this.logger.warn(`❌ No posts found for #${cleanHashtag} using any strategy.`);
        return { hashtagData: null, posts: [] };
    }

    /**
     * Setup Instagram session with proper headers and optional session cookie
     */
    private async setupInstagramSession(page: Page): Promise<boolean> {
        let isAuthenticated = false;

        try {
            // Set proper headers to avoid detection
            await page.setExtraHTTPHeaders({
                'accept': '*/*',
                'accept-language': 'en-US,en;q=0.9',
                'accept-encoding': 'gzip, deflate, br',
                'referer': 'https://www.instagram.com/',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'x-asbd-id': '129477',
                'x-ig-app-id': INSTAGRAM_APP_ID,
                'x-ig-www-claim': '0',
                'x-requested-with': 'XMLHttpRequest',
            });

            // Inject session cookie if available (from config or auto-login)
            let sessionId = this.configService.get<string>('instagram.sessionId');

            // If no session in config, try to get one from AuthService
            if (!sessionId || !sessionId.trim()) {
                sessionId = await this.authService.getSessionId() || '';
            }

            if (sessionId && sessionId.trim()) {
                await page.context().addCookies([
                    {
                        name: 'sessionid',
                        value: sessionId.trim(),
                        domain: '.instagram.com',
                        path: '/',
                        httpOnly: true,
                        secure: true,
                        sameSite: 'None' as const,
                    },
                    {
                        name: 'ds_user_id',
                        value: 'authenticated',
                        domain: '.instagram.com',
                        path: '/',
                        secure: true,
                        sameSite: 'None' as const,
                    }
                ]);
                this.logger.log('✓ Using authenticated session (sessionid cookie set)');
                isAuthenticated = true;
            } else {
                this.logger.debug('No session ID available, using unauthenticated mode');
            }
        } catch (error) {
            this.logger.warn(`Failed to setup session: ${error.message}`);
        }

        return isAuthenticated;
    }

    /**
     * Strategy 1: Pagination-aware scraping
     * Uses Instagram's pagination API to fetch multiple pages of posts
     */
    private async scrapeWithPagination(
        page: Page,
        hashtag: string,
        limit: number
    ): Promise<{ hashtagData: HashtagData | null; posts: PostData[] }> {
        const posts: PostData[] = [];
        let endCursor: string | null = null;
        let hasNextPage = true;
        let pageCount = 0;
        const MAX_PAGES = Math.ceil(limit / 50) + 3; // Safety limit

        try {
            // Setup session with proper headers BEFORE navigation
            await this.setupInstagramSession(page);

            // Initial navigation
            const url = `https://www.instagram.com/explore/tags/${hashtag}/`;
            this.logger.debug(`Navigating to: ${url}`);

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await humanDelay('navigate');

            // Extract initial posts from HTML
            const initialHtml = await page.content();
            this.extractFromHtml(initialHtml, posts, limit);

            // Try to find initial pagination info
            const initialPageInfo = await this.extractPageInfoFromDOM(page);
            if (initialPageInfo) {
                endCursor = initialPageInfo.endCursor;
                hasNextPage = initialPageInfo.hasNextPage;
            }

            this.logger.log(`📄 Initial load: ${posts.length} posts, hasNextPage: ${hasNextPage}`);

            // Pagination loop
            while (posts.length < limit && hasNextPage && pageCount < MAX_PAGES) {
                pageCount++;

                this.logger.debug(`📡 Fetching page ${pageCount} (cursor: ${endCursor?.substring(0, 20)}...)`);

                // Try query_hash method first
                let paginationResult = await this.fetchNextPageViaQueryHash(
                    page,
                    hashtag,
                    endCursor,
                    Math.min(50, limit - posts.length)
                );

                // Fallback to doc_id method
                if (!paginationResult || paginationResult.edges.length === 0) {
                    this.logger.debug('Query hash failed, trying doc_id...');
                    paginationResult = await this.fetchNextPageViaDocId(
                        page,
                        hashtag,
                        endCursor,
                        Math.min(50, limit - posts.length)
                    );
                }

                if (!paginationResult || paginationResult.edges.length === 0) {
                    this.logger.debug('No more posts available via pagination');
                    break;
                }

                // Process posts from this page
                let addedInThisPage = 0;
                for (const edge of paginationResult.edges) {
                    if (posts.length >= limit) break;

                    const post = this.parseGraphQLPost(edge);
                    if (post && !posts.some(p => p.shortcode === post.shortcode)) {
                        posts.push(post);
                        addedInThisPage++;
                    }
                }

                // Update pagination state
                hasNextPage = paginationResult.pageInfo?.has_next_page || false;
                endCursor = paginationResult.pageInfo?.end_cursor || null;

                this.logger.log(`✓ Page ${pageCount}: +${addedInThisPage} posts (total: ${posts.length}/${limit})`);

                // Use rate limiter for intelligent anti-ban delays
                this.rateLimiter.reportSuccess();
                await this.rateLimiter.waitBeforeRequest();

                if (!hasNextPage || !endCursor) {
                    this.logger.debug('Reached end of available posts');
                    break;
                }
            }

        } catch (error) {
            this.logger.error(`Pagination scraping failed: ${error.message}`);
        }

        // If pagination failed completely (only got initial posts), try scroll fallback
        if (posts.length < limit && posts.length <= 15) {
            this.logger.warn('Pagination blocked, trying scroll fallback...');
            const scrolledPosts = await this.scrollFallback(page, posts, limit);
            return { hashtagData: null, posts: scrolledPosts };
        }

        return {
            hashtagData: null,
            posts: posts.slice(0, limit)
        };
    }

    /**
     * Scrolling fallback when pagination fails (for logged-out users)
     */
    private async scrollFallback(page: Page, existingPosts: PostData[], limit: number): Promise<PostData[]> {
        const posts = [...existingPosts];
        let scrollCount = 0;
        const maxScrolls = Math.ceil((limit - posts.length) / 5) + 10;
        let noNewPostsCount = 0;

        this.logger.log('Starting scroll fallback to reach target...');

        while (posts.length < limit && scrollCount < maxScrolls) {
            this.logger.debug(`Scrolling ${scrollCount + 1}... (${posts.length}/${limit})`);

            // Scroll smoothly
            await page.evaluate(async () => {
                const scrollHeight = document.body.scrollHeight;
                const currentScroll = window.scrollY;
                const targetScroll = Math.min(currentScroll + 800, scrollHeight);
                window.scrollTo({ top: targetScroll, behavior: 'smooth' });
            });

            // Wait for content to load
            await randomDelay(3000, 5000);

            // Try to extract more posts
            const currentHtml = await page.content();
            const beforeCount = posts.length;
            this.extractFromHtml(currentHtml, posts, limit);
            const newPostsFound = posts.length - beforeCount;

            if (newPostsFound > 0) {
                this.logger.debug(`Found ${newPostsFound} new posts via scrolling`);
                noNewPostsCount = 0;
            } else {
                noNewPostsCount++;
            }

            // Stop if no new posts for 5 scrolls
            if (noNewPostsCount >= 5) {
                this.logger.debug('No new posts after 5 scrolls, stopping scroll fallback');
                break;
            }

            scrollCount++;
        }

        this.logger.log(`Scroll fallback complete: ${posts.length} total posts`);
        return posts.slice(0, limit);
    }

    /**
     * Fetch next page using query_hash method
     */
    private async fetchNextPageViaQueryHash(
        page: Page,
        hashtag: string,
        cursor: string | null,
        count: number
    ): Promise<{ edges: any[], pageInfo: any } | null> {
        try {
            const variables = {
                tag_name: hashtag,
                first: count,
                after: cursor
            };

            const response = await page.evaluate(async ({ queryHash, vars, appId }) => {
                const url = `https://www.instagram.com/graphql/query/?` +
                    `query_hash=${queryHash}&` +
                    `variables=${encodeURIComponent(JSON.stringify(vars))}`;

                const res = await fetch(url, {
                    headers: {
                        'x-requested-with': 'XMLHttpRequest',
                        'x-ig-app-id': appId,
                        'user-agent': navigator.userAgent
                    },
                    credentials: 'include'
                });

                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
                }

                return res.json();
            }, {
                queryHash: HASHTAG_QUERY_HASH,
                vars: variables,
                appId: INSTAGRAM_APP_ID
            });

            const tagData = response?.data?.hashtag;
            if (tagData?.edge_hashtag_to_media) {
                return {
                    edges: tagData.edge_hashtag_to_media.edges || [],
                    pageInfo: tagData.edge_hashtag_to_media.page_info || {}
                };
            }

            return null;
        } catch (error) {
            this.logger.debug(`Query hash pagination failed: ${error.message}`);
            return null;
        }
    }

    /**
     * Fetch next page using doc_id method (fallback)
     */
    private async fetchNextPageViaDocId(
        page: Page,
        hashtag: string,
        cursor: string | null,
        count: number
    ): Promise<{ edges: any[], pageInfo: any } | null> {
        try {
            const variables = {
                tag_name: hashtag,
                first: count,
                after: cursor
            };

            const response = await page.evaluate(async ({ doc_id, vars }) => {
                const res = await fetch('https://www.instagram.com/graphql/query', {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/x-www-form-urlencoded',
                        'x-requested-with': 'XMLHttpRequest'
                    },
                    body: `doc_id=${doc_id}&variables=${JSON.stringify(vars)}`,
                    credentials: 'include'
                });

                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }

                return res.json();
            }, { doc_id: HASHTAG_DOC_ID, vars: variables });

            const tagData = response?.data?.hashtag;
            if (tagData?.edge_hashtag_to_media) {
                return {
                    edges: tagData.edge_hashtag_to_media.edges || [],
                    pageInfo: tagData.edge_hashtag_to_media.page_info || {}
                };
            }

            return null;
        } catch (error) {
            this.logger.debug(`Doc ID pagination failed: ${error.message}`);
            return null;
        }
    }

    /**
     * Extract pagination info from the initial page DOM
     */
    private async extractPageInfoFromDOM(page: Page): Promise<{ endCursor: string | null; hasNextPage: boolean } | null> {
        try {
            const pageInfo = await page.evaluate(() => {
                const scripts = document.querySelectorAll('script:not([src])');

                for (const script of scripts) {
                    const content = script.textContent || '';

                    // Look for page_info with end_cursor
                    const pageInfoMatch = content.match(/"page_info"\s*:\s*\{[^}]*"has_next_page"\s*:\s*(true|false)[^}]*"end_cursor"\s*:\s*"([^"]+)"/);
                    if (pageInfoMatch) {
                        return {
                            hasNextPage: pageInfoMatch[1] === 'true',
                            endCursor: pageInfoMatch[2]
                        };
                    }

                    // Alternative pattern
                    const altMatch = content.match(/"end_cursor"\s*:\s*"([^"]+)"[^}]*"has_next_page"\s*:\s*(true|false)/);
                    if (altMatch) {
                        return {
                            endCursor: altMatch[1],
                            hasNextPage: altMatch[2] === 'true'
                        };
                    }
                }

                return null;
            });

            if (pageInfo) {
                this.logger.debug(`Found initial cursor: ${pageInfo.endCursor?.substring(0, 20)}...`);
            }

            return pageInfo;
        } catch (error) {
            this.logger.debug(`Could not extract page info from DOM: ${error.message}`);
            return null;
        }
    }

    /**
     * Strategy 2: Live interception with scrolling
     */
    private async scrapeViaLiveInterception(page: Page, hashtag: string, limit: number) {
        let posts: PostData[] = [];
        let hashtagData: HashtagData | null = null;
        const capturedResponses: any[] = [];

        const responseHandler = async (response: Response) => {
            const url = response.url();
            if (url.includes('/graphql/query') || url.includes('tags/web_info') || url.includes('api/graphql')) {
                try {
                    const data = await response.json();
                    capturedResponses.push(data);
                    this.processCapturedResponses([data], posts, limit);
                } catch (e) {
                    // Ignore parsing errors
                }
            }
        };

        page.on('response', responseHandler);

        try {
            // Setup session with cookies if available
            await this.setupInstagramSession(page);

            const url = `https://www.instagram.com/explore/tags/${hashtag}/`;
            this.logger.debug(`Navigating to: ${url}`);

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await humanDelay('navigate');

            // Extract from initial HTML
            const pageSource = await page.content();
            this.extractFromHtml(pageSource, posts, limit);

            // Scrolling loop
            let scrollCount = 0;
            const maxScrolls = Math.max(25, Math.ceil(limit / 10) + 5);
            let lastPostCount = posts.length;
            let noNewPostsCount = 0;

            while (posts.length < limit && scrollCount < maxScrolls) {
                this.logger.debug(`Scrolling... (${posts.length}/${limit}, scroll ${scrollCount + 1})`);

                const scrollAmount = Math.floor(Math.random() * 500) + 800;
                await page.evaluate((amount) => window.scrollBy(0, amount), scrollAmount);
                await randomDelay(2000, 5000);

                const currentHtml = await page.content();
                this.extractFromHtml(currentHtml, posts, limit);

                if (posts.length === lastPostCount) {
                    noNewPostsCount++;
                } else {
                    noNewPostsCount = 0;
                    lastPostCount = posts.length;
                }

                if (noNewPostsCount >= 5) {
                    this.logger.debug('No new posts after 5 scrolls, stopping.');
                    break;
                }

                scrollCount++;
            }

        } catch (error) {
            this.logger.error(`Live interception failed: ${error.message}`);
        } finally {
            page.off('response', responseHandler);
        }

        this.processCapturedResponses(capturedResponses, posts, limit);
        this.logger.debug(`Live interception found ${posts.length} posts`);

        return { hashtagData, posts: posts.slice(0, limit) };
    }

    /**
     * Strategy 3: doc_id GraphQL (single request, no pagination)
     */
    private async scrapeViaDocIdGraphQL(page: Page, hashtag: string, limit: number) {
        const posts: PostData[] = [];
        try {
            const variables = { tag_name: hashtag, first: Math.min(limit, 50) };

            const response = await page.evaluate(async ({ doc_id, variables }) => {
                const res = await fetch('https://www.instagram.com/graphql/query', {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    body: `doc_id=${doc_id}&variables=${JSON.stringify(variables)}`,
                });
                return res.json();
            }, { doc_id: HASHTAG_DOC_ID, variables });

            const tagData = response?.data?.hashtag;
            if (tagData) {
                this.processCapturedResponses([response], posts, limit);
            }
        } catch (e) {
            this.logger.warn(`DocId GraphQL strategy failed: ${e.message}`);
        }
        return { hashtagData: null, posts };
    }

    /**
     * Strategy 4: Web Info API
     */
    private async scrapeViaWebInfoEndpoint(page: Page, hashtag: string, limit: number) {
        const posts: PostData[] = [];
        try {
            const url = `https://www.instagram.com/api/v1/tags/web_info/?tag_name=${hashtag}`;
            const response = await page.evaluate(async ({ apiUrl, appId }) => {
                const res = await fetch(apiUrl, { headers: { 'x-ig-app-id': appId } });
                if (!res.ok) throw new Error(`Web Info API request failed with status ${res.status}`);
                return res.json();
            }, { apiUrl: url, appId: INSTAGRAM_APP_ID });

            const data = response?.data || response;
            const tagData = data?.hashtag;
            if (tagData) {
                const sections = data?.recent?.sections || data?.top?.sections || [];
                for (const section of sections) {
                    const medias = section.layout_content?.fill_items || section.layout_content?.medias || [];
                    for (const item of medias) {
                        const media = item.media || item;
                        if (posts.length >= limit) break;
                        if (media.code && !posts.some(p => p.shortcode === media.code)) {
                            posts.push(this.mapMediaToPost(media));
                        }
                    }
                }
            }
        } catch (e) {
            this.logger.warn(`Web Info API strategy failed: ${e.message}`);
        }
        return { hashtagData: null, posts };
    }

    /**
     * Helper: Sanitize hashtag input
     */
    private sanitizeHashtag(hashtag: string): string {
        const sanitized = hashtag.replace(/^#/, '').toLowerCase().trim();
        if (!/^[a-z0-9_]+$/.test(sanitized)) {
            this.logger.error(`Invalid hashtag format: ${hashtag}`);
            throw new BadRequestException('Invalid hashtag format. Use only letters, numbers, and underscores.');
        }
        return sanitized;
    }

    /**
     * Helper: Process captured GraphQL responses
     */
    private processCapturedResponses(responses: any[], posts: PostData[], limit: number) {
        for (const data of responses) {
            if (posts.length >= limit) break;

            const tagData = data?.data?.hashtag ||
                data?.hashtag ||
                data?.graphql?.hashtag ||
                data?.data?.xig_logged_out_popular_search_media_info;

            if (tagData) {
                const edges = [
                    ...(tagData.edge_hashtag_to_media?.edges || []),
                    ...(tagData.edge_hashtag_to_top_posts?.edges || []),
                    ...(tagData.edges || []),
                ];
                for (const edge of edges) {
                    if (posts.length >= limit) break;
                    const post = this.parseGraphQLPost(edge);
                    if (post && !posts.some(p => p.shortcode === post.shortcode)) {
                        posts.push(post);
                    }
                }
            }
        }
    }

    /**
     * Helper: Extract posts from HTML content
     */
    private extractFromHtml(html: string, posts: PostData[], limit: number): void {
        const scPatterns = [
            /"shortcode"\s*:\s*"([^"]+)"/g,
            /"code"\s*:\s*"([^"]+)"/g
        ];

        for (const pattern of scPatterns) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
                const sc = match[1];
                if (sc && sc.length > 5 && sc.length < 20 && !posts.some(p => p.shortcode === sc)) {
                    if (posts.length >= limit) break;

                    const timestampMatch = html.match(new RegExp(`"${sc}"[^}]*?"taken_at(?:_timestamp)?"\\s*:\\s*(\\d+)`));
                    const timestamp = timestampMatch ? new Date(parseInt(timestampMatch[1]) * 1000) : new Date();

                    posts.push({
                        id: sc,
                        shortcode: sc,
                        url: `https://www.instagram.com/p/${sc}/`,
                        type: 'image',
                        caption: '',
                        likesCount: 0,
                        commentsCount: 0,
                        mediaUrl: '',
                        thumbnailUrl: '',
                        ownerUsername: '',
                        ownerId: '',
                        timestamp,
                        hashtags: [],
                        mentions: [],
                        isSponsored: false,
                        scrapedAt: new Date()
                    });
                }
            }
            if (posts.length >= limit) break;
        }
    }

    /**
     * Helper: Parse GraphQL post edge to PostData
     */
    private parseGraphQLPost(edge: any): PostData | null {
        try {
            const node = edge.node || edge;
            return {
                id: node.id || node.pk || node.shortcode || node.code,
                shortcode: node.shortcode || node.code,
                url: `https://www.instagram.com/p/${node.shortcode || node.code}/`,
                type: node.is_video || node.__typename?.includes('Video') ? 'video' :
                    (node.__typename === 'GraphSidecar' ? 'carousel' : 'image'),
                caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || node.caption?.text || '',
                likesCount: node.edge_liked_by?.count || node.edge_media_preview_like?.count || node.like_count || 0,
                commentsCount: node.edge_media_to_comment?.count || node.comment_count || 0,
                mediaUrl: node.display_url || node.display_uri || node.image_versions2?.candidates?.[0]?.url || '',
                thumbnailUrl: node.thumbnail_src || node.display_url || node.display_uri || '',
                ownerUsername: node.owner?.username || node.user?.username || '',
                ownerId: node.owner?.id || node.user?.pk || '',
                timestamp: node.taken_at_timestamp || node.taken_at ?
                    new Date((node.taken_at_timestamp || node.taken_at) * 1000) : new Date(),
                hashtags: [],
                mentions: [],
                isSponsored: false,
                scrapedAt: new Date(),
            };
        } catch (e) {
            this.logger.debug(`Failed to parse GraphQL post: ${e.message}`);
            return null;
        }
    }

    /**
     * Helper: Map Instagram media object to PostData
     */
    private mapMediaToPost(media: any): PostData {
        return {
            id: media.id,
            shortcode: media.code,
            url: `https://www.instagram.com/p/${media.code}/`,
            type: media.media_type === 2 ? 'video' : (media.media_type === 8 ? 'carousel' : 'image'),
            caption: media.caption?.text || '',
            likesCount: media.like_count || 0,
            commentsCount: media.comment_count || 0,
            mediaUrl: media.image_versions2?.candidates?.[0]?.url || '',
            thumbnailUrl: media.image_versions2?.candidates?.[0]?.url || '',
            ownerUsername: media.user?.username || '',
            ownerId: media.user?.pk || '',
            timestamp: media.taken_at ? new Date(media.taken_at * 1000) : new Date(),
            hashtags: [],
            mentions: [],
            isSponsored: false,
            scrapedAt: new Date(),
        };
    }
}