/**
 * Application Configuration
 * Centralized configuration management
 */

export default () => ({
    // Server
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',

    // Redis
    redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },

    // Proxy
    proxy: {
        list: process.env.PROXY_LIST
            ? process.env.PROXY_LIST.split(',').filter((p) => p.trim())
            : [],
        requestsPerProxy: parseInt(process.env.REQUESTS_PER_PROXY || '50', 10),
    },

    // Instagram Authentication
    instagram: {
        sessionId: process.env.INSTAGRAM_SESSION_ID || '',
        username: process.env.INSTAGRAM_USERNAME || '',
        password: process.env.INSTAGRAM_PASSWORD || '',
    },

    // Scraper
    scraper: {
        maxConcurrentBrowsers: parseInt(process.env.MAX_CONCURRENT_BROWSERS || '3', 10),
        minDelayMs: parseInt(process.env.MIN_DELAY_MS || '3000', 10),
        maxDelayMs: parseInt(process.env.MAX_DELAY_MS || '8000', 10),
        defaultLimit: 100,
        maxLimit: 1000,
    },

    // Rate Limiting
    rateLimit: {
        requestsPerMinute: parseInt(process.env.RATE_LIMIT_REQUESTS_PER_MINUTE || '7', 10),
        requestsPerHour: parseInt(process.env.RATE_LIMIT_REQUESTS_PER_HOUR || '300', 10),
    },

});
