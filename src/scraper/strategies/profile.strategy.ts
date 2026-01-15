import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'playwright';
import { ProfileData, PostData } from '../../common/interfaces';
import { humanDelay, randomDelay } from '../../common/utils';

interface GraphQLProfileResponse {
    data?: {
        user?: {
            id: string;
            username: string;
            full_name: string;
            biography: string;
            profile_pic_url_hd?: string;
            edge_followed_by?: { count: number };
            edge_follow?: { count: number };
            edge_owner_to_timeline_media?: {
                count: number;
                edges: any[];
            };
            is_verified?: boolean;
            is_private?: boolean;
            is_business_account?: boolean;
        };
    };
    graphql?: {
        user?: any;
    };
}

@Injectable()
export class ProfileStrategy {
    private readonly logger = new Logger(ProfileStrategy.name);

    /**
     * Scrape profile data using multi-strategy approach
     */
    async scrapeProfile(page: Page, username: string): Promise<ProfileData | null> {
        const url = `https://www.instagram.com/${username}/`;

        try {
            this.logger.debug(`Scraping profile: ${username}`);

            // Set up response interception for GraphQL data
            const capturedData: GraphQLProfileResponse[] = [];

            page.on('response', async (response) => {
                const responseUrl = response.url();

                if (responseUrl.includes('/graphql') || responseUrl.includes('query_hash')) {
                    try {
                        const contentType = response.headers()['content-type'] || '';
                        if (contentType.includes('application/json')) {
                            const json = await response.json().catch(() => null);
                            if (json && (json.data?.user || json.graphql?.user)) {
                                capturedData.push(json);
                                this.logger.debug('Captured GraphQL profile data');
                            }
                        }
                    } catch (e) {
                        // Ignore
                    }
                }
            });

            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            await humanDelay('navigate');

            // Check if profile exists
            const pageContent = await page.content();
            if (pageContent.includes("Sorry, this page isn't available")) {
                this.logger.warn(`Profile not found: ${username}`);
                return null;
            }

            // Strategy 1: Try GraphQL data first
            for (const data of capturedData) {
                const userData = data.data?.user || data.graphql?.user;
                if (userData) {
                    const profile = this.parseGraphQLProfile(userData, username);
                    if (profile && profile.followersCount > 0) {
                        this.logger.log(`Profile scraped via GraphQL: ${username} (${this.formatCount(profile.followersCount)} followers)`);
                        return profile;
                    }
                }
            }

            // Strategy 2: Extract from page source JSON
            const pageProfile = await this.extractProfileFromPageSource(page, username);
            if (pageProfile && pageProfile.followersCount > 0) {
                this.logger.log(`Profile scraped via page source: ${username} (${this.formatCount(pageProfile.followersCount)} followers)`);
                return pageProfile;
            }

            // Strategy 3: Extract from meta tags and DOM (least reliable)
            const metaProfile = await this.extractProfileFromMetaTags(page, username);

            this.logger.log(`Profile scraped via meta/DOM: ${username} (${this.formatCount(metaProfile.followersCount)} followers)`);
            return metaProfile;

        } catch (error) {
            this.logger.error(`Error scraping profile ${username}: ${error.message}`);
            return null;
        }
    }

    /**
     * Parse GraphQL user data into ProfileData
     */
    private parseGraphQLProfile(userData: any, username: string): ProfileData {
        return {
            id: userData.id || '',
            username: userData.username || username,
            fullName: userData.full_name || '',
            bio: userData.biography || '',
            profilePicUrl: userData.profile_pic_url_hd || userData.profile_pic_url || '',
            followersCount: userData.edge_followed_by?.count || 0,
            followingCount: userData.edge_follow?.count || 0,
            postsCount: userData.edge_owner_to_timeline_media?.count || 0,
            isVerified: userData.is_verified || false,
            isPrivate: userData.is_private || false,
            isBusiness: userData.is_business_account || false,
            externalUrl: userData.external_url,
            scrapedAt: new Date(),
        };
    }

