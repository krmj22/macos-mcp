# macos-mcp ![License: MIT](https://img.shields.io/badge/license-MIT-green)

> Based on [FradSer/mcp-server-apple-events](https://github.com/FradSer/mcp-server-apple-events)

A Model Context Protocol (MCP) server for native macOS app integration: **Reminders**, **Calendar**, **Notes**, **Mail**, **Messages**, and **Contacts**.

## Architecture

The server uses two bridging strategies to communicate with Apple apps:

- **EventKit (Swift binary)** — Reminders and Calendar. A compiled Swift CLI binary performs EventKit operations and returns JSON.
- **JXA (JavaScript for Automation)** — Notes, Mail, Contacts. Scripts run via `osascript -l JavaScript` with template-based parameter interpolation.
- **SQLite** — Messages reads use `~/Library/Messages/chat.db` directly (JXA message reading is broken on macOS Sonoma+). Sends still use JXA.

## Features

### Reminders (EventKit)
- Full CRUD for reminder tasks and lists
- Smart filtering by completion status, due date ranges, full-text search
- Organization strategies (priority, category, due date, completion)

### Calendar (EventKit)
- Full CRUD for calendar events with recurrence support
- List available calendars
- Date range and keyword filtering

### Notes (JXA)
- Full CRUD for notes with append mode
- Folder management (list, create)
- Search by title/content with pagination

### Mail (JXA)
- Read inbox, specific mailboxes, or individual messages
- Create drafts with CC/BCC support
- Reply to existing messages (auto-quotes original)
- Mark messages read/unread, delete messages
- List all mailboxes across accounts
- Search by subject, sender, or body content

### Contacts (JXA)
- Full CRUD for contacts (list, search, create, update, delete)
- Search by name, email, or phone (partial match)
- Create contacts with email, phone, address, organization
- Cross-tool contact enrichment: resolves phone numbers and emails to names in Messages, Mail, and Calendar

### Messages (SQLite + JXA)
- List iMessage chats with pagination
- Read messages from specific chats
- Send messages to existing chats or new recipients
- Search chats by name/participant or search message content
- Date range filtering with shortcuts (today, yesterday, this_week, last_7_days, last_30_days)
- Contact enrichment: phone numbers automatically resolved to contact names

## Available MCP Tools

| Tool | App | Bridge | Actions |
|------|-----|--------|---------|
| `reminders_tasks` | Reminders | EventKit | read, create, update, delete |
| `reminders_lists` | Reminders | EventKit | read, create, update, delete |
| `calendar_events` | Calendar | EventKit | read, create, update, delete |
| `calendar_calendars` | Calendar | EventKit | read |
| `notes_items` | Notes | JXA | read, create, update, delete |
| `notes_folders` | Notes | JXA | read, create |
| `mail_messages` | Mail | JXA | read, create, update, delete |
| `messages_chat` | Messages | SQLite + JXA | read, create |
| `contacts_people` | Contacts | JXA | read, search, create, update, delete |

All tools support both underscore (`reminders_tasks`) and dot (`reminders.tasks`) notation.

## Prerequisites

- **Node.js 18 or later**
- **macOS** (required for EventKit and JXA)
- **Xcode Command Line Tools** (required for compiling Swift code)
- **pnpm** (recommended for package management)

## macOS Permission Requirements (Sonoma 14+ / Sequoia 15)

### EventKit (Reminders & Calendar)

Apple separates Reminders and Calendar permissions into *write-only* and *full-access* scopes. The Swift bridge declares the following privacy keys:

- `NSRemindersUsageDescription` / `NSRemindersFullAccessUsageDescription` / `NSRemindersWriteOnlyAccessUsageDescription`
- `NSCalendarsUsageDescription` / `NSCalendarsFullAccessUsageDescription` / `NSCalendarsWriteOnlyAccessUsageDescription`

If a permission failure occurs, the Node.js layer automatically runs a minimal AppleScript to surface the dialog and retries.

### JXA (Notes, Mail, Messages)

JXA-based tools require macOS Automation permissions. On first use, macOS will prompt you to allow `osascript` to control each app. Grant access via **System Settings > Privacy & Security > Automation**.

**Verification command:**

```bash
pnpm test -- src/swift/Info.plist.test.ts
```

### Full Disk Access (Messages)

The Messages tool reads `~/Library/Messages/chat.db` via SQLite (JXA message reading is broken on macOS Sonoma+). This database is protected by **Full Disk Access (FDA)**.

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

> **Note:** Version managers (Volta, nvm, fnm) use shims that point to a launcher, not the real binary. The System Settings file picker may not show binaries in hidden directories -- use the drag-and-drop method above instead. See `docs/CLOUDFLARE_SETUP.md` Step 10 for detailed instructions and troubleshooting.

## Quick Start

```bash
# Clone and install
git clone https://github.com/krmj22/macos-mcp.git
cd macos-mcp
pnpm install

# Build TypeScript and Swift binary
pnpm build
```

## Configuration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "macos-mcp": {
      "command": "node",
      "args": ["/path/to/macos-mcp/dist/index.js"]
    }
  }
}
```

### Cursor

1. Open Cursor Settings > MCP > Add new global MCP server
2. Configure:
    ```json
    {
      "mcpServers": {
        "macos-mcp": {
          "command": "node",
          "args": ["/path/to/macos-mcp/dist/index.js"]
        }
      }
    }
    ```

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
Send an email to alice@example.com about the meeting.
Reply to the last email from Bob.
```

