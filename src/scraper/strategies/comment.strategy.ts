import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'playwright';
import { CommentData } from '../../common/interfaces';
import { humanDelay, randomDelay } from '../../common/utils';

@Injectable()
export class CommentStrategy {
    private readonly logger = new Logger(CommentStrategy.name);

    /**
     * Scrape comments from a post
     */
    async scrapeComments(
        page: Page,
        shortcodeOrUrl: string,
        limit: number = 50,
    ): Promise<CommentData[]> {
        // Extract shortcode from URL if needed
        let shortcode = shortcodeOrUrl;
        if (shortcodeOrUrl.includes('instagram.com')) {
            const match = shortcodeOrUrl.match(/\/(?:p|reel)\/([^/?]+)/);
            if (match) {
                shortcode = match[1];
            }
        }

        const url = `https://www.instagram.com/p/${shortcode}/`;
        const comments: CommentData[] = [];

        try {
            this.logger.debug(`Scraping comments for post: ${shortcode} (limit: ${limit})`);

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await humanDelay('navigate');

            // Check if post exists
            const notFound = await page.$('text="Sorry, this page isn\'t available."');
            if (notFound) {
                this.logger.warn(`Post not found: ${shortcode}`);
                return [];
            }

            // Wait for comments section
            await page.waitForSelector('ul', { timeout: 10000 }).catch(() => null);

            // Click "Load more comments" button repeatedly
            let loadMoreAttempts = 0;
            const maxLoadMoreAttempts = Math.ceil(limit / 10) + 5;

            while (loadMoreAttempts < maxLoadMoreAttempts) {
                const loadMoreButton = await page.$('button:has-text("Load more comments"), button:has-text("View all"), [aria-label*="Load more"]');

                if (!loadMoreButton) break;

                try {
                    await loadMoreButton.click();
                    await randomDelay(1000, 2000);
                    loadMoreAttempts++;
                } catch {
                    break;
                }
            }

            // Extract comments from the page
            const rawComments = await page.evaluate(() => {
                const commentElements = document.querySelectorAll('ul ul');
                const comments: Array<{
                    username: string;
                    text: string;
                    profilePic: string;
                    timestamp: string;
                }> = [];

                commentElements.forEach((el) => {
                    const usernameEl = el.querySelector('a[href*="/"]');
                    const textEl = el.querySelector('span');
                    const profilePicEl = el.querySelector('img');
                    const timeEl = el.querySelector('time');

                    if (usernameEl && textEl) {
                        const username = usernameEl.getAttribute('href')?.replace(/\//g, '') || '';
                        const text = textEl.textContent || '';

                        // Skip if it looks like the post caption (usually the first one)
                        if (username && text && text.length < 1000) {
                            comments.push({
                                username,
                                text,
                                profilePic: profilePicEl?.getAttribute('src') || '',
                                timestamp: timeEl?.getAttribute('datetime') || '',
                            });
                        }
                    }
                });

                return comments;
            });

            // Convert to CommentData format
            for (const raw of rawComments) {
                if (comments.length >= limit) break;

                // Skip duplicates
                if (comments.some((c) => c.ownerUsername === raw.username && c.text === raw.text)) {
                    continue;
                }

                comments.push({
                    id: `comment_${shortcode}_${comments.length}`,
                    text: raw.text,
                    ownerUsername: raw.username,
                    ownerId: '',
                    ownerProfilePic: raw.profilePic,
                    likesCount: 0, // Not easily available without scrolling
                    timestamp: raw.timestamp ? new Date(raw.timestamp) : new Date(),
                    postId: shortcode,
                    postShortcode: shortcode,
                    scrapedAt: new Date(),
                });
            }

            this.logger.log(`Scraped ${comments.length} comments from post: ${shortcode}`);
            return comments.slice(0, limit);

        } catch (error) {
            this.logger.error(`Error scraping comments for ${shortcode}: ${error.message}`);
            return comments;
        }
    }
}
