<p align="center">
  <img src="assets/icon.png" alt="Subspace Mail" width="200" height="200" style="border-radius: 24px;" />
</p>

<h1 align="center">Subspace Mail</h1>

<p align="center">
  <strong>Email at the speed of subspace.</strong>
</p>

<p align="center">
  A fast, keyboard-first desktop email client built with Tauri, React, and Rust.<br />
  Local-first. Privacy-focused. AI-optional.<br />
  A semi-maintained fork of <a href="https://github.com/avihaymenahem/velo">Velo</a> mail.
</p>

<p align="center">
  <a href="#about-this-fork">About</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="#features">Features</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="#installation">Installation</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="docs/keyboard-shortcuts.md">Shortcuts</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="docs/architecture.md">Architecture</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="docs/development.md">Development</a>&nbsp;&nbsp;&bull;&nbsp;&nbsp;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

<p align="center">
  <img width="1920" height="1032" alt="Subspace Mail screenshot" src="https://github.com/user-attachments/assets/dd096d15-4c1e-438c-99f9-c38b50a8a437" />
</p>

---

## About this fork

Velo has one of the best email client UIs out there and a lot of potential, but upstream development appears to have stopped, leaving many bugs and open issues (including security reports) unaddressed.

Subspace Mail picks up where it left off. The goals:

- **Fix what's broken**: rendering problems, loading failures, sending quirks, and other long-standing bugs.
- **Harden security**: review and merge important security fixes that were left sitting in upstream's queue.
- **Polish the experience**: keep the UI that makes Velo great and smooth out the rough edges around it.
- **Stay maintained**: keep dependencies, builds, and releases alive for the foreseeable future.

It's mainly a personal project built for my own daily use, but I update it with other people in mind. If it works for you too, great. Issues and pull requests are welcome.

