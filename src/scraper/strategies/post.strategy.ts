import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'playwright';
import { PostData } from '../../common/interfaces';
import { humanDelay } from '../../common/utils';

@Injectable()
export class PostStrategy {
    private readonly logger = new Logger(PostStrategy.name);

    /**
     * Scrape detailed data from a single post
     */
    async scrapePost(page: Page, shortcodeOrUrl: string): Promise<PostData | null> {
        // Extract shortcode from URL if needed
        let shortcode = shortcodeOrUrl;
        if (shortcodeOrUrl.includes('instagram.com')) {
            const match = shortcodeOrUrl.match(/\/(?:p|reel)\/([^/?]+)/);
            if (match) {
                shortcode = match[1];
            }
        }

        const url = `https://www.instagram.com/p/${shortcode}/`;

        try {
            this.logger.debug(`Scraping post: ${shortcode}`);

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await humanDelay('navigate');

            // Check if post exists
            const notFound = await page.$('text="Sorry, this page isn\'t available."');
            if (notFound) {
                this.logger.warn(`Post not found: ${shortcode}`);
                return null;
            }

            // Wait for content to load
            await page.waitForSelector('article', { timeout: 10000 }).catch(() => null);

            // Extract post data
            const postData = await page.evaluate((sc) => {
                // Try to get data from JSON-LD first
                const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                for (const script of scripts) {
                    try {
                        const data = JSON.parse(script.textContent || '');
                        if (data['@type'] === 'ImageObject' || data['@type'] === 'VideoObject') {
                            return {
                                type: data['@type'] === 'VideoObject' ? 'video' : 'image',
                                caption: data.caption || data.articleBody || '',
                                author: data.author?.identifier?.value || data.author?.name || '',
                                authorUrl: data.author?.url || '',
                                contentUrl: data.contentUrl || data.url || '',
                                thumbnailUrl: data.thumbnailUrl || '',
                                uploadDate: data.uploadDate || '',
                                commentCount: data.commentCount || 0,
                                interactionCount: data.interactionStatistic?.userInteractionCount || 0,
                            };
                        }
                    } catch (e) {
                        // Continue
                    }
                }

                // Fallback to meta tags
                const getMeta = (name: string) => {
                    const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
                    return el?.getAttribute('content') || '';
                };

                const title = document.title || '';
                const description = getMeta('og:description') || '';

                // Try to extract username from title
                const usernameMatch = title.match(/@(\w+)/);
                const username = usernameMatch?.[1] || '';

                // Extract likes from description
                const likesMatch = description.match(/([\d,]+)\s*likes?/i);
                const commentsMatch = description.match(/([\d,]+)\s*comments?/i);

                return {
                    type: getMeta('og:type')?.includes('video') ? 'video' : 'image',
                    caption: description,
                    author: username,
                    contentUrl: getMeta('og:image') || getMeta('og:video') || '',
                    thumbnailUrl: getMeta('og:image') || '',
                    likesCount: likesMatch?.[1]?.replace(/,/g, '') || '0',
                    commentsCount: commentsMatch?.[1]?.replace(/,/g, '') || '0',
                    uploadDate: getMeta('article:published_time') || getMeta('video:release_date') || '',
                };
            }, shortcode);

            // Extract hashtags and mentions from caption
            const hashtags = this.extractHashtagsFromText(postData.caption);
            const mentions = this.extractMentionsFromText(postData.caption);

            // Determine post type
            let type: 'image' | 'video' | 'carousel' | 'reel' = 'image';
            if (url.includes('/reel/')) {
                type = 'reel';
            } else if (postData.type === 'video') {
                type = 'video';
            }

            // Check for carousel (multiple images)
            const hasMultipleMedia = await page.$('[aria-label="Next"]').then((el) => !!el);
            if (hasMultipleMedia && type === 'image') {
                type = 'carousel';
            }

            const post: PostData = {
                id: shortcode,
                shortcode,
                url: `https://www.instagram.com/${type === 'reel' ? 'reels' : 'p'}/${shortcode}/`,
                type,
                caption: postData.caption || '',
                likesCount: parseInt(postData.likesCount?.toString() || postData.interactionCount?.toString() || '0'),
                commentsCount: parseInt(postData.commentsCount?.toString() || postData.commentCount?.toString() || '0'),
                mediaUrl: postData.contentUrl || '',
                thumbnailUrl: postData.thumbnailUrl || '',
                ownerUsername: postData.author || '',
                ownerId: '',
                timestamp: postData.uploadDate ? new Date(postData.uploadDate) : new Date(),
                hashtags,
                mentions,
                isSponsored: false,
                scrapedAt: new Date(),
            };

            // Check for sponsored content
            const isPaidPartnership = await page.$('text="Paid partnership"').then((el) => !!el);
            post.isSponsored = isPaidPartnership;

            this.logger.log(`Scraped post: ${shortcode} (${type}, ${post.likesCount} likes)`);
            return post;

        } catch (error) {
            this.logger.error(`Error scraping post ${shortcode}: ${error.message}`);
            return null;
        }
    }

    /**
     * Get all media URLs from a carousel post
     */
    async scrapeCarouselMedia(page: Page, shortcode: string): Promise<string[]> {
        const mediaUrls: string[] = [];

        try {
            // Click through carousel and collect all media URLs
            const nextButton = await page.$('[aria-label="Next"]');
            if (!nextButton) {
                // Not a carousel, return current media
                const currentMedia = await page.$eval('article img, article video', (el) =>
                    (el as HTMLImageElement).src || (el as HTMLVideoElement).src
                ).catch(() => '');
                if (currentMedia) mediaUrls.push(currentMedia);
                return mediaUrls;
            }

            // Get first image
            const firstMedia = await page.$eval('article img, article video', (el) =>
                (el as HTMLImageElement).src || (el as HTMLVideoElement).src
            ).catch(() => '');
            if (firstMedia) mediaUrls.push(firstMedia);

            // Click through carousel
            let hasNext = true;
            let maxClicks = 20; // Safety limit

            while (hasNext && maxClicks > 0) {
                await nextButton.click();
                await humanDelay('click');

                const currentMedia = await page.$eval('article img, article video', (el) =>
                    (el as HTMLImageElement).src || (el as HTMLVideoElement).src
                ).catch(() => '');

                if (currentMedia && !mediaUrls.includes(currentMedia)) {
                    mediaUrls.push(currentMedia);
                }

                hasNext = await page.$('[aria-label="Next"]').then((el) => !!el);
                maxClicks--;
            }

        } catch (error) {
            this.logger.warn(`Error scraping carousel media: ${error.message}`);
        }

        return mediaUrls;
    }

    /**
     * Extract hashtags from text
     */
    private extractHashtagsFromText(text: string): string[] {
        const matches = text.match(/#[\w\u0080-\uFFFF]+/g) || [];
        return matches.map((tag) => tag.slice(1).toLowerCase());
    }

    /**
     * Extract mentions from text
     */
    private extractMentionsFromText(text: string): string[] {
        const matches = text.match(/@[\w.]+/g) || [];
        return matches.map((mention) => mention.slice(1).toLowerCase());
    }
}