### Messages
```
Show my recent iMessage chats.
Read messages from the chat with John.
Send "On my way!" to the group chat.
```

## Structured Prompt Library

The server ships with prompt templates exposed via MCP `ListPrompts` and `GetPrompt` endpoints:

- **daily-task-organizer** — optional `today_focus` input produces a same-day execution blueprint
- **smart-reminder-creator** — optional `task_idea` generates an optimally scheduled reminder
- **reminder-review-assistant** — optional `review_focus` to audit and optimize existing reminders
- **weekly-planning-workflow** — optional `user_ideas` guides a Monday-through-Sunday reset

Run `pnpm test -- src/server/prompts.test.ts` to validate prompt metadata and schema compatibility.

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

### Preflight Check

Verify your environment before starting the server:

```bash
node dist/index.js --check
```

This checks macOS version, Node.js version, EventKit binary, Full Disk Access, and JXA automation permissions.

### Dependencies

**Runtime:** `@modelcontextprotocol/sdk`, `exit-on-epipe`, `tsx`, `zod`

**Dev:** `typescript`, `jest`, `ts-jest`, `babel-jest`, `@biomejs/biome`

## Remote Access (HTTP Transport)

The server supports remote access from Claude iOS/web via Cloudflare Tunnel.

### Quick Start

```bash
# Copy example config
cp macos-mcp.config.example.json macos-mcp.config.json

# Start in HTTP mode
MCP_TRANSPORT=http MCP_HTTP_ENABLED=true node dist/index.js
```

### Configuration

Set via environment variables or `macos-mcp.config.json`:

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `stdio` | Transport mode: `stdio`, `http`, or `both` |
| `MCP_HTTP_ENABLED` | `false` | Enable HTTP transport |
| `MCP_HTTP_PORT` | `3847` | HTTP server port |

**Key design decisions:**
- **Stateless mode** — required for multi-client support (Claude.ai serves multiple users)
- **Root endpoint** — MCP handler at `/` (Claude expects this, not `/mcp`)
- **JSON fallback** — `enableJsonResponse: true` for clients without SSE support

For full Cloudflare Tunnel + Access setup, see [`docs/CLOUDFLARE_SETUP.md`](docs/CLOUDFLARE_SETUP.md).

> **Important:** When running via HTTP transport as a LaunchAgent, the Messages and Mail tools require Full Disk Access granted to the **actual node binary** (not a version manager shim). See the Troubleshooting section below.

## Troubleshooting

### Permission Quick Reference

| App | Permission | System Settings Path |
|-----|------------|---------------------|
| Reminders | Full Access | Privacy & Security > Reminders |
| Calendar | Full Access | Privacy & Security > Calendars |
| Notes | Automation | Privacy & Security > Automation > Notes |
| Mail | Automation | Privacy & Security > Automation > Mail |
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

### Full Disk Access for Messages & Mail

Both the Messages and Mail tools read SQLite databases protected by Full Disk Access.

**stdio transport (Claude Desktop, terminal):** Grant FDA to your terminal app (Terminal, iTerm2, etc.).

**HTTP transport (LaunchAgent):** Grant FDA to the **actual node binary**, not a version manager shim:

```bash
# Find the real node binary (not the shim)
node -e "console.log(process.execPath)"

# Reveal in Finder for drag-and-drop into FDA settings
open -R "$(node -e "console.log(process.execPath)")"

# Open FDA settings
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
```

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

## License

MIT

## Contributing

Contributions welcome! Please read the contributing guidelines first.