    /**
     * Extract profile data from embedded JSON in page source
     */
    private async extractProfileFromPageSource(page: Page, username: string): Promise<ProfileData | null> {
        try {
            const profileData = await page.evaluate(() => {
                // Method 1: Check window._sharedData
                const sharedData = (window as any)._sharedData;
                if (sharedData?.entry_data?.ProfilePage?.[0]?.graphql?.user) {
                    return sharedData.entry_data.ProfilePage[0].graphql.user;
                }

                // Method 2: Look for JSON in script tags
                const scripts = document.querySelectorAll('script[type="application/json"]');
                for (const script of scripts) {
                    try {
                        const data = JSON.parse(script.textContent || '');
                        // Look for user data in various places
                        if (data?.require) {
                            for (const req of data.require) {
                                if (Array.isArray(req) && req.length > 3) {
                                    const modData = req[3];
                                    if (modData?.user) return modData.user;
                                    if (modData?.graphql?.user) return modData.graphql.user;
                                }
                            }
                        }
                        if (data?.user) return data.user;
                    } catch (e) { }
                }

                // Method 3: Parse from __additionalDataLoaded
                const allScripts = document.querySelectorAll('script');
                for (const script of allScripts) {
                    const text = script.textContent || '';
                    if (text.includes('edge_followed_by') && text.includes('count')) {
                        // Try to extract follower count directly
                        const followerMatch = text.match(/"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);
                        const followingMatch = text.match(/"edge_follow"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);
                        const postsMatch = text.match(/"edge_owner_to_timeline_media"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);

                        if (followerMatch) {
                            return {
                                edge_followed_by: { count: parseInt(followerMatch[1]) },
                                edge_follow: { count: followingMatch ? parseInt(followingMatch[1]) : 0 },
                                edge_owner_to_timeline_media: { count: postsMatch ? parseInt(postsMatch[1]) : 0 },
                            };
                        }
                    }
                }

                return null;
            });

            if (profileData) {
                return this.parseGraphQLProfile(profileData, username);
            }
        } catch (error) {
            this.logger.warn(`Page source extraction failed: ${error.message}`);
        }

        return null;
    }

    /**
     * Extract profile from meta tags and DOM elements
     */
    private async extractProfileFromMetaTags(page: Page, username: string): Promise<ProfileData> {
        const data = await page.evaluate(() => {
            const getMeta = (name: string) => {
                const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
                return el?.getAttribute('content') || '';
            };

            const description = getMeta('og:description') || getMeta('description') || '';
            const title = document.title || '';

            // Parse stats from description like "1.8M Followers, 500 Following, 6,789 Posts"
            const followerMatch = description.match(/([\d,.]+[KMB]?)\s*Followers/i);
            const followingMatch = description.match(/([\d,.]+[KMB]?)\s*Following/i);
            const postsMatch = description.match(/([\d,.]+[KMB]?)\s*Posts/i);

            // Also try to get from header text on page
            const headerText = document.querySelector('header')?.textContent || '';
            const headerFollowerMatch = headerText.match(/([\d,.]+[KMB]?)\s*followers/i);
            const headerFollowingMatch = headerText.match(/([\d,.]+[KMB]?)\s*following/i);
            const headerPostsMatch = headerText.match(/([\d,.]+[KMB]?)\s*posts/i);

            return {
                title,
                description,
                image: getMeta('og:image') || '',
                followers: followerMatch?.[1] || headerFollowerMatch?.[1] || '0',
                following: followingMatch?.[1] || headerFollowingMatch?.[1] || '0',
                posts: postsMatch?.[1] || headerPostsMatch?.[1] || '0',
            };
        });

        // Parse full name from title
        const titleMatch = data.title?.match(/(.+?)\s*\(@\w+\)/);
        const fullName = titleMatch?.[1]?.trim() || '';

        // Check for verified badge and private account
        const isVerified = await page.$('[aria-label*="Verified"]').then(el => !!el);
        const isPrivate = await page.$('text="This account is private"').then(el => !!el);

        return {
            id: '',
            username: username,
            fullName: fullName,
            bio: data.description || '',
            profilePicUrl: data.image || '',
            followersCount: this.parseCount(data.followers),
            followingCount: this.parseCount(data.following),
            postsCount: this.parseCount(data.posts),
            isVerified,
            isPrivate,
            isBusiness: false,
            scrapedAt: new Date(),
        };
    }

    /**
     * Scrape posts from a profile page
     */
    async scrapeProfilePosts(
        page: Page,
        username: string,
        limit: number = 12,
    ): Promise<PostData[]> {
        const url = `https://www.instagram.com/${username}/`;
        const posts: PostData[] = [];
        const capturedPosts: any[] = [];

        try {
            this.logger.debug(`Scraping posts for profile: ${username} (limit: ${limit})`);

            // Set up response interception
            page.on('response', async (response) => {
                const responseUrl = response.url();

                if (responseUrl.includes('/graphql') || responseUrl.includes('query_hash')) {
                    try {
                        const json = await response.json().catch(() => null);
                        if (json?.data?.user?.edge_owner_to_timeline_media?.edges) {
                            capturedPosts.push(...json.data.user.edge_owner_to_timeline_media.edges);
                        }
                    } catch (e) { }
                }
            });

            await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
            await humanDelay('navigate');

            // Check for private account
            const isPrivate = await page.$('text="This account is private"');
            if (isPrivate) {
                this.logger.warn(`Profile ${username} is private, cannot scrape posts`);
                return [];
            }

            // Process captured GraphQL posts first
            for (const edge of capturedPosts) {
                if (posts.length >= limit) break;
                const post = this.parseGraphQLPost(edge, username);
                if (post && !posts.some(p => p.shortcode === post.shortcode)) {
                    posts.push(post);
                }
            }

            // If we need more, scroll and extract from DOM
            let scrollAttempts = 0;
            const maxScrollAttempts = Math.ceil(limit / 12) + 5;

            while (posts.length < limit && scrollAttempts < maxScrollAttempts) {
                const postLinks = await page.$$eval('a[href*="/p/"], a[href*="/reel/"]', (links) =>
                    links.map((link) => ({
                        href: link.getAttribute('href') || '',
                        img: link.querySelector('img')?.getAttribute('src') || '',
                    })),
                );

                for (const postLink of postLinks) {
                    if (posts.length >= limit) break;

                    const shortcodeMatch = postLink.href.match(/\/(?:p|reel)\/([^/]+)/);
                    const shortcode = shortcodeMatch?.[1];

                    if (!shortcode || posts.some((p) => p.shortcode === shortcode)) continue;

                    posts.push({
                        id: shortcode,
                        shortcode,
                        url: `https://www.instagram.com/p/${shortcode}/`,
                        type: postLink.href.includes('/reel/') ? 'reel' : 'image',
                        caption: '',
                        likesCount: 0,
                        commentsCount: 0,
                        mediaUrl: postLink.img,
                        thumbnailUrl: postLink.img,
                        ownerUsername: username,
                        ownerId: '',
                        timestamp: new Date(),
                        hashtags: [],
                        mentions: [],
                        isSponsored: false,
                        scrapedAt: new Date(),
                    });
                }

                if (posts.length >= limit) break;

                await page.evaluate(() => window.scrollBy(0, 1000));
                await randomDelay(1000, 2000);
                scrollAttempts++;
            }

            this.logger.log(`Scraped ${posts.length} posts from profile: ${username}`);
            return posts.slice(0, limit);

        } catch (error) {
            this.logger.error(`Error scraping profile posts for ${username}: ${error.message}`);
            return posts;
        }
    }

    /**
     * Parse GraphQL post edge into PostData
     */
    private parseGraphQLPost(edge: any, ownerUsername: string): PostData | null {
        try {
            const node = edge.node;
            const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || '';

            return {
                id: node.id,
                shortcode: node.shortcode,
                url: `https://www.instagram.com/p/${node.shortcode}/`,
                type: node.is_video ? 'video' : (node.__typename === 'GraphSidecar' ? 'carousel' : 'image'),
                caption,
                likesCount: node.edge_liked_by?.count || node.edge_media_preview_like?.count || 0,
                commentsCount: node.edge_media_to_comment?.count || 0,
                viewsCount: node.video_view_count,
                mediaUrl: node.display_url || '',
                thumbnailUrl: node.thumbnail_src || node.display_url || '',
                ownerUsername: node.owner?.username || ownerUsername,
                ownerId: node.owner?.id || '',
                timestamp: node.taken_at_timestamp
                    ? new Date(node.taken_at_timestamp * 1000)
                    : new Date(),
                hashtags: this.extractHashtags(caption),
                mentions: this.extractMentions(caption),
                isSponsored: false,
                scrapedAt: new Date(),
            };
        } catch (error) {
            return null;
        }
    }

    /**
     * Parse count strings like "1.8M" or "12,345" to actual numbers
     */
    private parseCount(countStr: string): number {
        if (!countStr) return 0;

        // Remove commas and trim
        const cleanStr = countStr.replace(/,/g, '').trim().toUpperCase();

        // Match number with optional K/M/B suffix
        const match = cleanStr.match(/^([\d.]+)\s*([KMB])?$/);
        if (!match) return 0;

        let num = parseFloat(match[1]);
        const suffix = match[2];

        if (suffix === 'K') num *= 1000;
        else if (suffix === 'M') num *= 1000000;
        else if (suffix === 'B') num *= 1000000000;

        return Math.round(num);
    }

    /**
     * Format count for logging
     */
    private formatCount(count: number): string {
        if (count >= 1000000000) return `${(count / 1000000000).toFixed(1)}B`;
        if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
        if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
        return count.toString();
    }

    private extractHashtags(text: string): string[] {
        const matches = text.match(/#[\w\u0080-\uFFFF]+/g) || [];
        return matches.map(tag => tag.slice(1).toLowerCase());
    }

    private extractMentions(text: string): string[] {
        const matches = text.match(/@[\w.]+/g) || [];
        return matches.map(mention => mention.slice(1).toLowerCase());
    }
}
