/**
 * Instagram Scraper - Data Interfaces
 * All scraped data types are defined here
 */

// ============ Profile Data ============
export interface ProfileData {
    id: string;
    username: string;
    fullName: string;
    bio: string;
    profilePicUrl: string;
    profilePicUrlHd?: string;
    followersCount: number;
    followingCount: number;
    postsCount: number;
    isVerified: boolean;
    isPrivate: boolean;
    isBusiness: boolean;
    businessCategory?: string;
    externalUrl?: string;
    scrapedAt: Date;
}

// ============ Post Data ============
export interface PostData {
    id: string;
    shortcode: string;
    url: string;
    type: 'image' | 'video' | 'carousel' | 'reel';
    caption: string;
    likesCount: number;
    commentsCount: number;
    viewsCount?: number; // For videos/reels
    mediaUrl: string;
    thumbnailUrl: string;
    allMediaUrls?: string[]; // For carousels
    ownerUsername: string;
    ownerId: string;
    timestamp: Date;
    location?: LocationData;
    hashtags: string[];
    mentions: string[];
    isSponsored: boolean;
    scrapedAt: Date;
}

// ============ Comment Data ============
export interface CommentData {
    id: string;
    text: string;
    ownerUsername: string;
    ownerId: string;
    ownerProfilePic?: string;
    likesCount: number;
    timestamp: Date;
    postId: string;
    postShortcode: string;
    replies?: CommentData[];
    scrapedAt: Date;
}

// ============ Reel Data ============
export interface ReelData extends PostData {
    duration: number;
    playsCount: number;
    audioTitle?: string;
    audioArtist?: string;
}

// ============ Location Data ============
export interface LocationData {
    id: string;
    name: string;
    slug: string;
    address?: string;
    city?: string;
    latitude?: number;
    longitude?: number;
}

// ============ Hashtag Data ============
export interface HashtagData {
    id: string;
    name: string;
    postsCount: number;
    profilePicUrl?: string;
    scrapedAt: Date;
}

// ============ Scrape Job ============
export type ScrapeType = 'profile' | 'hashtag' | 'post' | 'comments' | 'reels' | 'search' | 'direct_urls';

export type ScrapeStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ScrapeJob {
    id: string;
    type: ScrapeType;
    status: ScrapeStatus;
    input: ScrapeInput;
    progress: number;
    totalItems: number;
    scrapedItems: number;
    error?: string;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
}

export interface ScrapeInput {
    // For profile scraping
    username?: string;

    // For hashtag scraping
    hashtag?: string;

    // For single post scraping
    postUrl?: string;
    shortcode?: string;


    // For search/caption scraping
    keyword?: string;
    searchLimit?: number;
    resultLimit?: number;

    // For direct URLs scraping
    urls?: string[];
    postsLimit?: number;

    // Common options
    limit?: number;
    page?: number;
    includeComments?: boolean;
    commentsLimit?: number;
}

// ============ Scrape Result ============
export interface ScrapeResult<T> {
    success: boolean;
    data?: T;
    error?: string;
    scrapedAt: Date;
}

// ============ Proxy Config ============
export interface ProxyConfig {
    protocol: 'http' | 'https' | 'socks5';
    host: string;
    port: number;
    username?: string;
    password?: string;
    isActive: boolean;
    failCount: number;
    lastUsed?: Date;
}

// ============ Browser Fingerprint ============
export interface BrowserFingerprint {
    userAgent: string;
    viewport: {
        width: number;
        height: number;
    };
    timezone: string;
    language: string;
    platform: string;
}
