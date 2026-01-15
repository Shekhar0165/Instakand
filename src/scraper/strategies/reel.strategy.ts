import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'playwright';
import { ReelData } from '../../common/interfaces';
import { humanDelay, randomDelay } from '../../common/utils';

@Injectable()
export class ReelStrategy {
    private readonly logger = new Logger(ReelStrategy.name);

    /**
     * Scrape reels from a profile
     */
    async scrapeProfileReels(
        page: Page,
        username: string,
        limit: number = 12,
    ): Promise<ReelData[]> {
        const url = `https://www.instagram.com/${username}/reels/`;
        const reels: ReelData[] = [];

        try {
            this.logger.debug(`Scraping reels for profile: ${username} (limit: ${limit})`);

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await humanDelay('navigate');

            // Check if profile has reels tab
            const notFound = await page.$('text="Sorry, this page isn\'t available."');
            const noReels = await page.$('text="No reels yet"');

            if (notFound || noReels) {
                this.logger.warn(`No reels found for: ${username}`);
                return [];
            }

            // Wait for reels grid to load
            await page.waitForSelector('a[href*="/reel/"]', { timeout: 10000 }).catch(() => null);

            let scrollAttempts = 0;
            const maxScrollAttempts = Math.ceil(limit / 12) + 5;

            while (reels.length < limit && scrollAttempts < maxScrollAttempts) {
                // Extract reel links
                const reelLinks = await page.$$eval('a[href*="/reel/"]', (links) =>
                    links.map((link) => {
                        const img = link.querySelector('img');
                        const viewsEl = link.querySelector('[aria-label*="Play"]')?.parentElement;
                        const viewsText = viewsEl?.textContent || '';

                        return {
                            href: link.getAttribute('href') || '',
                            thumbnail: img?.getAttribute('src') || '',
                            viewsText,
                        };
                    }),
                );

                for (const reelLink of reelLinks) {
                    if (reels.length >= limit) break;

                    const shortcode = reelLink.href.match(/\/reel\/([^/]+)/)?.[1];
                    if (!shortcode || reels.some((r) => r.shortcode === shortcode)) {
                        continue;
                    }

                    reels.push({
                        id: shortcode,
                        shortcode,
                        url: `https://www.instagram.com/reels/${shortcode}/`,
                        type: 'reel',
                        caption: '',
                        likesCount: 0,
                        commentsCount: 0,
                        viewsCount: this.parseViewCount(reelLink.viewsText),
                        playsCount: 0,
                        duration: 0,
                        mediaUrl: '',
                        thumbnailUrl: reelLink.thumbnail,
                        ownerUsername: username,
                        ownerId: '',
                        timestamp: new Date(),
                        hashtags: [],
                        mentions: [],
                        isSponsored: false,
                        scrapedAt: new Date(),
                    });
                }

                if (reels.length >= limit) break;

                // Scroll down
                await page.evaluate(() => window.scrollBy(0, 800));
                await randomDelay(1000, 2000);
                scrollAttempts++;
            }

            this.logger.log(`Scraped ${reels.length} reels from profile: ${username}`);
            return reels.slice(0, limit);

        } catch (error) {
            this.logger.error(`Error scraping reels for ${username}: ${error.message}`);
            return reels;
        }
    }

    /**
     * Scrape detailed data from a single reel
     */
    async scrapeReelDetails(page: Page, shortcode: string): Promise<ReelData | null> {
        const url = `https://www.instagram.com/reel/${shortcode}/`;

        try {
            this.logger.debug(`Scraping reel: ${shortcode}`);

            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await humanDelay('navigate');

            // Check if reel exists
            const notFound = await page.$('text="Sorry, this page isn\'t available."');
            if (notFound) {
                this.logger.warn(`Reel not found: ${shortcode}`);
                return null;
            }

            // Extract reel data
            const reelData = await page.evaluate(() => {
                const getMeta = (name: string) => {
                    const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
                    return el?.getAttribute('content') || '';
                };

                const title = document.title || '';
                const description = getMeta('og:description') || '';

                // Extract username from title
                const usernameMatch = title.match(/@(\w+)/);
                const likesMatch = description.match(/([\d,.]+[KMB]?)\s*likes?/i);
                const viewsMatch = description.match(/([\d,.]+[KMB]?)\s*(?:views?|plays?)/i);

                return {
                    contentUrl: getMeta('og:video') || getMeta('og:image') || '',
                    thumbnailUrl: getMeta('og:image') || '',
                    caption: description,
                    username: usernameMatch?.[1] || '',
                    likesCount: likesMatch?.[1] || '0',
                    viewsCount: viewsMatch?.[1] || '0',
                    uploadDate: getMeta('article:published_time') || getMeta('video:release_date') || '',
                };
            });

            // Extract hashtags and mentions
            const hashtags = this.extractHashtagsFromText(reelData.caption);
            const mentions = this.extractMentionsFromText(reelData.caption);

            const reel: ReelData = {
                id: shortcode,
                shortcode,
                url: `https://www.instagram.com/reels/${shortcode}/`,
                type: 'reel',
                caption: reelData.caption,
                likesCount: this.parseCount(reelData.likesCount),
                commentsCount: 0,
                viewsCount: this.parseCount(reelData.viewsCount),
                playsCount: 0,
                duration: 0,
                mediaUrl: reelData.contentUrl,
                thumbnailUrl: reelData.thumbnailUrl,
                ownerUsername: reelData.username,
                ownerId: '',
                timestamp: reelData.uploadDate ? new Date(reelData.uploadDate) : new Date(),
                hashtags,
                mentions,
                isSponsored: false,
                scrapedAt: new Date(),
            };

            this.logger.log(`Scraped reel: ${shortcode} (${reel.viewsCount} views)`);
            return reel;

        } catch (error) {
            this.logger.error(`Error scraping reel ${shortcode}: ${error.message}`);
            return null;
        }
    }

    /**
     * Parse view count from text
     */
    private parseViewCount(text: string): number {
        const match = text.match(/([\d,.]+[KMB]?)/i);
        if (!match) return 0;
        return this.parseCount(match[1]);
    }

    /**
     * Parse count strings like "1.5M" to numbers
     */
    private parseCount(countStr: string): number {
        if (!countStr) return 0;

        const cleanStr = countStr.replace(/,/g, '').trim().toUpperCase();
        const match = cleanStr.match(/([\d.]+)([KMB])?/);

        if (!match) return 0;

        let num = parseFloat(match[1]);
        const suffix = match[2];

        if (suffix === 'K') num *= 1000;
        else if (suffix === 'M') num *= 1000000;
        else if (suffix === 'B') num *= 1000000000;

        return Math.round(num);
    }

    private extractHashtagsFromText(text: string): string[] {
        const matches = text.match(/#[\w\u0080-\uFFFF]+/g) || [];
        return matches.map((tag) => tag.slice(1).toLowerCase());
    }

    private extractMentionsFromText(text: string): string[] {
        const matches = text.match(/@[\w.]+/g) || [];
        return matches.map((mention) => mention.slice(1).toLowerCase());
    }
}
