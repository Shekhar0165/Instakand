# 🔍 How Instagram Scraper Works

This document explains the technical implementation of the Instagram Scraper - how we extract data from Instagram without using their official API.

---

## 📚 Table of Contents

1. [Overview](#overview)
2. [Core Technologies](#core-technologies)
3. [Hashtag Scraping Strategies](#hashtag-scraping-strategies)
4. [Post Scraping](#post-scraping)
5. [Search Functionality](#search-functionality)
6. [Anti-Detection Measures](#anti-detection-measures)
7. [Data Flow Diagram](#data-flow-diagram)

---

## Overview

Instagram doesn't provide a public API for scraping posts. So we use **browser automation** (Playwright) to simulate a real user browsing Instagram, and we intercept the data that Instagram sends to the browser.

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Our API   │ ──▶ │  Playwright  │ ──▶ │  Instagram  │
│   Request   │     │   Browser    │     │   Website   │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  Intercept   │
                    │  JSON Data   │
                    └──────────────┘
```

---

## Core Technologies

### 1. **Playwright** (Browser Automation)
- Opens a real Chromium browser
- Navigates to Instagram pages
- Simulates human-like scrolling and clicking
- Intercepts network responses containing JSON data

### 2. **NestJS** (Backend Framework)
- Provides REST API endpoints
- Manages dependency injection
- Handles request/response lifecycle

### 3. **GraphQL API Interception**
- Instagram's frontend communicates with backend via GraphQL
- We capture these GraphQL responses to extract structured data

---

## Hashtag Scraping Strategies

When you search for a hashtag like `#travel`, we use **4 different strategies** in order. If one fails, we try the next.

### Strategy 1: Direct GraphQL API Call ⭐ (Most Effective)

**How it works:**
```
1. Visit instagram.com to get cookies/session
2. Extract CSRF token from cookies
3. Call Instagram's GraphQL API directly with the hashtag query
4. Parse the JSON response
```

**Technical Details:**
```typescript
// GraphQL endpoint we call
const url = `https://www.instagram.com/graphql/query/?query_hash=${QUERY_HASH}&variables=${variables}`;

// Variables sent to the API
const variables = {
    tag_name: "travel",      // The hashtag
    first: 50,               // Number of posts to fetch
    after: null              // Pagination cursor
};

// Headers that make it look like a real browser request
const headers = {
    'X-CSRFToken': csrfToken,
    'X-IG-App-ID': '936619743392459',  // Instagram's web app ID
    'X-Requested-With': 'XMLHttpRequest'
};
```

**What we get back:**
```json
{
  "data": {
    "hashtag": {
      "id": "17841563188018306",
      "name": "travel",
      "edge_hashtag_to_media": {
        "count": 683000000,
        "edges": [
          {
            "node": {
              "id": "3012345678901234567",
              "shortcode": "CxYz123ABC",
              "display_url": "https://...",
              "edge_liked_by": { "count": 1234 },
              "edge_media_to_caption": {
                "edges": [{ "node": { "text": "Beautiful sunset #travel" }}]
              }
            }
          }
        ]
      }
    }
  }
}
```

---

### Strategy 2: Web Page + Network Interception

**How it works:**
```
1. Navigate browser to instagram.com/explore/tags/travel/
2. Listen for all network responses
3. Capture any GraphQL/API responses
4. Scroll the page to trigger more API calls
5. Parse captured data
```

**Technical Details:**
```typescript
// Set up response listener BEFORE navigating
page.on('response', async (response) => {
    const url = response.url();
    
    // Check if this is an API response
    if (url.includes('/graphql') || url.includes('query_hash')) {
        const json = await response.json();
        capturedData.push(json);
    }
});

// Navigate to hashtag page
await page.goto('https://www.instagram.com/explore/tags/travel/');

// Scroll to trigger more API calls
for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 1000));
    await delay(1500);
}
```

---

### Strategy 3: Instagram Search API

**How it works:**
```
1. Call Instagram's top search API
2. Get hashtag metadata (post count, ID)
3. Use this info for further scraping
```

**Technical Details:**
```typescript
const searchUrl = `https://www.instagram.com/web/search/topsearch/?context=hashtag&query=%23travel`;

// Response contains:
{
  "hashtags": [
    {
      "hashtag": {
        "name": "travel",
        "id": 17841563188018306,
        "media_count": 683000000,
        "profile_pic_url": "https://..."
      }
    }
  ]
}
```

---

### Strategy 4: Mobile Web Version

**How it works:**
```
1. Set mobile user agent (pretend to be iPhone)
2. Navigate to hashtag page
3. Extract post links from the DOM
4. Mobile version sometimes has less restrictions
```

**Technical Details:**
```typescript
// Set mobile user agent
await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)...'
});

// Extract post links from DOM
const postLinks = await page.$$eval('a[href*="/p/"], a[href*="/reel/"]', 
    links => links.map(link => ({
        href: link.getAttribute('href'),
        img: link.querySelector('img')?.getAttribute('src')
    }))
);
```

---

## Post Scraping

When scraping a single post (like `instagram.com/p/ABC123/`):

### Method 1: Embedded JSON Data

Instagram embeds post data directly in the HTML page:

```typescript
// Navigate to post
await page.goto('https://www.instagram.com/p/ABC123/');

// Find the embedded JSON in a script tag
const scriptContent = await page.$eval(
    'script[type="application/ld+json"]',
    el => el.textContent
);

// Parse it
const postData = JSON.parse(scriptContent);
```

### Method 2: Network Interception

```typescript
// Listen for API responses
page.on('response', async (response) => {
    if (response.url().includes('/graphql')) {
        const json = await response.json();
        if (json.data?.shortcode_media) {
            postData = json.data.shortcode_media;
        }
    }
});

await page.goto('https://www.instagram.com/p/ABC123/');
```

### Method 3: DOM Extraction

```typescript
// Extract from page elements
const caption = await page.$eval(
    'meta[property="og:description"]',
    el => el.getAttribute('content')
);

const image = await page.$eval(
    'meta[property="og:image"]',
    el => el.getAttribute('content')
);
```

---

## Search Functionality

The global search uses a **multi-strategy approach**:

```
┌─────────────────────────────────────────────────────────────┐
│                     SEARCH: "travel"                         │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  STRATEGY 1: Hashtag Search                                  │
│  - Convert "travel" → #travel                                │
│  - Use all 4 hashtag strategies above                        │
│  - Collect posts from #travel                                │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  STRATEGY 2: Explore Page Search                             │
│  - Go to instagram.com/explore/                              │
│  - Click search button                                       │
│  - Type keyword and capture results                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  STRATEGY 3: Reels Explore                                   │
│  - Go to instagram.com/reels/                                │
│  - Scroll and capture reel posts                             │
│  - Filter by keyword match in captions                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  COMBINE & DEDUPLICATE                                       │
│  - Remove duplicate shortcodes                               │
│  - Return up to resultLimit posts                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Anti-Detection Measures

Instagram tries to block scrapers. We use several techniques to avoid detection:

### 1. Human-like Delays
```typescript
// Random delay between 2-5 seconds
async function humanDelay() {
    const delay = 2000 + Math.random() * 3000;
    await new Promise(r => setTimeout(r, delay));
}
```

### 2. Browser Fingerprint Randomization
```typescript
const fingerprints = [
    { 
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)...',
        viewport: { width: 1920, height: 1080 },
        timezone: 'America/New_York'
    },
    // ... more fingerprints
];

// Pick random fingerprint for each session
const fp = fingerprints[Math.floor(Math.random() * fingerprints.length)];
```

### 3. Proxy Rotation
```typescript
// Rotate between multiple proxies
const proxies = ['proxy1.com:8080', 'proxy2.com:8080'];
let currentProxy = 0;

function getNextProxy() {
    const proxy = proxies[currentProxy];
    currentProxy = (currentProxy + 1) % proxies.length;
    return proxy;
}
```

### 4. Rate Limiting
```typescript
// Limit requests per minute/hour
const REQUESTS_PER_MINUTE = 7;
const REQUESTS_PER_HOUR = 300;

async function acquireToken() {
    // Wait if we've exceeded limits
    while (requestsThisMinute >= REQUESTS_PER_MINUTE) {
        await delay(10000);
    }
    requestsThisMinute++;
}
```

### 5. Exponential Backoff on Errors
```typescript
let backoffTime = 1000;

async function makeRequest() {
    try {
        const result = await scrape();
        backoffTime = 1000; // Reset on success
        return result;
    } catch (error) {
        await delay(backoffTime);
        backoffTime *= 2; // Double the wait time
        return makeRequest(); // Retry
    }
}
```

---

## Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         USER REQUEST                              │
│                    POST /scraper/hashtag                          │
│                    { "hashtag": "travel" }                        │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                      SCRAPER CONTROLLER                           │
│              scraper.controller.ts                                │
│                                                                   │
│   • Validate request (DTO validation)                             │
│   • Call ScraperService                                           │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                       SCRAPER SERVICE                             │
│               scraper.service.ts                                  │
│                                                                   │
│   • Create job record                                             │
│   • Acquire rate limit token                                      │
│   • Get proxy from pool                                           │
│   • Create browser context                                        │
│   • Call HashtagStrategy                                          │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                      BROWSER SERVICE                              │
│            core/browser/browser.service.ts                        │
│                                                                   │
│   • Launch Chromium browser                                       │
│   • Apply fingerprint (user agent, viewport)                      │
│   • Configure proxy                                               │
│   • Return Page object                                            │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                     HASHTAG STRATEGY                              │
│         scraper/strategies/hashtag.strategy.ts                    │
│                                                                   │
│   • Try Strategy 1: Direct GraphQL API                            │
│   • Try Strategy 2: Web Page + Network Interception               │
│   • Try Strategy 3: Search API                                    │
│   • Try Strategy 4: Mobile Web                                    │
│   • Return posts array                                            │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                       DATA SERVICE                                │
│                 data/data.service.ts                              │
│                                                                   │
│   • Save posts to JSON file                                       │
│   • Update job status                                             │
│   • Return output file path                                       │
└──────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                        RESPONSE                                   │
│                                                                   │
│   {                                                               │
│     "success": true,                                              │
│     "job": { "id": "...", "status": "completed" },                │
│     "data": {                                                     │
│       "hashtag": { "name": "travel", "postsCount": 683000000 },   │
│       "posts": [ ... ],                                           │
│       "count": 50                                                 │
│     }                                                             │
│   }                                                               │
└──────────────────────────────────────────────────────────────────┘
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/scraper/scraper.controller.ts` | API endpoints |
| `src/scraper/scraper.service.ts` | Business logic, orchestration |
| `src/scraper/strategies/hashtag.strategy.ts` | Hashtag scraping (4 strategies) |
| `src/scraper/strategies/post.strategy.ts` | Single post scraping |
| `src/scraper/strategies/profile.strategy.ts` | Profile scraping |
| `src/core/browser/browser.service.ts` | Playwright browser management |
| `src/core/proxy/proxy.service.ts` | Proxy rotation |
| `src/core/rate-limiter/rate-limiter.service.ts` | Rate limiting |
| `src/data/data.service.ts` | JSON file output |

---

## Why Instagram Blocks Us

Instagram blocks unauthenticated scraping because:

1. **Rate Limiting** - Too many requests from same IP
2. **Bot Detection** - Unnatural browsing patterns
3. **Login Wall** - Many pages require authentication
4. **GraphQL Protection** - Query hashes change periodically

### Solutions:

1. **Add Login Support** - Authenticate with Instagram account ✅ (Now implemented!)
2. **Use Residential Proxies** - IPs that look like real users
3. **Slow Down** - Reduce request frequency
4. **Keep Updated** - Update query hashes when they change

---

## 🔐 Authentication System

The scraper now includes full authentication support:

### How It Works

```
┌────────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Check for     │ ──▶ │  Load saved     │ ──▶ │  Verify session  │
│  credentials   │     │  session        │     │  is valid        │
└────────────────┘     └─────────────────┘     └──────────────────┘
                                                       │
                              ┌─────────────┐          │
                              │  Sessions   │          ▼
                              │  folder     │◀── If invalid, login
                              └─────────────┘
```

### Session Persistence

Sessions are saved to `sessions/{username}_session.json`:

```json
{
  "username": "my_account",
  "savedAt": "2024-01-15T10:30:00.000Z",
  "cookies": [
    { "name": "sessionid", "value": "...", "domain": ".instagram.com" },
    { "name": "csrftoken", "value": "...", "domain": ".instagram.com" }
  ]
}
```

### Login Flow

```typescript
// 1. Check if session exists and is valid
const sessionLoaded = await loadSession(context, username);

if (sessionLoaded) {
    // 2. Navigate to Instagram and verify
    const isValid = await checkLoginStatus(page);
    if (isValid) return true; // Use saved session
}

// 3. Perform fresh login
await page.goto('https://www.instagram.com/accounts/login/');
await page.fill('input[name="username"]', username);
await page.fill('input[name="password"]', password);
await page.click('button[type="submit"]');

// 4. Save session for next time
await saveSession(context, username);
```

### Key Files

| File | Purpose |
|------|---------|
| `src/core/auth/auth.service.ts` | Login, session management |
| `src/core/auth/auth.module.ts` | Auth module |
| `sessions/` | Saved session cookies |

---

## Summary

The Instagram Scraper works by:

1. **Launching a real browser** (Playwright/Chromium)
2. **Navigating to Instagram pages** like a real user
3. **Intercepting API responses** that Instagram sends to the browser
4. **Parsing the JSON data** to extract posts, profiles, etc.
5. **Using anti-detection measures** to avoid being blocked

The key insight is that Instagram's web app receives all its data via GraphQL API calls, and we can capture and parse those same responses!
