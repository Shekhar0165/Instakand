import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * RateLimiterService - Implements anti-ban techniques
 * 
 * Key techniques used to avoid Instagram bans:
 * 1. Sticky sessions (same IP for 5-10 minutes)
 * 2. Human-like delays (3-10 seconds between requests)
 * 3. Request counting per session
 * 4. Automatic cooldown when approaching limits
 * 5. Exponential backoff on errors
 */
@Injectable()
export class RateLimiterService {
    private readonly logger = new Logger(RateLimiterService.name);

    // Configuration
    private readonly minDelayMs: number;
    private readonly maxDelayMs: number;
    private readonly requestsPerMinute: number;
    private readonly requestsPerHour: number;
    private readonly maxRequestsPerSession: number;

    // State tracking
    private requestTimestamps: number[] = [];
    private sessionRequestCount = 0;
    private sessionStartTime = Date.now();
    private consecutiveErrors = 0;
    private isInCooldown = false;
    private cooldownUntil = 0;

    constructor(private readonly configService: ConfigService) {
        this.minDelayMs = this.configService.get<number>('scraper.minDelayMs') || 3000;
        this.maxDelayMs = this.configService.get<number>('scraper.maxDelayMs') || 8000;
        this.requestsPerMinute = this.configService.get<number>('rateLimit.requestsPerMinute') || 7;
        this.requestsPerHour = this.configService.get<number>('rateLimit.requestsPerHour') || 300;
        this.maxRequestsPerSession = this.configService.get<number>('rateLimit.maxRequestsPerSession') || 50;

        this.logger.log(`Rate limiter initialized: ${this.requestsPerMinute} req/min, ${this.requestsPerHour} req/hour`);
    }

    /**
     * Wait before making a request - implements human-like delays
     * This is the CRITICAL anti-ban technique
     */
    async waitBeforeRequest(): Promise<void> {
        // Check if in cooldown
        if (this.isInCooldown && Date.now() < this.cooldownUntil) {
            const waitTime = this.cooldownUntil - Date.now();
            this.logger.warn(`⏳ In cooldown, waiting ${Math.ceil(waitTime / 1000)}s...`);
            await this.sleep(waitTime);
            this.isInCooldown = false;
        }

        // Check rate limits
        await this.enforceRateLimits();

        // Add human-like delay with random variance
        const delay = this.calculateDelay();
        this.logger.debug(`⏳ Waiting ${delay}ms before next request...`);
        await this.sleep(delay);

        // Record this request
        this.recordRequest();
    }

    /**
     * Calculate delay with human-like variance
     * Apify uses 3-10 second delays with random variance
     */
    private calculateDelay(): number {
        // Base delay
        let delay = this.minDelayMs + Math.random() * (this.maxDelayMs - this.minDelayMs);

        // Add extra delay if we've made many requests this session
        if (this.sessionRequestCount > 20) {
            delay *= 1.2; // 20% slower after 20 requests
        }
        if (this.sessionRequestCount > 40) {
            delay *= 1.5; // 50% slower after 40 requests
        }

        // Add exponential backoff on consecutive errors
        if (this.consecutiveErrors > 0) {
            delay *= Math.pow(2, this.consecutiveErrors);
            delay = Math.min(delay, 60000); // Cap at 1 minute
        }

        // Add small random variance (±10%) to avoid patterns
        const variance = delay * 0.1;
        delay += (Math.random() - 0.5) * 2 * variance;

        return Math.floor(delay);
    }

