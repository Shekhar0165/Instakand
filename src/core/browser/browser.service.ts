import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { generateFingerprint } from '../../common/utils';
import { BrowserFingerprint, ProxyConfig } from '../../common/interfaces';
import { humanDelay, randomDelay } from '../../common/utils';

@Injectable()
export class BrowserService implements OnModuleDestroy {
    private readonly logger = new Logger(BrowserService.name);
    private browser: Browser | null = null;
    private activeContexts: Map<string, BrowserContext> = new Map();

    constructor(private readonly configService: ConfigService) { }

    async onModuleDestroy() {
        await this.closeAll();
    }

    /**
     * Initialize the browser instance
     */
    async initBrowser(): Promise<Browser> {
        if (this.browser) {
            return this.browser;
        }

        this.logger.log('Launching Chromium browser...');

        this.browser = await chromium.launch({
            headless: true, // Set to false for debugging
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
            ],
        });

        this.logger.log('Browser launched successfully');
        return this.browser;
    }

    /**
     * Create a new browser context with anti-detection measures
     */
    async createContext(
        contextId: string,
        proxy?: ProxyConfig | null,
    ): Promise<BrowserContext> {
        const browser = await this.initBrowser();
        const fingerprint = generateFingerprint();

        this.logger.debug(`Creating context ${contextId} with fingerprint`);

        const contextOptions: any = {
            viewport: fingerprint.viewport,
            userAgent: fingerprint.userAgent,
            locale: fingerprint.language,
            timezoneId: fingerprint.timezone,
            permissions: ['geolocation'],
            geolocation: { latitude: 40.7128, longitude: -74.006 }, // NYC
            colorScheme: 'light',
            deviceScaleFactor: 1,
            hasTouch: false,
            javaScriptEnabled: true,
            ignoreHTTPSErrors: true,
        };

        // Add proxy if provided
        if (proxy && proxy.isActive) {
            contextOptions.proxy = {
                server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
                username: proxy.username,
                password: proxy.password,
            };
        }

        const context = await browser.newContext(contextOptions);

        // Add anti-detection scripts
        await this.addAntiDetectionScripts(context);

        this.activeContexts.set(contextId, context);
        return context;
    }

    /**
     * Add scripts to make browser appear more human
     */
    private async addAntiDetectionScripts(context: BrowserContext): Promise<void> {
        await context.addInitScript(() => {
            // Override webdriver property
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined,
            });

            // Override plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5],
            });

            // Override languages
            Object.defineProperty(navigator, 'languages', {
                get: () => ['en-US', 'en'],
            });

            // Override platform
            Object.defineProperty(navigator, 'platform', {
                get: () => 'Win32',
            });

            // Override permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters: any) =>
                parameters.name === 'notifications'
                    ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
                    : originalQuery(parameters);

            // Override chrome property
            (window as any).chrome = {
                runtime: {},
            };

            // Override console.debug to hide automation messages
            const originalDebug = console.debug;
            console.debug = (...args: any[]) => {
                if (args[0]?.includes?.('puppeteer') || args[0]?.includes?.('playwright')) {
                    return;
                }
                originalDebug.apply(console, args);
            };
        });
    }

    /**
     * Create a new page in a context
     */
    async createPage(contextId: string): Promise<Page> {
        const context = this.activeContexts.get(contextId);
        if (!context) {
            throw new Error(`Context ${contextId} not found`);
        }

        const page = await context.newPage();

        // Set extra headers
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        });

        return page;
    }

    /**
     * Navigate to URL with human-like behavior
     */
    async navigateWithRetry(
        page: Page,
        url: string,
        maxRetries: number = 3,
    ): Promise<boolean> {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                this.logger.debug(`Navigating to ${url} (attempt ${attempt + 1})`);

                await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000,
                });

                // Wait a bit to appear human
                await humanDelay('navigate');

                // Check for rate limiting or login wall
                const content = await page.content();
                if (content.includes('login') && content.includes('Sign up')) {
                    // Instagram login wall - but we can still scrape public content
                    this.logger.debug('Encountered login prompt, continuing...');
                }

                return true;
            } catch (error) {
                this.logger.warn(`Navigation failed (attempt ${attempt + 1}): ${error.message}`);

                if (attempt < maxRetries - 1) {
                    await randomDelay(2000, 5000);
                }
            }
        }

        return false;
    }

    /**
     * Simulate human-like scrolling
     */
    async humanScroll(page: Page, scrolls: number = 3): Promise<void> {
        for (let i = 0; i < scrolls; i++) {
            // Random scroll distance
            const scrollDistance = 300 + Math.random() * 500;

            await page.evaluate((distance) => {
                window.scrollBy({
                    top: distance,
                    behavior: 'smooth',
                });
            }, scrollDistance);

            // Random delay between scrolls
            await humanDelay('scroll');
        }
    }

    /**
     * Close a specific context
     */
    async closeContext(contextId: string): Promise<void> {
        const context = this.activeContexts.get(contextId);
        if (context) {
            await context.close();
            this.activeContexts.delete(contextId);
            this.logger.debug(`Closed context ${contextId}`);
        }
    }

    /**
     * Close all contexts and the browser
     */
    async closeAll(): Promise<void> {
        this.logger.log('Closing all browser contexts...');

        for (const [contextId, context] of this.activeContexts) {
            try {
                await context.close();
            } catch (error) {
                this.logger.warn(`Error closing context ${contextId}: ${error.message}`);
            }
        }
        this.activeContexts.clear();

        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.logger.log('Browser closed');
        }
    }

    /**
     * Get current number of active contexts
     */
    getActiveContextCount(): number {
        return this.activeContexts.size;
    }
}
