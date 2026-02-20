# macos-mcp ![License: MIT](https://img.shields.io/badge/license-MIT-green)

> Based on [FradSer/mcp-server-apple-events](https://github.com/FradSer/mcp-server-apple-events)

MCP server for Reminders, Calendar, Notes, Mail, Messages, and Contacts on macOS. Works with Claude Desktop locally, or Claude iOS/web remotely via Cloudflare Tunnel.

Requires a Mac. For always-on remote access, a Mac Mini or Mac Studio is recommended.

## Quick Start

### Install from npm

```bash
npm install -g mcp-macos
```

### Or build from source

```bash
git clone https://github.com/krmj22/macos-mcp.git
cd macos-mcp
pnpm install
pnpm build
```

### Verify setup

```bash
macos-mcp --check   # or: node dist/index.js --check
```

Checks macOS version, Node.js, EventKit binary, Full Disk Access, and JXA automation permissions.

## Tools

| Tool | App | Bridge | Actions |
|------|-----|--------|---------|
| `reminders_tasks` | Reminders | EventKit | read, create, update, delete |
| `reminders_lists` | Reminders | EventKit | read, create, update, delete |
| `calendar_events` | Calendar | EventKit | read, create, update, delete |
| `calendar_calendars` | Calendar | EventKit | read |
| `notes_items` | Notes | JXA | read, create, update, delete |
| `notes_folders` | Notes | JXA | read, create |
| `mail_messages` | Mail | SQLite + JXA | read, create, update, delete |
| `messages_chat` | Messages | SQLite + JXA | read, create |
| `contacts_people` | Contacts | JXA | read, search, create, update, delete |

Both underscore (`reminders_tasks`) and dot (`reminders.tasks`) notation work.

## Local Setup (stdio)

### Prerequisites

- **Node.js 20+**
- **macOS**
- **Xcode Command Line Tools** (Swift compilation)

### Client Configuration

The JSON config is the same for all clients — just the location differs.

```json
{
  "mcpServers": {
    "macos-mcp": {
      "command": "npx",
      "args": ["mcp-macos"]
    }
  }
}
```

| Client | Config location |
|--------|----------------|
| Claude Desktop | `claude_desktop_config.json` |
| Cursor | Settings > MCP > Add new global MCP server |
| Claude Code | `.mcp.json` in project root |

### Permissions

macOS prompts for access on first use. Click **Allow** when prompted.

| App | Permission | System Settings Path |
|-----|------------|---------------------|
| Reminders | Full Access | Privacy & Security > Reminders |
| Calendar | Full Access | Privacy & Security > Calendars |
| Notes | Automation | Privacy & Security > Automation > Notes |
| Mail | Automation + Full Disk Access | Both locations |
| Messages | Automation + Full Disk Access | Both locations |
| Contacts | Automation | Privacy & Security > Automation > Contacts |

Messages and Mail read SQLite databases directly, so your terminal app (Terminal, iTerm2, etc.) needs **Full Disk Access**.

Run `macos-mcp --check` to verify. See [Troubleshooting](#troubleshooting) if anything fails.

## Remote Setup (Claude iOS/web)

Access your Mac's apps from Claude iOS or Claude web via Cloudflare Tunnel.

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Claude iOS    │──────│  Cloudflare     │──────│   Your Mac      │
│   or Web        │ HTTPS│  Edge + Access  │tunnel│   macos-mcp     │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

### What you'll set up

1. **Cloudflare Tunnel** — outbound connection from your Mac to Cloudflare's edge
2. **Cloudflare Access** — email OTP authentication so only you can connect
3. **LaunchAgents** — auto-start on boot for both the server and tunnel
4. **Permissions** — Automation + Full Disk Access granted to the node binary

### Prerequisites

- Cloudflare account (free tier works)
- Custom domain in Cloudflare (or `.cfargotunnel.com` subdomain)
- Always-on Mac (Mac Mini/Studio recommended)
- macos-mcp built and working locally (`pnpm build && macos-mcp --check`)

Full setup guide: **[`docs/CLOUDFLARE_SETUP.md`](docs/CLOUDFLARE_SETUP.md)**

## Troubleshooting

### Quick-Fix Commands

```bash
# Open specific settings panes
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
```

### Full Disk Access (Messages & Mail)

Messages and Mail read SQLite databases (`~/Library/Messages/chat.db` and `~/Library/Mail/V10/MailData/Envelope Index`). These require Full Disk Access.

- **stdio**: Grant FDA to your terminal app
- **HTTP / LaunchAgent**: Grant FDA to the **actual node binary**, not a version manager shim

```bash
# Find your real node binary
node -e "console.log(process.execPath)"

# Reveal it in Finder for drag-and-drop into FDA settings
open -R "$(node -e "console.log(process.execPath)")"

# Open Full Disk Access settings
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
```

**Version manager users** (Volta, nvm, fnm): the `node` command is a shim. System Settings needs the real binary:

| Manager | Find real binary |
|---------|-----------------|
| Volta | `volta which node` |
| nvm | `nvm which current` |
| fnm | `fnm exec -- node -e "console.log(process.execPath)"` |

System Settings may not show binaries in hidden directories — use `open -R` above to reveal it in Finder, then drag into the FDA list.

### JXA Automation (Notes, Mail, Contacts)

On first use, macOS prompts for Automation access. Grant via **System Settings > Privacy & Security > Automation**.

> **Headless / LaunchAgent:** Automation dialogs can't appear through a LaunchAgent or SSH. Grant them once from a local Terminal session. Once granted, they persist across reboots. See [`docs/CLOUDFLARE_SETUP.md`](docs/CLOUDFLARE_SETUP.md) Step 10.

Verify permissions:

```bash
osascript -l JavaScript -e 'Application("Contacts").people().length'
osascript -l JavaScript -e 'Application("Calendar").calendars().length'
osascript -l JavaScript -e 'Application("Reminders").defaultList().name()'
osascript -l JavaScript -e 'Application("Mail").inbox().messages().length'
osascript -l JavaScript -e 'Application("Notes").notes().length'
```

Each command should return a value. A hang means the permission dialog is trying (and failing) to appear.

### Gmail Labels / Missing Inbox Messages

Gmail stores all messages in `[Gmail]/All Mail` and uses labels for folder membership. The server checks both the direct mailbox and labels join table. If Gmail inbox messages are missing, verify the Mail app has fully synced.

### Server Restart (LaunchAgent)

Restart **both** services — the server and the tunnel are separate:

```bash
launchctl kickstart -k gui/$(id -u)/com.macos-mcp.server
launchctl kickstart -k gui/$(id -u)/com.cloudflare.macos-mcp-tunnel
```

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # Build TypeScript + Swift binary
pnpm test             # Run full test suite (~900 tests)
pnpm lint             # Lint and format (Biome + TypeScript)
pnpm dev              # Run from source via tsx (stdio only)
```

Production entry point (`bin/run.cjs`) requires `pnpm build`. Use `pnpm dev` for local development.

### Architecture

Three bridges to Apple apps:

- **EventKit (Swift binary)** — Reminders, Calendar. Compiled Swift CLI, returns JSON.
- **JXA** — Notes, Mail writes, Contacts. Scripts run via `osascript -l JavaScript`.
- **SQLite** — Messages reads (`~/Library/Messages/chat.db`), Mail reads (`~/Library/Mail/V10/MailData/Envelope Index`). JXA message reading is broken on Sonoma+; JXA mail reading is too slow for real inboxes.

### HTTP Transport

Set via environment variables or `macos-mcp.config.json`:

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `stdio` | `stdio`, `http`, or `both` |
| `MCP_HTTP_ENABLED` | `false` | Enable HTTP transport |
| `MCP_HTTP_PORT` | `3847` | HTTP server port |

### Dependencies

**Runtime:** `@modelcontextprotocol/sdk`, `express`, `jose`, `zod`

**Dev:** `typescript`, `tsx`, `jest`, `@biomejs/biome`

## License

MIT

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
