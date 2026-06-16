# KvnchRebuild

> **A lightweight leaderboard viewer for Opus Magnum & EXAPUNKS** — cyber-terminal style, with real-time search, 3-tier caching, and Pareto frontier analysis.

![Tech Stack](https://img.shields.io/badge/Java-17-orange?logo=openjdk)
![Spring Boot](https://img.shields.io/badge/Spring_Boot-3.3.5-brightgreen?logo=springboot)
![Vue](https://img.shields.io/badge/Vue-3.5-4FC08D?logo=vuedotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-6.0-646CFF?logo=vite)
![ECharts](https://img.shields.io/badge/ECharts-6.1-AA344D?logo=apacheecharts)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## What is this?

KvnchRebuild is a desktop-style web app that queries the community leaderboards for Zachtronics puzzle games (**Opus Magnum**, **EXAPUNKS**) and displays the top scores. It fetches data from the [ZLBB leaderboard API](https://zlbb.faendir.com), caches results locally, and presents them in a retro cyber-terminal UI.

**Original project** by [Kvnch](https://github.com/Kvnch) — this is a community rebuild with a modernized stack.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Spring Boot 3.3.5, Java 17, Maven |
| **Frontend** | Vue 3, TypeScript, Vite 6, ECharts 6 |
| **API Data** | [ZLBB Leaderboard API](https://zlbb.faendir.com) |
| **Caching** | 3-tier: In-memory → Disk cache → API fetch |

---

## Features

- 🔍 **Instant Search** — Type any puzzle name and get live suggestions with realtime filtering
- 📊 **Leaderboard Grid** — View top scores with full formatted metrics (cost, cycles, area, instructions)
- 📈 **Pareto Panel** — Visualize the Pareto-optimal frontier across score dimensions
- 🔧 **Improve Panel** — See what metrics need improvement to climb the leaderboard
- 💾 **3-Tier Cache** — Memory vault → disk cache → ZLBB API, with force-refresh capability
- 🖥️ **Cyber-Terminal UI** — Monospace, dark theme, pulse indicators — looks like a hacking console

---

## Project Structure

```
KvnchRebuild/
├── pom.xml                          # Maven build (Spring Boot parent)
├── src/
│   └── main/
│       ├── java/com/kvnch/omviewer/
│       │   ├── OmViewerApplication.java      # Spring Boot entry point
│       │   ├── config/
│       │   │   ├── RestTemplateConfig.java    # REST client bean
│       │   │   └── WebMvcConfig.java          # CORS & static resource mapping
│       │   ├── controller/
│       │   │   ├── SearchController.java      # /api/search, /api/suggestions
│       │   │   └── DiagnosticsController.java # /api/boot/ready, /api/cache/*
│       │   ├── model/
│       │   │   ├── OmRecordDTO.java           # Leaderboard record
│       │   │   ├── OmPuzzleDTO.java           # Puzzle metadata
│       │   │   ├── OmGroupDTO.java            # Puzzle grouping
│       │   │   ├── OmScoreDTO.java            # Score breakdown
│       │   │   └── UniversalSuggestion.java   # Search suggestion
│       │   └── service/
│       │       ├── PuzzleService.java         # Core search & caching logic
│       │       ├── ZlbbApiClient.java         # External API client
│       │       ├── CacheFileService.java      # Disk cache I/O
│       │       └── BootSequenceService.java   # Startup puzzle list sync
│       └── resources/
│           ├── application.yml                # Server config
│           └── static/                        # Built Vue frontend (gitignored)
├── frontend/
│   ├── index.html
│   ├── vite.config.ts               # Vite → builds into ../src/main/resources/static
│   ├── package.json
│   └── src/
│       ├── main.ts                   # Vue app entry
│       ├── App.vue                   # Root component (sidebar + main workspace)
│       ├── api/omApi.ts              # API client (fetch wrappers)
│       ├── types/om.ts               # TypeScript interfaces
│       └── components/
│           ├── OmList.vue            # Leaderboard table
│           ├── RecordPreview.vue     # Single record detail
│           ├── ParetoPanel.vue       # ECharts Pareto scatter chart
│           └── ImprovePanel.vue      # Score improvement analysis
├── cache/                            # Runtime disk cache (gitignored)
└── installer/                        # Platform launcher scripts
```

---

## Getting Started

### Prerequisites

- **JDK 17+** (recommended: Eclipse Temurin 17)
- **Maven 3.8+**
- **Node.js 18+** (for frontend development only)

### Quick Start (Recommended)

```bash
# 1. Build everything (frontend + backend) into a single JAR
mvn clean package -DskipTests

# 2. Run the JAR
java -jar target/om-viewer-0.1.0.jar

# 3. Open browser
# http://localhost:8080
```

The frontend is already bundled inside the JAR at `BOOT-INF/classes/static/` — no separate Node/npm needed at runtime.

### Development Mode

```bash
# Terminal 1 — Start backend on :8080
mvn spring-boot:run

# Terminal 2 — Start Vite dev server on :5173 (with API proxy)
cd frontend
npm install
npm run dev
```

Then open **`http://localhost:5173`** — Vite proxies `/api/*` calls to the Spring Boot backend automatically.

### Frontend-only rebuild

```bash
cd frontend
npm install
npm run build           # outputs to ../src/main/resources/static
```

---

## Configuration

All config in [`src/main/resources/application.yml`](src/main/resources/application.yml):

| Property | Default | Description |
|----------|---------|-------------|
| `server.port` | `8080` | HTTP server port |
| `app.cache-dir` | `./cache` | Disk cache directory |
| `app.zlbb-base-url` | `https://zlbb.faendir.com` | ZLBB API base URL |
| `logging.level.com.kvnch.omviewer` | `DEBUG` | Log verbosity |

Override via environment variables or command line:

```bash
java -jar target/om-viewer-0.1.0.jar --server.port=9090 --app.cache-dir=/tmp/kvnch-cache
```

---

## API Endpoints

| Method | Path | Params | Description |
|--------|------|--------|-------------|
| `GET` | `/api/search` | `keyword`, `force` (bool) | Search leaderboard records |
| `GET` | `/api/suggestions` | `keyword` | Live puzzle name suggestions |
| `GET` | `/api/boot/ready` | — | Check if initial sync is complete |
| `GET` | `/api/cache/path` | — | Get cache directory path |
| `GET` | `/api/cache/info` | — | Get cache metadata summary |

---

## How Caching Works

```
Search Request
    ↓
[1] Memory Vault  ── HIT? → return instantly
    ↓ (miss)
[2] Disk Cache     ── HIT? → load into vault, return
    ↓ (miss, or force=true)
[3] ZLBB API       ── fetch, save to disk + vault, return
    ↓ (miss)
    empty result
```

- **Force refresh**: Toggle the REFRESH button in the sidebar or pass `force=true` to bypass all caches and re-fetch from ZLBB.

---

## Deployment

### Option A: Single JAR (Easiest)

The project bundles frontend + backend into one JAR. Deploy anywhere you can run Java:

```bash
mvn clean package -DskipTests
java -jar target/om-viewer-0.1.0.jar
```

### Option B: Free Cloud Hosting

These platforms support Spring Boot out of the box with free tiers:

| Platform | How |
|----------|-----|
| **[Railway](https://railway.app)** | Push to GitHub → connect repo → deploys automatically (free 500h/month) |
| **[Render](https://render.com)** | Create Web Service → point to repo → build command: `./mvnw clean package` |
| **[Fly.io](https://fly.io)** | `fly launch` — auto-detects Spring Boot |

**Important**: GitHub Pages **cannot** host this project because it requires a Java runtime for the backend. GitHub Pages only serves static HTML/CSS/JS.

### Option C: Frontend-only on GitHub Pages

If you only need the UI (without live API search), you can build just the Vue frontend:

```bash
cd frontend
npm run build
# Deploy src/main/resources/static/ to GitHub Pages
```

But search functionality won't work without the Spring Boot backend.

---

## FAQ

**Q: What games are supported?**  
A: Opus Magnum (`om`) and EXAPUNKS (`exa`). More Zachtronics games may be added if the ZLBB API supports them.

**Q: Why "KvnchRebuild"?**  
A: The original [Kvnch](https://github.com/Kvnch) project was a C# desktop app. This is a full rewrite as a web application with a modern stack.

**Q: Can I use this offline?**  
A: Partially. Once puzzles are cached to disk (`./cache/`), previously searched puzzles work offline. New puzzles require API access.

**Q: Where does the leaderboard data come from?**  
A: The [ZLBB project](https://zlbb.faendir.com) by F43nd1r, which aggregates leaderboard data from the games' Steam records.

---

## License

MIT — see the original repository for details.

---

## Acknowledgements

- Original desktop app by [Kvnch](https://github.com/Kvnch)
- [ZLBB](https://zlbb.faendir.com) leaderboard API by F43nd1r
- Zachtronics for the amazing puzzle games
