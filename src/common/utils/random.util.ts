/**
 * Random Utilities
 * For fingerprint randomization and anti-detection
 */

import { BrowserFingerprint } from '../interfaces';

// Common user agents (Chrome on Windows/Mac)
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

// Common viewport sizes
const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1600, height: 900 },
];

// Common timezones
const TIMEZONES = [
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'America/Denver',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Asia/Tokyo',
    'Asia/Singapore',
    'Australia/Sydney',
];

// Common languages
const LANGUAGES = [
    'en-US',
    'en-GB',
    'en-CA',
    'en-AU',
];

// Platforms
const PLATFORMS = [
    'Win32',
    'MacIntel',
    'Linux x86_64',
];

/**
 * Get a random item from an array
 */
export function randomItem<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
}

/**
 * Generate a random browser fingerprint
 */
export function generateFingerprint(): BrowserFingerprint {
    return {
        userAgent: randomItem(USER_AGENTS),
        viewport: randomItem(VIEWPORTS),
        timezone: randomItem(TIMEZONES),
        language: randomItem(LANGUAGES),
        platform: randomItem(PLATFORMS),
    };
}

/**
 * Get a random user agent
 */
export function getRandomUserAgent(): string {
    return randomItem(USER_AGENTS);
}

/**
 * Get a random viewport
 */
export function getRandomViewport(): { width: number; height: number } {
    return randomItem(VIEWPORTS);
}

/**
 * Shuffle an array (Fisher-Yates)
 */
export function shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Extract hashtags from text
 */
export function extractHashtags(text: string): string[] {
    const matches = text.match(/#[\w\u0080-\uFFFF]+/g) || [];
    return matches.map((tag) => tag.slice(1).toLowerCase());
}

/**
 * Extract mentions from text
 */
export function extractMentions(text: string): string[] {
    const matches = text.match(/@[\w.]+/g) || [];
    return matches.map((mention) => mention.slice(1).toLowerCase());
}

/**
 * Generate a unique job ID
 */
export function generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
