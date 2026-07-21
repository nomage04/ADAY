# ADAY

**ADAY — Assisted Deck Authoring for You** is a local-first web application that turns a brief into an editable PowerPoint deck. It combines an OpenAI-compatible language model with deterministic PPTX renderers, previews, reusable assets and custom layouts imported from images or existing presentations.

> **Résumé en français.** L'application tourne uniquement sur votre machine, génère des présentations PowerPoint modifiables et conserve vos données dans un dossier local ignoré par Git. Commencez par la section [Installation](#installation), puis configurez votre fournisseur LLM dans **Settings**.

## Built during OpenAI Build Week

ADAY was built during [OpenAI Build Week](https://openai.devpost.com/) for the **Work and Productivity** track. The product idea existed before the event, but the submitted application, architecture and core functionality were implemented during Build Week with Codex and GPT-5.6.

### How Codex contributed

Codex was the primary engineering environment used across the entire project lifecycle:

- **Product and architecture planning:** Sol 5.6 at **MAX effort** helped turn the initial idea into a complete implementation plan. It mapped the end-to-end experience, application boundaries, planner contracts, deterministic rendering pipeline, local persistence model, security constraints and validation strategy before the build started.
- **Full-stack implementation:** Sol 5.6 and Terra 5.6, as available in my Codex environment, helped implement the browser Studio and Gallery, the planning and vision agents, the FastAPI backend, editable PPTX renderers, previews, imports, backups and local storage workflows.
- **Repository-scale iteration:** Codex explored and modified the codebase directly, traced behavior across the planner, preview and PowerPoint output, and helped remove incomplete features while preserving compatibility with existing backup and layout formats.
- **Debugging and verification:** Codex helped reproduce failures, reason about edge cases and build the automated test suite covering browser behavior, server security, all built-in renderers, preview generation and SmartArt-style PowerPoint imports. Sol 5.6 and Terra 5.6 were used throughout implementation and testing, not only for isolated code suggestions.
- **Open-source preparation:** Codex helped reorganize the repository, document installation and architecture, add contribution and security material, audit the Git history for credentials and create reproducible Windows and Linux CI checks.

I retained the key product, engineering and design decisions: keeping ADAY local-first, generating genuinely editable PowerPoint files instead of flattened slide images, validating the plan before rendering, preserving useful decorations from imported layouts and deciding which features were complete enough to ship. Codex accelerated the translation of those decisions into a coherent, tested product.

## Features

- Studio workflow: brief, plan validation, preview and PPTX export.
- 20 built-in renderers, Gallery controls and custom layouts.
- Image and PPTX imports, including reusable lower-page decorations from imported layouts.
- Presentation history, speaker notes and full local backups.
- OpenAI-compatible text and vision providers.
- Bounded, validated and atomically written local data.

## Requirements

- Python 3.12 or newer.
- Node.js 24 or newer for validation and development.
- Chromium, installed through Playwright, for the browser test suite.

## Installation

Clone the repository, then install the Python dependencies.

Windows PowerShell:

```powershell
git clone https://github.com/nomage04/ADAY.git
Set-Location ADAY
python -m pip install -r requirements.txt
python -m backend.server
```

Linux:

```bash
git clone https://github.com/nomage04/ADAY.git
cd ADAY
python3 -m pip install -r requirements.txt
python3 -m backend.server
```

Open <http://127.0.0.1:8000> if the browser does not open automatically. Use `--port 8010` to select another port or `--no-open` to keep the browser closed.

The application server always binds to the loopback interface. It is not designed to be exposed to a LAN or the internet.

## LLM configuration

Open **Settings** and enter an OpenAI-compatible base URL, model name and API key. Remote providers receive the prompts and assets you explicitly submit to them; the local-only server does not make a remote provider private.

The API key remains in the current browser tab by default. If you enable **Save the key**, the local server stores it as plain text in `config/config.local.js`, which Git ignores and the static server refuses to serve. Never commit or share that file.

For a file-based setup, copy `config/config.example.js` to `config/config.local.js` and edit the copy. `LLM_BASE` remains available for the optional local `/v1/*` proxy and defaults to `http://localhost:8080`.

### Qwen (Alibaba Cloud Model Studio) — default

ADAY is preconfigured for Qwen through the DashScope OpenAI-compatible API:

| Field      | Value                                                       |
| ---------- | ----------------------------------------------------------- |
| Base URL   | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`    |
| Model      | `qwen-plus` (alternatives: `qwen-max`, `qwen-turbo`, `qwen-flash`) |
| Vision     | `qwen-vl-plus` (alternative: `qwen-vl-max`)                 |
| API key    | a Model Studio key (`sk-...`), created in the Alibaba Cloud console |

### OpenAI — GPT-5.6

ADAY was built during OpenAI Build Week with Codex and GPT-5.6, and runs on GPT-5.6 directly:

| Field      | Value                          |
| ---------- | ------------------------------ |
| Base URL   | `https://api.openai.com/v1`    |
| Model      | `gpt-5.6-luna`                 |
| Vision     | `gpt-5.6-luna`                 |
| API key    | an OpenAI API key (`sk-...`)   |

Accounts on the Chinese mainland endpoint use `https://dashscope.aliyuncs.com/compatible-mode/v1` instead. The Settings fields offer these presets in their dropdowns. DashScope sends CORS headers, so the browser can call it directly; alternatively set the Base URL to `/v1` to route through the bundled server proxy (`LLM_BASE=https://dashscope-intl.aliyuncs.com/compatible-mode`).

## Cloud deployment (Alibaba Cloud ECS)

`deploy/alibaba/` runs the unmodified local server behind a TLS gateway:

```bash
# on the server
cp deploy/alibaba/.env.example deploy/alibaba/.env   # set ADAY_PUBLIC_HOST
cd deploy/alibaba
docker compose up -d --build
```

The FastAPI app stays bound to `127.0.0.1:8000`; only Caddy is reachable, terminates TLS (Let's Encrypt) and rewrites the pinned `Host`/`Origin` headers. Runtime data persists in the `aday-v1-data` volume.

Two credential modes:

- **Visitor key (default)** — each visitor pastes their own DashScope key in Settings; it stays in the browser tab.
- **Server key** — set `PPTGEN_LLM_API_KEY` (and a `PPTGEN_PROXY_TOKEN`) in `.env`: when the browser presents the proxy token as its API key, the `/v1` proxy swaps it for the server-side key, which never reaches the browser. Any other key presented on `/v1` is forwarded to the provider untouched, so both modes work at the same time: visitors bring their own DashScope key (Base URL `/v1`), while the token unlocks the server key.

## Repository structure

```text
backend/  Local FastAPI server and persistence layer
config/   Shared constraints and local configuration template
customs/  Ignored runtime data
docs/     Architecture, development and community documentation
packs/    Source assets and built-in layout definitions
tests/    Unit, server and browser tests
tools/    Deterministic generators and repository checks
web/      Browser application, renderers and bundled libraries
```

Only the project entry documents and standard package/tool manifests remain at the root. Application source files and secondary Markdown documents are kept in their dedicated directories.

## Local data and backups

Runtime data is written below `customs/`:

```text
customs/
├── layouts/<id>.json
├── icons/<id>.json
├── photos/<id>.json
├── history/<id>.json
├── settings.json
└── gallery.json
```

This content is ignored by Git by default. Keep it local, use **Settings → Export full backup** to create a portable archive, and store backups separately from the repository. Existing backup formats remain importable; obsolete plan fields are discarded during import.

Set `PPTGEN_DATA_DIR` before launching the server to place runtime data elsewhere:

```powershell
$env:PPTGEN_DATA_DIR = "D:\ppt-generator-data"
python -m backend.server
```

```bash
PPTGEN_DATA_DIR="./local-data" python3 -m backend.server
```

## Development and validation

```powershell
npm ci
python -m pip install -r requirements.txt
npx playwright install chromium
npm run check
```

On Linux CI-like hosts, install Chromium system dependencies with `npx playwright install --with-deps chromium`.

`npm run check` verifies generated assets and constraints, repository hygiene, the current tree and reachable Git history for credential-like values, JavaScript and Python tests, local-server E2E flows, all built-in renderers, preview rendering and the SmartArt import path. Secret findings report only a file, revision and rule identifier; values are never printed. See [development](docs/DEVELOPMENT.md) and [architecture](docs/ARCHITECTURE.md) for details.

## Contributing and security

Contributions are welcome. Read the [contribution guide](docs/CONTRIBUTING.md) and [Code of Conduct](docs/CODE_OF_CONDUCT.md) before opening a pull request. Please report vulnerabilities through the process in the [security policy](docs/SECURITY.md), not a public issue.

## License

ADAY is released under the [MIT License](LICENSE). Bundled dependency notices are listed in [third-party notices](docs/THIRD_PARTY_NOTICES.md).