    /**
     * Enforce rate limits by waiting if necessary
     */
    private async enforceRateLimits(): Promise<void> {
        const now = Date.now();

        // Clean old timestamps
        this.requestTimestamps = this.requestTimestamps.filter(ts => now - ts < 3600000);

        // Check per-minute limit
        const lastMinuteRequests = this.requestTimestamps.filter(ts => now - ts < 60000).length;
        if (lastMinuteRequests >= this.requestsPerMinute) {
            const oldestInMinute = this.requestTimestamps.find(ts => now - ts < 60000);
            const waitTime = oldestInMinute ? 60000 - (now - oldestInMinute) + 1000 : 60000;
            this.logger.warn(`⚠️ Rate limit: ${lastMinuteRequests} requests in last minute, waiting ${Math.ceil(waitTime / 1000)}s`);
            await this.sleep(waitTime);
        }

        // Check per-hour limit
        if (this.requestTimestamps.length >= this.requestsPerHour) {
            const oldestInHour = this.requestTimestamps[0];
            const waitTime = oldestInHour ? 3600000 - (now - oldestInHour) + 1000 : 60000;
            this.logger.warn(`⚠️ Hourly limit: ${this.requestTimestamps.length} requests, waiting ${Math.ceil(waitTime / 1000)}s`);
            await this.sleep(Math.min(waitTime, 300000)); // Max 5 minute wait
        }

        // Check session limit
        if (this.sessionRequestCount >= this.maxRequestsPerSession) {
            this.logger.warn(`⚠️ Session limit reached (${this.sessionRequestCount} requests), starting new session`);
            this.resetSession();
        }
    }

    /**
     * Record a request for rate limiting
     */
    private recordRequest(): void {
        this.requestTimestamps.push(Date.now());
        this.sessionRequestCount++;
    }

    /**
     * Report a successful request - resets error counter
     */
    reportSuccess(): void {
        this.consecutiveErrors = 0;
    }

    /**
     * Report an error - triggers exponential backoff
     */
    reportError(statusCode?: number): void {
        this.consecutiveErrors++;

        // Specific handling for rate limit errors
        if (statusCode === 429) {
            this.logger.error('🚫 Rate limited (429)! Entering 5-minute cooldown...');
            this.triggerCooldown(5 * 60 * 1000);
        } else if (statusCode === 401 || statusCode === 403) {
            this.logger.error(`🚫 Auth error (${statusCode})! May need session refresh.`);
            this.triggerCooldown(60 * 1000); // 1 minute cooldown
        } else {
            this.logger.warn(`Request failed (consecutive errors: ${this.consecutiveErrors})`);
        }
    }

    /**
     * Trigger a cooldown period
     */
    triggerCooldown(durationMs: number): void {
        this.isInCooldown = true;
        this.cooldownUntil = Date.now() + durationMs;
        this.logger.warn(`⏳ Cooldown triggered for ${Math.ceil(durationMs / 1000)}s`);
    }

    /**
     * Reset the session (for sticky sessions - change IP after X requests)
     */
    resetSession(): void {
        this.sessionRequestCount = 0;
        this.sessionStartTime = Date.now();
        this.logger.debug('Session reset - ready for new IP/session');
    }

    /**
     * Get current session stats
     */
    getStats(): {
        sessionRequests: number;
        sessionDuration: number;
        requestsLastMinute: number;
        requestsLastHour: number;
        consecutiveErrors: number;
        isInCooldown: boolean;
    } {
        const now = Date.now();
        return {
            sessionRequests: this.sessionRequestCount,
            sessionDuration: Math.floor((now - this.sessionStartTime) / 1000),
            requestsLastMinute: this.requestTimestamps.filter(ts => now - ts < 60000).length,
            requestsLastHour: this.requestTimestamps.length,
            consecutiveErrors: this.consecutiveErrors,
            isInCooldown: this.isInCooldown && now < this.cooldownUntil,
        };
    }

    /**
     * Check if we should rotate proxy/session (sticky session logic)
     * Apify recommends 15-30 requests per IP, or 5-10 minutes
     */
    shouldRotateSession(): boolean {
        const sessionDuration = Date.now() - this.sessionStartTime;
        const maxSessionDuration = 5 * 60 * 1000 + Math.random() * 5 * 60 * 1000; // 5-10 minutes

        return (
            this.sessionRequestCount >= this.maxRequestsPerSession ||
            sessionDuration >= maxSessionDuration
        );
    }

    /**
     * Helper to sleep for a given duration
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
