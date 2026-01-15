# 🚀 Instakand Setup Guide

Complete installation guide for Docker and local development setups.

---

## Prerequisites

- **Node.js** 18+ (for local setup)
- **Docker & Docker Compose** (for Docker setup)
- **Git**

---

## Option 1: Docker Setup (Recommended)

Docker is the easiest way to get started - everything runs in containers.

### Step 1: Clone the Repository

```bash
git clone https://github.com/Shekhar0165/Instakand.git
cd instakand
```

### Step 2: Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your settings (optional)
nano .env  # or use any text editor
```

### Step 3: Start with Docker Compose

```bash
# Build and start all services
docker-compose up -d --build

# View logs
docker-compose logs -f app
```

### Step 4: Verify Installation

- **API**: http://localhost:3000
- **Swagger Docs**: http://localhost:3000/api
- **Health Check**: http://localhost:3000/scraper/system-status

### Docker Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f app

# Restart app only
docker-compose restart app

# Scale workers (for high volume)
docker-compose up -d --scale app=3

# Rebuild after code changes
docker-compose up -d --build
```

---

## Option 2: Local Development Setup

For development or when you prefer running directly on your machine.

### Step 1: Clone the Repository

```bash
git clone https://github.com/yourusername/instakand.git
cd instakand
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Install Playwright Browsers

```bash
npx playwright install chromium
```

### Step 4: Setup Redis

Redis is required for the job queue. Choose one option:

**Option A: Docker (easiest)**
```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

**Option B: Local Installation**
- Windows: Use [Memurai](https://www.memurai.com/) or WSL
- macOS: `brew install redis && brew services start redis`
- Linux: `sudo apt install redis-server && sudo systemctl start redis`

### Step 5: Configure Environment

```bash
# Copy example environment file
cp .env.example .env
```

Edit `.env` with your settings:
```env
PORT=3000
NODE_ENV=development
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Step 6: Start the Application

```bash
# Development mode (with hot reload)
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

### Step 7: Verify Installation

- **API**: http://localhost:3000
- **Swagger Docs**: http://localhost:3000/api

---

## ⚙️ Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `NODE_ENV` | development | Environment mode |
| `REDIS_HOST` | localhost | Redis hostname |
| `REDIS_PORT` | 6379 | Redis port |
| `PROXY_LIST` | - | Comma-separated proxy list |
| `MAX_CONCURRENT_BROWSERS` | 3 | Max browser instances |
| `MIN_DELAY_MS` | 3000 | Min delay between requests |
| `MAX_DELAY_MS` | 8000 | Max delay between requests |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | 7 | Rate limit per minute |
| `RATE_LIMIT_REQUESTS_PER_HOUR` | 300 | Rate limit per hour |
| `INSTAGRAM_USERNAME` | - | Instagram login (optional) |
| `INSTAGRAM_PASSWORD` | - | Instagram password (optional) |

### Adding Proxies (Recommended for High Volume)

```env
# Single proxy
PROXY_LIST=http://user:pass@proxy.com:8080

# Multiple proxies (comma-separated)
PROXY_LIST=http://user:pass@proxy1.com:8080,http://user:pass@proxy2.com:8080
```

### Instagram Authentication (Optional)

For full access to hashtags and explore pages:

```env
INSTAGRAM_USERNAME=your_secondary_account
INSTAGRAM_PASSWORD=your_password
```

> ⚠️ **Warning**: Use a secondary account, NOT your main Instagram account!

---

## 🧪 Testing the Installation

### Quick Test with cURL

```bash
# Test system status
curl http://localhost:3000/scraper/system-status

# Test profile scraping
curl -X POST http://localhost:3000/scraper/profile \
  -H "Content-Type: application/json" \
  -d '{"username": "instagram", "includePosts": true, "postsLimit": 3}'
```

### Using Swagger UI

1. Open http://localhost:3000/api
2. Click on any endpoint
3. Click "Try it out"
4. Fill in parameters and execute

---

## 🔧 Troubleshooting

### Port Already in Use

```bash
# Find process using port 3000
netstat -ano | findstr :3000  # Windows
lsof -i :3000                 # macOS/Linux

# Kill the process or change PORT in .env
```

### Redis Connection Failed

```bash
# Check if Redis is running
docker ps | grep redis  # Docker
redis-cli ping          # Local

# Expected output: PONG
```

### Playwright Browser Issues

```bash
# Reinstall Playwright browsers
npx playwright install chromium --with-deps
```

### Docker Build Fails

```bash
# Clean Docker cache and rebuild
docker-compose down -v
docker system prune -f
docker-compose up -d --build
```

---

## 📚 Next Steps

1. Read the [API Documentation](http://localhost:3000/api)
2. Check out [CONTRIBUTING.md](CONTRIBUTING.md) if you want to contribute
3. Star the repo on GitHub ⭐
