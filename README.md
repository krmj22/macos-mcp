# macos-mcp ![License: MIT](https://img.shields.io/badge/license-MIT-green)

> Based on [FradSer/mcp-server-apple-events](https://github.com/FradSer/mcp-server-apple-events)

A Model Context Protocol (MCP) server that gives Claude genuine access to your macOS personal data — **Reminders**, **Calendar**, **Notes**, **Mail**, **Messages**, and **Contacts**. Six apps, working together: ask Claude about tomorrow's meeting and it pulls the calendar event, finds related emails, and creates a prep note — from your phone, your desktop, or the web.

Use with Claude Desktop locally, or Claude iOS/web remotely via Cloudflare Tunnel. **Requires a Mac** — for always-on remote access, a Mac Mini or Mac Studio is recommended.

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
node dist/index.js --check   # or: macos-mcp --check (if installed globally)
```

The preflight check validates macOS version, Node.js, EventKit binary, Full Disk Access, and JXA automation permissions.

**Next step:** [Using Claude Desktop?](#local-setup-stdio) | [Using Claude iOS/web remotely?](#remote-setup-claude-iosweb)

## Available MCP Tools

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

All tools support both underscore (`reminders_tasks`) and dot (`reminders.tasks`) notation.

## Local Setup (stdio)

### Prerequisites

- **Node.js 20 or later**
- **macOS** (required for EventKit and JXA)
- **Xcode Command Line Tools** (required for compiling Swift code)
- **pnpm** (recommended for package management)

### Configure Your Client

#### Claude Desktop

Add to your `claude_desktop_config.json`:

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

#### Cursor

1. Open Cursor Settings > MCP > Add new global MCP server
2. Configure:
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

#### Claude Code

Add a `.mcp.json` to your project root:

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

### Permissions

On first use, macOS will prompt you to allow access for each app. Click **Allow** when prompted.

- **Reminders & Calendar** — EventKit permission dialogs appear automatically.
- **Notes, Mail, Contacts** — Automation permission dialogs appear when `osascript` first controls each app. Grant access via **System Settings > Privacy & Security > Automation**.
- **Messages & Mail** — Require **Full Disk Access** for your terminal app (Terminal, iTerm2, etc.) since both read SQLite databases directly.

Run `node dist/index.js --check` to verify all permissions are granted. See [Troubleshooting](#troubleshooting) if anything fails.

## Remote Setup (Claude iOS/web)

Use this path to access your Mac's apps from Claude iOS or Claude web via a secure Cloudflare Tunnel.

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Claude iOS    │──────│  Cloudflare     │──────│   Your Mac      │
│   or Web        │ HTTPS│  Edge + Access  │tunnel│   macos-mcp     │
└─────────────────┘      └─────────────────┘      └─────────────────┘
```

### What you'll set up

1. **Cloudflare Tunnel** — Secure outbound connection from your Mac to Cloudflare's edge
2. **Cloudflare Access** — Email OTP authentication so only you can connect
3. **LaunchAgents** — Auto-start on boot for both the server and tunnel
4. **Permissions** — Automation + Full Disk Access granted to the node binary

### Prerequisites

- **Cloudflare account** (free tier works)
- **Custom domain** in Cloudflare (or use `.cfargotunnel.com` subdomain)
- **Always-on Mac** (Mac Mini/Studio recommended)
- **macos-mcp built and working locally** (`pnpm build && node dist/index.js --check`)

### Full Setup Guide

Follow the step-by-step instructions in **[`docs/CLOUDFLARE_SETUP.md`](docs/CLOUDFLARE_SETUP.md)** — covers tunnel creation, Cloudflare Access configuration, LaunchAgent setup, permission granting, and registering in Claude iOS.

## Usage Examples

### Reminders
```
Create a reminder to "Buy groceries" for tomorrow at 5 PM.
Show all reminders in my "Work" list.
Organize my reminders by priority.
```

### Calendar
```
Create a meeting "Team Standup" tomorrow from 10 AM to 10:30 AM.
Show my calendar events for this week.
```

### Notes
```
Create a note titled "Meeting Notes" in the Work folder.
Search my notes for "project plan".
List all note folders.
```

### Mail
```
Show my inbox.
Read the email from John about the project.
Draft an email to alice@example.com about the meeting.
Reply to the last email from Bob.
```

### Messages
```
Show my recent iMessage chats.
Read messages from the chat with John.
Send "On my way!" to the group chat.
```

## Troubleshooting

### Permission Quick Reference

| App | Permission | System Settings Path |
|-----|------------|---------------------|
| Reminders | Full Access | Privacy & Security > Reminders |
| Calendar | Full Access | Privacy & Security > Calendars |
| Notes | Automation | Privacy & Security > Automation > Notes |
| Mail | Automation + Full Disk Access | Both locations |
| Messages | Automation + Full Disk Access | Both locations |
| Contacts | Automation | Privacy & Security > Automation > Contacts |

### Quick-Fix Commands

```bash
# Open specific settings panes
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"

# Run preflight check
node dist/index.js --check
```

### EventKit (Reminders & Calendar)

Apple separates Reminders and Calendar permissions into *write-only* and *full-access* scopes. The Swift bridge declares the following privacy keys:

- `NSRemindersUsageDescription` / `NSRemindersFullAccessUsageDescription` / `NSRemindersWriteOnlyAccessUsageDescription`
- `NSCalendarsUsageDescription` / `NSCalendarsFullAccessUsageDescription` / `NSCalendarsWriteOnlyAccessUsageDescription`

If a permission failure occurs, the Node.js layer automatically runs a minimal AppleScript to surface the dialog and retries.

### JXA Automation (Notes, Mail, Contacts)

JXA-based tools require macOS Automation permissions. On first use, macOS will prompt you to allow `osascript` to control each app.

> **Headless / LaunchAgent:** Automation permission dialogs **cannot appear** through a LaunchAgent, SSH session, or any non-GUI context. You must grant them once from a local graphical Terminal session (physical access or Screen Sharing). See [`docs/CLOUDFLARE_SETUP.md`](docs/CLOUDFLARE_SETUP.md) Step 10 for the full procedure. Once granted, permissions persist across reboots.

**Verify all Automation permissions:**

```bash
/usr/bin/osascript -l JavaScript -e 'Application("Contacts").people().length'
/usr/bin/osascript -l JavaScript -e 'Application("Calendar").calendars().length'
/usr/bin/osascript -l JavaScript -e 'Application("Reminders").defaultList().name()'
/usr/bin/osascript -l JavaScript -e 'Application("Mail").inbox().messages().length'
/usr/bin/osascript -l JavaScript -e 'Application("Notes").notes().length'
```

Each command should return a value without errors or hanging. A hang means the permission dialog is trying (and failing) to appear.

### Full Disk Access (Messages & Mail)

The Messages and Mail tools read SQLite databases directly (`~/Library/Messages/chat.db` and `~/Library/Mail/V10/MailData/Envelope Index`). These databases are protected by **Full Disk Access (FDA)**.

- **stdio transport**: Grant FDA to your terminal app (Terminal, iTerm2, etc.)
- **HTTP transport / LaunchAgent**: Grant FDA to the **actual node binary**, not a version manager shim

To find and grant access to the correct binary:

```bash
# Find the actual node binary path
node -e "console.log(process.execPath)"

# Reveal it in Finder (drag-and-drop into FDA settings)
open -R "$(node -e "console.log(process.execPath)")"

# Open Full Disk Access settings
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
```

> **Note:** Version managers (Volta, nvm, fnm) use shims that point to a launcher, not the real binary. The System Settings file picker may not show binaries in hidden directories — use the drag-and-drop method above instead. See [`docs/CLOUDFLARE_SETUP.md`](docs/CLOUDFLARE_SETUP.md) Step 11 for detailed instructions and troubleshooting.

### Version Manager Shim Resolution

If you use **Volta**, **nvm**, or **fnm**, the `node` command is a shim/launcher. System Settings needs the real binary:

| Manager | Find real binary |
|---------|-----------------|
| Volta | `volta which node` or `node -e "console.log(process.execPath)"` |
| nvm | `nvm which current` |
| fnm | `fnm exec -- node -e "console.log(process.execPath)"` |

The System Settings file picker may not show binaries in hidden directories — use the `open -R` command above to reveal the binary in Finder, then drag-and-drop it into the FDA list.

### Gmail Labels / Missing Inbox Messages

Gmail stores all messages in `[Gmail]/All Mail` and uses **labels** for folder membership. The server checks both the direct mailbox and the labels join table for inbox queries. If you're not seeing Gmail inbox messages, verify the Mail app has fully synced your account.

### Server Restart (LaunchAgent)

If running as a LaunchAgent with Cloudflare Tunnel, restart **both** services:

```bash
launchctl kickstart -k gui/$(id -u)/com.macos-mcp.server
launchctl kickstart -k gui/$(id -u)/com.cloudflare.macos-mcp-tunnel
```

## Development

```bash
pnpm install          # Install dependencies
pnpm build            # Build TypeScript + Swift binary
pnpm test             # Run full test suite
pnpm lint             # Lint and format with Biome + TypeScript check
pnpm dev              # Run from source via tsx (stdio only, no build needed)
```

> **Note:** The production entry point (`bin/run.cjs`) requires `pnpm build` first. Use `pnpm dev` for quick local development with stdio transport.

### End-to-End Testing

For HTTP transport testing, an E2E script is available:

```bash
./scripts/test-e2e.sh
```

This script:
- Starts the server in HTTP mode
- Tests health endpoints
- Verifies CORS headers and OPTIONS preflight
- Tests MCP endpoint availability
- Tests rate limit headers
- Verifies graceful shutdown

Requirements: `jq` (install with `brew install jq`)

### Architecture

The server uses two bridging strategies to communicate with Apple apps:

- **EventKit (Swift binary)** — Reminders and Calendar. A compiled Swift CLI binary performs EventKit operations and returns JSON.
- **JXA (JavaScript for Automation)** — Notes, Mail, Contacts. Scripts run via `osascript -l JavaScript` with template-based parameter interpolation.
- **SQLite** — Messages reads (`~/Library/Messages/chat.db`) and Mail reads (`~/Library/Mail/V10/MailData/Envelope Index`). JXA message reading is broken on macOS Sonoma+; JXA mail reading is too slow for real inboxes. Writes still use JXA.

### HTTP Transport Configuration

The server supports HTTP transport for remote access. Set via environment variables or `macos-mcp.config.json`:

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio`, `http`, or `both` |
| `MCP_HTTP_ENABLED` | `false` | Enable HTTP transport |
| `MCP_HTTP_PORT` | `3847` | HTTP server port |

Key design decisions:
- **Stateless mode** — required for multi-client support (Claude.ai serves multiple users)
- **Root endpoint** — MCP handler at `/` (Claude expects this, not `/mcp`)
- **JSON fallback** — `enableJsonResponse: true` for clients without SSE support

### Structured Prompt Library

The server ships with prompt templates exposed via MCP `ListPrompts` and `GetPrompt` endpoints:

- **daily-task-organizer** — optional `today_focus` input produces a same-day execution blueprint
- **smart-reminder-creator** — optional `task_idea` generates an optimally scheduled reminder
- **reminder-review-assistant** — optional `review_focus` to audit and optimize existing reminders
- **weekly-planning-workflow** — optional `user_ideas` guides a Monday-through-Sunday reset

Run `pnpm test -- src/server/prompts.test.ts` to validate prompt metadata and schema compatibility.

### Dependencies

**Runtime:** `@modelcontextprotocol/sdk`, `express`, `jose`, `zod`

**Dev:** `typescript`, `tsx`, `jest`, `ts-jest`, `babel-jest`, `@biomejs/biome`

## License

MIT

## Contributing

Contributions welcome! Please read the [contributing guidelines](CONTRIBUTING.md) first.
