/**
 * Delay Utilities
 * For human-like timing and anti-detection
 */

/**
 * Wait for a specified number of milliseconds
 */
export function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a random duration between min and max milliseconds
 */
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
    const duration = randomBetween(minMs, maxMs);
    return delay(duration);
}

/**
 * Get a random number between min and max (inclusive)
 */
export function randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Exponential backoff delay
 * Used for retry logic after errors
 */
export function exponentialBackoff(
    attempt: number,
    baseDelayMs: number = 1000,
    maxDelayMs: number = 60000,
): number {
    const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
    // Add jitter (±20%)
    const jitter = delay * 0.2 * (Math.random() - 0.5);
    return Math.floor(delay + jitter);
}

/**
 * Human-like delay between actions
 * Simulates reading/thinking time
 */
export async function humanDelay(action: 'scroll' | 'click' | 'read' | 'navigate'): Promise<void> {
    const delays: Record<string, [number, number]> = {
        scroll: [500, 2000],
        click: [100, 500],
        read: [1000, 3000],
        navigate: [2000, 5000],
    };

    const [min, max] = delays[action] || [500, 1500];
    await randomDelay(min, max);
}
