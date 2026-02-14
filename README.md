# Local Deep Research

A privacy-first desktop app that performs comprehensive AI-powered research on any topic — using **local LLMs** and **local web search** so your data never leaves your machine.

Enter a research question, and Local Deep Research will decompose it into dozens of search queries, gather and score sources, synthesize findings through multiple analysis layers, and produce a detailed, fully-cited report you can export as a PDF.

## Features

- **Fully Local** — Runs against Ollama, LM Studio, or any OpenAI-compatible endpoint. No cloud API keys required.
- **Deep Multi-Stage Research** — Decomposes queries into multiple search angles, fetches and reads sources in parallel, then synthesizes through up to 4 hierarchical analysis levels.
- **Adaptive Research** — Automatically detects knowledge gaps in its findings and runs additional targeted searches to fill them.
- **Clarifying Questions** — Before diving in, the AI asks follow-up questions to make sure it researches exactly what you need.
- **Five Intensity Levels** — From a quick 2-5 minute scan (10 sources) to an exhaustive 45-90 minute deep-dive (200+ sources).
- **PDF Export** — Generate clean, professional PDFs with clickable citations and proper formatting.
- **Research History** — All sessions are saved locally (IndexedDB) so you can revisit past research anytime.
- **Dark & Light Themes** — Follows your system preference, or set it manually.
- **Cross-Platform** — Builds for macOS, Windows, and Linux.

## Prerequisites

Before using Local Deep Research, you'll need two things running locally:

### 1. A Local LLM Provider

Choose one:

- **[Ollama](https://ollama.com/)** (default) — Install and pull a model:
  ```bash
  ollama pull llama3.2
  ```
- **[LM Studio](https://lmstudio.ai/)** — Download a model and start the local server.
- **Any OpenAI-compatible API** — Point the app at your endpoint.

### 2. SearXNG (Local Search Engine)

[SearXNG](https://docs.searxng.org/) is a privacy-respecting metasearch engine. The easiest way to run it:

```bash
docker run -d -p 8080:8080 searxng/searxng
```

Or follow the [SearXNG installation docs](https://docs.searxng.org/admin/installation.html) for other methods.

> **Note:** Make sure SearXNG's JSON format is enabled. In your SearXNG `settings.yml`, ensure `json` is listed under `search.formats`.

## Getting Started

1. Clone the repo:
   ```bash
   git clone https://github.com/your-username/local-deep-research.git
   cd local-deep-research
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run in development mode:
   ```bash
   npm run dev
   ```

4. Open the Settings panel in the app to configure your AI provider endpoint and SearXNG URL (defaults to `localhost:11434` for Ollama and `localhost:8080` for SearXNG).

## Building for Distribution

### General Steps

First, build the frontend and Electron main process:

```bash
npm run build
```

Then package for your target platform:

```bash
npm run electron:build
```

Built artifacts will appear in the `release/` directory.

### macOS (.dmg + .zip)

```bash
# On a Mac:
npm run electron:build
```

This produces:
- `release/Local Deep Research-{version}.dmg` — Drag-to-install disk image
- `release/Local Deep Research-{version}-mac.zip` — Zipped .app bundle

> **Note:** For distribution outside the Mac App Store, you'll want to [code sign and notarize](https://www.electronjs.org/docs/latest/tutorial/code-signing) your app. Without signing, users will see a Gatekeeper warning and will need to right-click > Open on first launch.

### Windows (.exe installer + portable)

```bash
# On Windows (or cross-compile from Mac/Linux with appropriate tooling):
npm run electron:build
```

This produces:
- `release/Local Deep Research Setup {version}.exe` — NSIS installer
- `release/Local Deep Research {version}.exe` — Portable executable (no install required)

> **Note:** For production distribution, consider [code signing your Windows builds](https://www.electronjs.org/docs/latest/tutorial/code-signing) to avoid SmartScreen warnings.

### Linux (.AppImage + .deb)

```bash
# On Linux:
npm run electron:build
```

This produces:
- `release/Local Deep Research-{version}.AppImage` — Portable, runs on most distros
- `release/Local Deep Research_{version}_amd64.deb` — Debian/Ubuntu package

To run the AppImage:
```bash
chmod +x "Local Deep Research-{version}.AppImage"
./"Local Deep Research-{version}.AppImage"
```

### Cross-Platform Build Notes

- **Native builds** are recommended (build on the OS you're targeting) for the most reliable results.
- electron-builder supports cross-compilation in some cases, but native dependencies and code signing work best when built natively.
- You'll need **Node.js 18+** and **npm** installed for all platforms.

## App Icon

If you'd like to add a custom app icon, place your icon files in a `build/` directory:

- `build/icon.icns` — macOS
- `build/icon.ico` — Windows
- `build/icon.png` — Linux (256x256 or larger)

electron-builder will automatically pick these up during the build.

## Tech Stack

- **Electron** — Desktop shell
- **React 19** + **TypeScript** — UI
- **Vite** — Build tooling
- **Ollama / LM Studio** — Local LLM inference
- **SearXNG** — Local web search
- **IndexedDB** — Client-side research history
- **electron-builder** — Packaging & distribution

## Project Structure

```
├── electron/           # Electron main process & preload scripts
├── src/
│   ├── components/     # React UI components
│   ├── services/       # Research orchestrator, AI, search, PDF export
│   └── config/         # Settings types and defaults
├── public/             # Static assets
└── package.json        # Dependencies & electron-builder config
```

## License

MIT
