import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrowserContext, Page } from 'playwright';
import { humanDelay, randomDelay } from '../../common/utils';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Authentication Service for Instagram
 * Handles login, session persistence, and cookie management
 */
@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);
    private readonly sessionDir: string;
    private isLoggedIn: boolean = false;

    constructor(private readonly configService: ConfigService) {
        // Directory to store session cookies
        this.sessionDir = path.join(process.cwd(), 'sessions');
        this.ensureSessionDir();
    }

    /**
     * Ensure session directory exists
     */
    private ensureSessionDir(): void {
        if (!fs.existsSync(this.sessionDir)) {
            fs.mkdirSync(this.sessionDir, { recursive: true });
            this.logger.log('Created sessions directory');
        }
    }

    /**
     * Get session file path for a username
     */
    private getSessionPath(username: string): string {
        return path.join(this.sessionDir, `${username}_session.json`);
    }

    /**
     * Check if credentials are configured
     */
    hasCredentials(): boolean {
        const username = this.configService.get<string>('INSTAGRAM_USERNAME');
        const password = this.configService.get<string>('INSTAGRAM_PASSWORD');
        return !!(username && password);
    }

    /**
     * Get configured credentials
     */
    getCredentials(): { username: string; password: string } | null {
        const username = this.configService.get<string>('INSTAGRAM_USERNAME');
        const password = this.configService.get<string>('INSTAGRAM_PASSWORD');

        if (!username || !password) {
            return null;
        }

        return { username, password };
    }

    /**
     * Load saved session cookies into browser context
     */
    async loadSession(context: BrowserContext, username: string): Promise<boolean> {
        const sessionPath = this.getSessionPath(username);

        if (!fs.existsSync(sessionPath)) {
            this.logger.debug('No saved session found');
            return false;
        }

        try {
            const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
            const cookies = sessionData.cookies || [];

            if (cookies.length === 0) {
                return false;
            }

            // Check if session is expired (older than 7 days)
            const savedAt = new Date(sessionData.savedAt);
            const now = new Date();
            const daysDiff = (now.getTime() - savedAt.getTime()) / (1000 * 60 * 60 * 24);

            if (daysDiff > 7) {
                this.logger.warn('Session is older than 7 days, will re-login');
                return false;
            }

            await context.addCookies(cookies);
            this.logger.log(`Loaded session for ${username}`);
            return true;
        } catch (error) {
            this.logger.warn(`Failed to load session: ${error.message}`);
            return false;
        }
    }

    /**
     * Save current session cookies
     */
    async saveSession(context: BrowserContext, username: string): Promise<void> {
        const sessionPath = this.getSessionPath(username);

        try {
            const cookies = await context.cookies();

            const sessionData = {
                username,
                savedAt: new Date().toISOString(),
                cookies,
            };

            fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2));
            this.logger.log(`Saved session for ${username}`);
        } catch (error) {
            this.logger.warn(`Failed to save session: ${error.message}`);
        }
    }

    /**
     * Perform Instagram login
     */
    async login(page: Page): Promise<boolean> {
        const credentials = this.getCredentials();

        if (!credentials) {
            this.logger.warn('No Instagram credentials configured');
            return false;
        }

        try {
            this.logger.log(`Attempting login for ${credentials.username}...`);

            // Navigate to Instagram login page
            await page.goto('https://www.instagram.com/accounts/login/', {
                waitUntil: 'networkidle',
                timeout: 30000,
            });

            await humanDelay('navigate');

            // Wait for and accept cookies if prompted
            try {
                const cookieButton = await page.$('button:has-text("Allow"), button:has-text("Accept")');
                if (cookieButton) {
                    await cookieButton.click();
                    await randomDelay(1000, 2000);
                }
            } catch (e) {
                // No cookie prompt
            }

            // Wait for login form
            await page.waitForSelector('input[name="username"]', { timeout: 10000 });

            // Type username with human-like delays
            const usernameInput = await page.$('input[name="username"]');
            if (usernameInput) {
                await usernameInput.click();
                await randomDelay(200, 500);

                // Type each character with random delay
                for (const char of credentials.username) {
                    await page.keyboard.type(char);
                    await randomDelay(50, 150);
                }
            }

            await randomDelay(500, 1000);

            // Type password
            const passwordInput = await page.$('input[name="password"]');
            if (passwordInput) {
                await passwordInput.click();
                await randomDelay(200, 500);

                for (const char of credentials.password) {
                    await page.keyboard.type(char);
                    await randomDelay(50, 150);
                }
            }

            await randomDelay(500, 1000);

            // Click login button
            const loginButton = await page.$('button[type="submit"]');
            if (loginButton) {
                await loginButton.click();
            }

            // Wait for navigation after login
            await page.waitForNavigation({
                waitUntil: 'networkidle',
                timeout: 30000,
            }).catch(() => { });

            await humanDelay('click');

            // Check if login was successful
            const isLoggedIn = await this.checkLoginStatus(page);

            if (isLoggedIn) {
                this.isLoggedIn = true;
                this.logger.log(`Successfully logged in as ${credentials.username}`);

                // Handle "Save Your Login Info" popup
                await this.handleSaveLoginPopup(page);

                // Handle notifications popup
                await this.handleNotificationsPopup(page);

                // Save session
                await this.saveSession(page.context(), credentials.username);

                return true;
            } else {
                // Check for error messages
                const errorText = await page.$eval(
                    '#slfErrorAlert, [role="alert"]',
                    el => el.textContent
                ).catch(() => null);

                if (errorText) {
                    this.logger.error(`Login failed: ${errorText}`);
                } else {
                    this.logger.error('Login failed: Unknown error');
                }

                return false;
            }
        } catch (error) {
            this.logger.error(`Login error: ${error.message}`);
            return false;
        }
    }

    /**
     * Check if currently logged in
     */
    async checkLoginStatus(page: Page): Promise<boolean> {
        try {
            // Check for elements that only appear when logged in
            const loggedInIndicators = await Promise.all([
                page.$('[aria-label="Home"]'),
                page.$('[aria-label="New post"]'),
                page.$('[aria-label="Search"]'),
                page.$('svg[aria-label="Home"]'),
            ]);

            const isLoggedIn = loggedInIndicators.some(el => el !== null);

            // Also check URL - should not be on login page
            const url = page.url();
            const notOnLoginPage = !url.includes('/accounts/login');

            return isLoggedIn && notOnLoginPage;
        } catch (error) {
            return false;
        }
    }

    /**
     * Handle "Save Your Login Info" popup
     */
    private async handleSaveLoginPopup(page: Page): Promise<void> {
        try {
            // Look for "Save Info" or "Not Now" button
            const saveButton = await page.$('button:has-text("Save Info")');
            if (saveButton) {
                await saveButton.click();
                await randomDelay(1000, 2000);
                this.logger.debug('Clicked "Save Info" on login popup');
            }
        } catch (e) {
            // Popup not present
        }
    }

    /**
     * Handle "Turn On Notifications" popup
     */
    private async handleNotificationsPopup(page: Page): Promise<void> {
        try {
            // Look for "Not Now" button for notifications
            const notNowButton = await page.$('button:has-text("Not Now")');
            if (notNowButton) {
                await notNowButton.click();
                await randomDelay(1000, 2000);
                this.logger.debug('Dismissed notifications popup');
            }
        } catch (e) {
            // Popup not present
        }
    }

    /**
     * Ensure we're logged in (load session or perform login)
     */
    async ensureLoggedIn(page: Page): Promise<boolean> {
        const credentials = this.getCredentials();

        if (!credentials) {
            this.logger.debug('No credentials configured, continuing without login');
            return false;
        }

        // First, try to load saved session
        const sessionLoaded = await this.loadSession(page.context(), credentials.username);

        if (sessionLoaded) {
            // Navigate to Instagram and check if session is valid
            await page.goto('https://www.instagram.com/', {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
            });

            await humanDelay('navigate');

            const isLoggedIn = await this.checkLoginStatus(page);

            if (isLoggedIn) {
                this.isLoggedIn = true;
                this.logger.log('Session is valid, using saved login');
                return true;
            }
        }

        // Session not valid, perform fresh login
        return await this.login(page);
    }

    /**
     * Get login status
     */
    getLoginStatus(): boolean {
        return this.isLoggedIn;
    }

    /**
     * Clear saved session
     */
    clearSession(username: string): void {
        const sessionPath = this.getSessionPath(username);

        if (fs.existsSync(sessionPath)) {
            fs.unlinkSync(sessionPath);
            this.logger.log(`Cleared session for ${username}`);
        }

        this.isLoggedIn = false;
    }
}
