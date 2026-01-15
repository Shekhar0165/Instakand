# 📸 Instakand

> **Free, open-source Instagram scraper** — Self-host and scale on your own infrastructure!

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![NestJS](https://img.shields.io/badge/NestJS-11.x-red.svg)](https://nestjs.com/)
[![Playwright](https://img.shields.io/badge/Playwright-1.x-green.svg)](https://playwright.dev/)
[![Docker](https://img.shields.io/badge/Docker-Ready-blue.svg)](https://docker.com/)

---

## 🎯 Why Instakand?

| Feature | Instakand |
|---------|-----------|
| **Cost** | **Free forever** |
| **Self-hosted** | ✅ Your data stays with you |
| **Open Source** | ✅ Fully customizable |
| **Scalable** | ✅ Scale on your infrastructure |
| **Anti-Detection** | ✅ Proxy rotation & rate limiting |

---

## ✨ Features

- 📱 **Profile Scraping** - Get user profiles and their posts
- #️⃣ **Hashtag Scraping** - Scrape posts by hashtag with pagination
- 📷 **Post Scraping** - Extract individual post details
- 💬 **Comment Scraping** - Get all comments from posts
- 🎬 **Reel Scraping** - Scrape reels from profiles
- 🔍 **Global Search** - Search posts and reels by keyword
- 📍 **Location Scraping** - Get posts by location

### Anti-Detection Features

- 🔄 **Proxy Rotation** - Rotate through multiple proxies
- ⏱️ **Adaptive Rate Limiting** - Smart delays to avoid blocks
- 🎭 **Browser Fingerprinting** - Randomized browser fingerprints
- 🧠 **Human-like Behavior** - Natural scrolling and delays
- 🔁 **Smart Retry** - Exponential backoff on failures

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Docker (recommended)

### Option 1: Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/Shekhar0165/Instakand.git
cd instakand

# Copy environment file
cp .env.example .env

# Start with Docker
docker-compose up -d

# Access the API
open http://localhost:3000/api
```

### Option 2: Local Development

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Start development server
npm run start:dev
```

---

## 📖 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/scraper/profile` | Scrape a user profile |
| `POST` | `/scraper/hashtag` | Scrape posts by hashtag |
| `POST` | `/scraper/post` | Scrape a single post |
| `POST` | `/scraper/comments` | Scrape comments from a post |
| `POST` | `/scraper/reels` | Scrape reels from a profile |
| `POST` | `/scraper/search` | Global search across Instagram |
| `POST` | `/scraper/direct-urls` | Scrape multiple URLs at once |
| `GET` | `/scraper/system-status` | Get system health status |

### Example: Scrape a Profile

```bash
curl -X POST http://localhost:3000/scraper/profile \
  -H "Content-Type: application/json" \
  -d '{"username": "natgeo", "includePosts": true, "postsLimit": 12}'
```

### Example: Search Posts

```bash
curl -X POST http://localhost:3000/scraper/search \
  -H "Content-Type: application/json" \
  -d '{"keyword": "travel", "searchLimit": 100, "resultLimit": 50}'
```

---

## 📊 Scaling Guide

Instakand is designed to scale with your needs:

### Single Server (1-100 users)
```bash
docker-compose up -d
```

### Multi-Worker (100-10,000 users)
```bash
docker-compose up -d --scale app=3
```

### Enterprise (10,000+ users)
- Deploy on Kubernetes
- Use Redis Cluster
- Add PostgreSQL for persistence
- Rotate 1000+ residential proxies

### Estimated Capacity

| Setup | Concurrent Jobs | Posts/Hour |
|-------|----------------|------------|
| Single instance | 3 | ~500 |
| 3 workers | 9 | ~1,500 |
| 10 workers | 30 | ~5,000 |

---

## ⚙️ Configuration

Create a `.env` file:

```env
# Server
PORT=3000
NODE_ENV=production

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Proxies (recommended for high volume)
PROXY_LIST=http://user:pass@proxy1.com:8080,http://user:pass@proxy2.com:8080

# Rate Limiting
RATE_LIMIT_REQUESTS_PER_MINUTE=7
RATE_LIMIT_REQUESTS_PER_HOUR=300

# Instagram Auth (optional - for full access)
INSTAGRAM_USERNAME=your_username
INSTAGRAM_PASSWORD=your_password
```

---

## 🔐 Authentication (Optional)

For full access to hashtags and explore features, add Instagram credentials:

> ⚠️ **Use a secondary account, NOT your main account!**

Benefits:
- Access hashtag pages requiring login
- Use Instagram's search features
- Higher rate limits
- Better success rate

---

## 🏗️ Architecture

```
src/
├── common/           # Config, interfaces, utilities
├── core/
│   ├── browser/      # Playwright browser management
│   ├── proxy/        # Proxy rotation
│   └── rate-limiter/ # Adaptive rate limiting
├── data/             # JSON export service
├── scraper/
│   ├── strategies/   # Scraping strategies (profile, hashtag, etc.)
│   ├── dto/          # Data transfer objects
│   ├── scraper.controller.ts
│   └── scraper.service.ts
└── main.ts
```

---

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## ⚠️ Disclaimer

This tool is for **educational and personal use only**. Scraping Instagram may violate their Terms of Service. Use responsibly and at your own risk.

- Only scrape public data
- Respect rate limits
- Don't use for commercial purposes without proper authorization

---

## 🌟 Star History

If you find Instakand useful, please give it a ⭐ on GitHub!

---

Made with ❤️ by [Shekhar Kashyap](https://github.com/Shekhar0165)
