# Personal Agent Desktop MVP

Independent desktop assistant. It does not automate or embed the ChatGPT website.

## Architecture

- **Desktop shell:** Tauri 2 + Vue 3 + TypeScript.
- **Local source of truth:** SQLite via `tauri-plugin-sql`, with WAL enabled.
- **Hybrid inference:** a native Rust HTTP client calls an OpenAI-compatible cloud model endpoint and streams tokens to the Vue UI over Tauri events (no browser CORS dependency). The initial default is DeepSeek Chat; configure any compatible endpoint/model in Settings.
- **Durability:** user message is committed to SQLite before the model request. Assistant output is saved as each stream delta arrives. A startup recovery pass marks unfinished requests as `interrupted` without deleting partial output.
- **Optional sync:** local outbox + the existing Personal Agent Sync API. When sync URL/token are configured, queued mutations are pushed and remote changes are fetched.
- **Secrets:** this MVP stores API and sync credentials in the local Tauri Store file. They are not yet protected by the OS keychain; use a dedicated OS account and do not share the desktop profile.

The ChatGPT Free web subscription is not an API credential and cannot be consumed directly by an independent client. Use a provider's API key/free quota, or run a local Ollama model. For Ollama, set endpoint to `http://localhost:11434/v1/chat/completions`, choose an installed model such as `qwen2.5:7b`, and leave API Key blank. Provider free quotas and model availability are controlled by that provider and may change.

## Prerequisites

- Node.js 20+
- Rust stable toolchain (`rustup`)
- macOS: Xcode Command Line Tools; Windows: Microsoft C++ Build Tools + WebView2; Linux: Tauri's WebKit/GTK build dependencies.

## Run on desktop

```bash
cd personal-agent-desktop
npm install
npm run tauri dev
```

Build a desktop installer:

```bash
npm run tauri build
```

On first launch, open **设置与模型**, set an OpenAI-compatible endpoint, model name and API key. The default endpoint/model pair is DeepSeek Chat. API key is saved locally.

## Data location

SQLite file: Tauri app data directory, filename `personal-agent.db`.
Settings file: Tauri Store app config directory, filename `settings.json`.

Do not delete either file if you want to retain your history/settings. Back up the app data directory separately.

## Current MVP boundaries

- Desktop-only UI; mobile companion is not part of this build.
- Text conversations only; attachments, voice and tool execution are later milestones.
- Sync push is implemented; pull changes are retained as local inbox/outbox records in the current sync adapter and need conflict-aware merge before multi-device sync should be considered production-ready.
- API key storage is local but not encrypted with Keychain/Credential Manager yet.
- Streaming persistence is intentionally frequent (one SQLite update per received delta); batching can be added after correctness tests.