Subspace Mail is based on Velo by [Avihay Menahem](https://github.com/avihaymenahem), released under the Apache-2.0 license. Many thanks for the foundation.

---

## Why Subspace Mail?

Most email clients are slow, bloated, or send your data to someone else's server. Subspace Mail is different:

- **Local-first**: Your emails live in a local SQLite database. No middleman servers. Read your mail offline.
- **Keyboard-driven**: Superhuman-inspired shortcuts let you fly through your inbox without touching the mouse.
- **AI-enhanced (optional)**: Summarize threads, generate replies, and search your inbox in natural language, with your choice of AI provider.
- **Native performance**: Rust backend via Tauri v2. Small binary, low memory, instant startup.
- **Private by default**: Remote images blocked, HTML sanitized, emails rendered in sandboxed iframes. Your data stays on your machine.

---

## Features

### Email

- Multi-account support: Gmail (API) and IMAP/SMTP (Outlook, Yahoo, iCloud, Fastmail, and more) with instant switching
- Threaded conversations with collapsible messages
- Full-text search with Gmail-style operators (`from:`, `to:`, `subject:`, `has:attachment`, `label:`, etc.)
- Command palette (`/` or `Ctrl+K`) for quick actions
- Drag-and-drop labels, multi-select, pin threads, mute threads, context menus
- Split inbox with category tabs (Primary, Updates, Promotions, Social, Newsletters)
- Inline reply, contact sidebar with Gravatar

### Composer

- TipTap v3 rich text editor (bold, italic, lists, code, links, images)
- Undo send, schedule send, auto-save drafts
- Multiple signatures, reusable templates with variables
- Send-as email aliases with from-address selector
- Drag-and-drop attachments with inline preview
- Frequency-ranked contact autocomplete

### Smart Inbox

- Snooze threads with presets or custom date/time
- Filters to auto-label, archive, trash, star, or mark read
- AI + rule-based auto-categorization (Primary, Updates, Promotions, Social, Newsletters)
- One-click unsubscribe (RFC 8058) and subscription manager
- Newsletter bundling with delivery schedules
- Smart folders / saved searches with dynamic query tokens
- Quick steps: custom action chains for batch thread processing
- Follow-up reminders when you haven't received a reply

### AI

Three providers with selectable models. Choose one or mix and match, or skip AI entirely:

| Provider | Models |
|----------|--------|
| **Anthropic Claude** | Haiku 4.5, Sonnet 4, Opus 4 |
| **OpenAI** | GPT-4o Mini, GPT-4o, GPT-4.1 Nano, GPT-4.1 Mini, GPT-4.1 |
| **Google Gemini** | 2.5 Flash, 2.5 Pro |

Thread summaries, smart reply suggestions, AI compose & reply, text transform (improve/shorten/formalize), Ask My Inbox (natural language search). Pick which model to use per provider in Settings. All results cached locally.

### Calendar

Google Calendar sync with month, week, and day views. Create events without leaving the app.

### UI & Design

- Glassmorphism with animated gradient background
- Dark / light / system theme with 8 accent color presets
- Flexible reading pane (right, bottom, hidden), resizable panels
- Configurable density and font scaling
- Pop-out thread windows, custom titlebar, splash screen
- System tray with taskbar badge count

### Privacy & Security

- OAuth PKCE for Gmail: no client secret, no backend servers
- Encrypted password/app-password storage for IMAP accounts (AES-256-GCM)
- Remote image blocking with per-sender allowlist
- Phishing link detection with 10 heuristic scoring rules
- SPF/DKIM/DMARC authentication display with badges and warnings
- DOMPurify + sandboxed iframe rendering
- AES-256-GCM encrypted token storage

### System Integration

- `mailto:` deep links, global compose shortcut
- Autostart (hidden in tray), single instance
- [Customizable keyboard shortcuts](docs/keyboard-shortcuts.md)

---

## Installation

Download the latest release for your platform:

**[Download Subspace Mail](https://github.com/Zytronium/SubspaceMail/releases/latest)**: Windows `.msi` / `.exe` &nbsp;&bull;&nbsp; macOS `.dmg` &nbsp;&bull;&nbsp; Linux `.deb` / `.AppImage`

No build tools or programming knowledge required. Just download, install, and run.

### Account setup

**Gmail:** Create OAuth credentials in [Google Cloud Console](https://console.cloud.google.com/) (enable Gmail API + Calendar API), then enter your Client ID in Subspace Mail's Settings. No client secret needed (PKCE).

**IMAP/SMTP:** Click "Add IMAP Account" in the account switcher. Enter your email and password; Subspace Mail auto-discovers server settings for popular providers (Outlook, Yahoo, iCloud, Fastmail, etc.). For other providers, enter IMAP/SMTP server details manually. No Google Cloud project needed.

**AI (optional):** Add an API key for [Anthropic](https://console.anthropic.com/), [OpenAI](https://platform.openai.com/), or [Google Gemini](https://aistudio.google.com/) in Settings. Then select which model to use for each provider.

### Building from source

For developers who want to build Subspace Mail themselves or contribute:

```bash
git clone https://github.com/Zytronium/SubspaceMail.git
cd SubspaceMail
npm install
npm run tauri dev
```

**Prerequisites:** [Node.js](https://nodejs.org/) v18+, [Rust](https://www.rust-lang.org/tools/install), [Tauri v2 deps](https://v2.tauri.app/start/prerequisites/)

See the [Development Guide](docs/development.md) for all commands, testing, and build instructions.

---

## Tech Stack

| | |
|--|--|
| **Framework** | Tauri v2 (Rust) + React 19 + TypeScript |
| **Styling** | Tailwind CSS v4 |
| **State** | Zustand 5 (8 stores) |
| **Editor** | TipTap v3 |
| **Email** | Gmail API, IMAP/SMTP (via async-imap + lettre in Rust) |
| **Database** | SQLite + FTS5 (33 tables) |
| **AI** | Claude, GPT, Gemini |
| **Testing** | Vitest + Testing Library |

See [Architecture](docs/architecture.md) for detailed design, data flow, and project structure.

---

## Building

```bash
npm run tauri build
```

**Windows** `.msi` / `.exe` &nbsp;&bull;&nbsp; **macOS** `.dmg` / `.app` &nbsp;&bull;&nbsp; **Linux** `.deb` / `.AppImage`

---

## Contributing

Bug reports, fixes, and polish are all welcome. Please check [CONTRIBUTING.md](CONTRIBUTING.md) and open an [issue](https://github.com/Zytronium/SubspaceMail/issues) before starting anything large. Security issues are a priority; please report them privately rather than in a public issue.

---

## License

[Apache-2.0](LICENSE)

Subspace Mail is a fork of [Velo](https://github.com/avihaymenahem/velo) by Avihay Menahem, used and modified under the same license.

---

<p align="center">
  Built with Rust and React.<br />
  Forked and maintained by <a href="https://github.com/Zytronium">Zytronium</a>.<br />
  Originally created by <a href="https://github.com/avihaymenahem">Avihay</a>.
</p>