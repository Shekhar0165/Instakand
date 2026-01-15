import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { delay, randomBetween } from '../../common/utils';

interface RateLimitBucket {
    tokens: number;
    lastRefill: number;
}

@Injectable()
export class RateLimiterService {
    private readonly logger = new Logger(RateLimiterService.name);

    private readonly requestsPerMinute: number;
    private readonly requestsPerHour: number;
    private readonly minDelayMs: number;
    private readonly maxDelayMs: number;

    // Token buckets for different time windows
    private minuteBucket: RateLimitBucket;
    private hourBucket: RateLimitBucket;

    // Adaptive throttling state
    private consecutiveWarnings: number = 0;
    private lastWarningTime: number = 0;

    constructor(private readonly configService: ConfigService) {
        this.requestsPerMinute = this.configService.get<number>('rateLimit.requestsPerMinute') || 7;
        this.requestsPerHour = this.configService.get<number>('rateLimit.requestsPerHour') || 300;
        this.minDelayMs = this.configService.get<number>('scraper.minDelayMs') || 3000;
        this.maxDelayMs = this.configService.get<number>('scraper.maxDelayMs') || 8000;

        // Initialize buckets
        this.minuteBucket = {
            tokens: this.requestsPerMinute,
            lastRefill: Date.now(),
        };
        this.hourBucket = {
            tokens: this.requestsPerHour,
            lastRefill: Date.now(),
        };

        this.logger.log(
            `Rate limiter initialized: ${this.requestsPerMinute}/min, ${this.requestsPerHour}/hour`,
        );
    }

    /**
     * Acquire a request token (waits if necessary)
     */
    async acquireToken(): Promise<void> {
        await this.refillBuckets();

        // Wait until we have tokens available
        while (this.minuteBucket.tokens <= 0 || this.hourBucket.tokens <= 0) {
            const waitTime = this.getWaitTime();
            this.logger.debug(`Rate limited, waiting ${waitTime}ms`);
            await delay(waitTime);
            await this.refillBuckets();
        }

        // Consume tokens
        this.minuteBucket.tokens--;
        this.hourBucket.tokens--;

        // Add adaptive delay
        const adaptiveDelay = this.getAdaptiveDelay();
        if (adaptiveDelay > 0) {
            await delay(adaptiveDelay);
        }
    }

    /**
     * Refill token buckets based on elapsed time
     */
    private async refillBuckets(): Promise<void> {
        const now = Date.now();

        // Refill minute bucket
        const minuteElapsed = now - this.minuteBucket.lastRefill;
        if (minuteElapsed >= 60000) {
            this.minuteBucket.tokens = this.requestsPerMinute;
            this.minuteBucket.lastRefill = now;
        } else {
            // Partial refill
            const tokensToAdd = Math.floor(
                (minuteElapsed / 60000) * this.requestsPerMinute,
            );
            if (tokensToAdd > 0) {
                this.minuteBucket.tokens = Math.min(
                    this.requestsPerMinute,
                    this.minuteBucket.tokens + tokensToAdd,
                );
                this.minuteBucket.lastRefill = now;
            }
        }

        // Refill hour bucket
        const hourElapsed = now - this.hourBucket.lastRefill;
        if (hourElapsed >= 3600000) {
            this.hourBucket.tokens = this.requestsPerHour;
            this.hourBucket.lastRefill = now;
        } else {
            // Partial refill
            const tokensToAdd = Math.floor(
                (hourElapsed / 3600000) * this.requestsPerHour,
            );
            if (tokensToAdd > 0) {
                this.hourBucket.tokens = Math.min(
                    this.requestsPerHour,
                    this.hourBucket.tokens + tokensToAdd,
                );
                this.hourBucket.lastRefill = now;
            }
        }
    }

    /**
     * Get the time to wait before next request is allowed
     */
    private getWaitTime(): number {
        const now = Date.now();
        let waitTime = 1000; // Default 1 second

        if (this.minuteBucket.tokens <= 0) {
            const timeUntilRefill = 60000 - (now - this.minuteBucket.lastRefill);
            waitTime = Math.max(waitTime, timeUntilRefill / this.requestsPerMinute);
        }

        if (this.hourBucket.tokens <= 0) {
            const timeUntilRefill = 3600000 - (now - this.hourBucket.lastRefill);
            waitTime = Math.max(waitTime, timeUntilRefill / this.requestsPerHour);
        }

        return Math.min(waitTime, 30000); // Cap at 30 seconds
    }

    /**
     * Get adaptive delay based on warning state
     * Implements Apify-style adaptive throttling
     */
    private getAdaptiveDelay(): number {
        // Base random delay
        let baseDelay = randomBetween(this.minDelayMs, this.maxDelayMs);

        // If we've had recent warnings, increase delay
        if (this.consecutiveWarnings > 0) {
            const multiplier = Math.min(1 + this.consecutiveWarnings * 0.5, 3);
            baseDelay = Math.floor(baseDelay * multiplier);
            this.logger.debug(
                `Adaptive throttling active: ${this.consecutiveWarnings} warnings, delay=${baseDelay}ms`,
            );
        }

        // Decay warnings over time
        if (Date.now() - this.lastWarningTime > 300000) {
            // 5 minutes
            this.consecutiveWarnings = Math.max(0, this.consecutiveWarnings - 1);
        }

        return baseDelay;
    }

    /**
     * Report a warning (CAPTCHA, slow response, etc.)
     * This increases the adaptive delay
     */
    reportWarning(): void {
        this.consecutiveWarnings++;
        this.lastWarningTime = Date.now();
        this.logger.warn(
            `Warning reported, consecutive warnings: ${this.consecutiveWarnings}`,
        );
    }

    /**
     * Report successful request (can decrease throttling)
     */
    reportSuccess(): void {
        // Slowly decrease warnings on success
        if (this.consecutiveWarnings > 0 && Math.random() > 0.7) {
            this.consecutiveWarnings--;
        }
    }

    /**
     * Get current rate limiter status
     */
    getStatus(): {
        minuteTokens: number;
        hourTokens: number;
        consecutiveWarnings: number;
        isThrottled: boolean;
    } {
        return {
            minuteTokens: this.minuteBucket.tokens,
            hourTokens: this.hourBucket.tokens,
            consecutiveWarnings: this.consecutiveWarnings,
            isThrottled: this.minuteBucket.tokens <= 0 || this.hourBucket.tokens <= 0,
        };
    }

    /**
     * Force wait (used after errors or CAPTCHAs)
     */
    async forceWait(durationMs: number): Promise<void> {
        this.logger.warn(`Forcing wait for ${durationMs}ms`);
        await delay(durationMs);
    }

    /**
     * Reset rate limiter (use with caution)
     */
    reset(): void {
        this.minuteBucket = {
            tokens: this.requestsPerMinute,
            lastRefill: Date.now(),
        };
        this.hourBucket = {
            tokens: this.requestsPerHour,
            lastRefill: Date.now(),
        };
        this.consecutiveWarnings = 0;
        this.logger.log('Rate limiter reset');
    }
}
