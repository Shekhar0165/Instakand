import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrowserService } from '../core/browser/browser.service';
import { humanDelay, randomDelay } from '../common/utils';

/**
 * AuthService handles Instagram authentication
 * - Manages session cookies
 * - Performs automatic login when session expires
 * - Caches and refreshes session tokens
 */
@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);
    private cachedSessionId: string | null = null;
    private lastLoginAttempt: Date | null = null;
    private loginCooldownMs = 60000; // 1 minute cooldown between login attempts

    constructor(
        private readonly configService: ConfigService,
        private readonly browserService: BrowserService,
    ) {
        // Load initial session ID from config
        this.cachedSessionId = this.configService.get<string>('instagram.sessionId') || null;
        if (this.cachedSessionId) {
            this.logger.log('✓ Initial session ID loaded from config');
        }
    }

    /**
     * Get a valid session ID, refreshing if necessary
     */
    async getSessionId(): Promise<string | null> {
        // Return cached session if available
        if (this.cachedSessionId) {
            return this.cachedSessionId;
        }

        // Try to login if credentials are available
        const username = this.configService.get<string>('instagram.username');
        const password = this.configService.get<string>('instagram.password');

        if (username && password) {
            return await this.login();
        }

        return null;
    }

    /**
     * Force refresh the session by logging in again
     */
    async refreshSession(): Promise<string | null> {
        this.cachedSessionId = null;
        return await this.login();
    }

    /**
     * Attempt to log in to Instagram and extract session cookie
     */
    async login(): Promise<string | null> {
        const username = this.configService.get<string>('instagram.username');
        const password = this.configService.get<string>('instagram.password');

        if (!username || !password) {
            this.logger.warn('Cannot login: INSTAGRAM_USERNAME or INSTAGRAM_PASSWORD not set');
            return null;
        }

        // Check cooldown
        if (this.lastLoginAttempt) {
            const timeSinceLastAttempt = Date.now() - this.lastLoginAttempt.getTime();
            if (timeSinceLastAttempt < this.loginCooldownMs) {
                this.logger.warn(`Login cooldown active, waiting ${Math.ceil((this.loginCooldownMs - timeSinceLastAttempt) / 1000)}s`);
                return this.cachedSessionId;
            }
        }

        this.lastLoginAttempt = new Date();
        this.logger.log(`🔐 Attempting Instagram login for: ${username}`);

        const contextId = `auth_login_${Date.now()}`;
        let sessionId: string | null = null;

        try {
            // Create browser context for login
            await this.browserService.createContext(contextId, null);
            const page = await this.browserService.createPage(contextId);

            // Navigate to Instagram login page
            await page.goto('https://www.instagram.com/accounts/login/', {
                waitUntil: 'domcontentloaded',
                timeout: 60000,
            });

            // Wait for login form to load
            await page.waitForSelector('input[name="username"]', { timeout: 30000 });
            await humanDelay('navigate');

            // Fill in credentials
            this.logger.debug('Filling in credentials...');
            await page.fill('input[name="username"]', username);
            await randomDelay(500, 1000);
            await page.fill('input[name="password"]', password);
            await randomDelay(500, 1000);

            // Click login button
            await page.click('button[type="submit"]');

            // Wait for navigation or error
            try {
                await Promise.race([
                    page.waitForURL('https://www.instagram.com/', { timeout: 30000 }),
                    page.waitForURL('https://www.instagram.com/accounts/onetap/', { timeout: 30000 }),
                    page.waitForSelector('p[data-testid="login-error-message"]', { timeout: 10000 }),
                ]);
            } catch (e) {
                // Check if we're on a challenge page
                const currentUrl = page.url();
                this.logger.debug(`Current URL after login: ${currentUrl}`);
            }

            // Check for login errors
            const errorMessage = await page.$('p[data-testid="login-error-message"]');
            if (errorMessage) {
                const errorText = await errorMessage.textContent();
                this.logger.error(`Login failed: ${errorText}`);
                return null;
            }

            // Check for 2FA or challenge
            const currentUrl = page.url();
            if (currentUrl.includes('challenge') || currentUrl.includes('two_factor')) {
                this.logger.error('Login requires 2FA or challenge verification. Please login manually and update INSTAGRAM_SESSION_ID.');
                return null;
            }

            // Extract session cookie
            await randomDelay(2000, 3000); // Wait for cookies to be set
            const cookies = await page.context().cookies();
            const sessionCookie = cookies.find(c => c.name === 'sessionid');

            if (sessionCookie) {
                sessionId = sessionCookie.value;
                this.cachedSessionId = sessionId;
                this.logger.log('✓ Login successful! Session cookie extracted.');
                this.logger.debug(`Session ID: ${sessionId?.substring(0, 20)}...`);
            } else {
                this.logger.error('Login appeared successful but no sessionid cookie found');
                // Log all cookies for debugging
                this.logger.debug(`Available cookies: ${cookies.map(c => c.name).join(', ')}`);
            }

        } catch (error) {
            this.logger.error(`Login failed: ${error.message}`);
        } finally {
            // Clean up browser context
            try {
                await this.browserService.closeContext(contextId);
            } catch (e) {
                // Ignore cleanup errors
            }
        }

        return sessionId;
    }

    /**
     * Check if we have valid credentials configured
     */
    hasCredentials(): boolean {
        const username = this.configService.get<string>('instagram.username');
        const password = this.configService.get<string>('instagram.password');
        return !!(username && password);
    }

    /**
     * Check if we have a session (either from config or login)
     */
    hasSession(): boolean {
        return !!this.cachedSessionId;
    }

    /**
     * Clear the cached session (call this on 401/403 errors)
     */
    invalidateSession(): void {
        this.logger.warn('Session invalidated - will refresh on next request');
        this.cachedSessionId = null;
    }
}
