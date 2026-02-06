# CLAUDE.md

Guidance for Claude Code working with this macOS MCP server.

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Build TypeScript + Swift binary (required before running)
pnpm test             # Run all tests
pnpm lint             # Lint and format with Biome
pnpm dev              # Run from source via tsx (stdio only, no build needed)
```

**Note:** `bin/run.cjs` (used by `.mcp.json`) runs compiled `dist/index.js`. You must `pnpm build` before the server will start. Use `pnpm dev` for quick source-level iteration (stdio transport only — HTTP transport requires compiled output).

## Tools & Capabilities

| Tool | Actions | Key Parameters | Status |
|------|---------|----------------|--------|
| `reminders_tasks` | read, create, update, delete | `filterList`, `dueWithin`, `search` | ✅ Working |
| `reminders_lists` | read, create, update, delete | `name` | ✅ Working |
| `calendar_events` | read, create, update, delete | `startDate`, `endDate`, `calendarName`, `recurrence` | ✅ Working |
| `calendar_calendars` | read | — | ✅ Working |
| `notes_items` | read, create, update, delete | `search`, `folderId`, `limit`, `offset`, `targetFolderId` | ✅ Working |
| `notes_folders` | read, create | `name` | ✅ Working (no delete via API) |
| `mail_messages` | read, create (draft), update, delete | `mailbox`, `replyToId`, `cc`, `bcc` | ✅ Working (creates draft) |
| `messages_chat` | read, create | `chatId`, `search`, `to` | ✅ Working (SQLite fallback) |
| `contacts_people` | read, create, delete | `id` | ⚠️ Update/search deferred |

Both underscore (`reminders_tasks`) and dot notation (`reminders.tasks`) work.

## Known Issues & Permissions

### Known Bugs (as of 2026-02-04)

Currently no critical bugs. Deferred work tracked in separate issues.

### Minor Issues

- **Calendar**: Recurring event deletion only removes single occurrence (uses `.thisEvent` span)

### Messages JXA Broken (Sonoma+)

JXA `c.messages()` throws "Can't convert types". Server auto-falls back to SQLite at `~/Library/Messages/chat.db`. Requires **Full Disk Access** for the process reading the database:
- **stdio transport**: Grant Full Disk Access to your terminal app (Terminal, iTerm2, etc.)
- **HTTP transport (LaunchAgent)**: Grant Full Disk Access to the **node binary** itself (e.g., `~/.volta/bin/node` or `/opt/homebrew/bin/node`). See `docs/CLOUDFLARE_SETUP.md` Step 10 for detailed instructions.

### Permission Requirements

| App | Permission | Location |
|-----|------------|----------|
| Reminders | Full Access | Privacy & Security → Reminders |
| Calendar | Full Access | Privacy & Security → Calendars |
| Notes | Automation | Privacy & Security → Automation → Notes |
| Mail | Automation | Privacy & Security → Automation → Mail |
| Messages | Automation + Full Disk Access | Both locations |
| Contacts | Automation | Privacy & Security → Automation → Contacts |

Swift binary permission dialogs may not appear in non-interactive contexts. The server proactively triggers an AppleScript prompt before the first EventKit call.

## HTTP Transport (Remote Access)

Supports Claude iOS/web via Cloudflare Tunnel. See `docs/CLOUDFLARE_SETUP.md` for full setup guide.

**Quick Start:**
```bash
# Copy example config
cp macos-mcp.config.example.json macos-mcp.config.json

# Start in HTTP mode
MCP_TRANSPORT=http MCP_HTTP_ENABLED=true node dist/index.js
```

**Key Design Decisions:**
- **Stateless mode**: Required for multi-client support (Claude.ai serves multiple users)
- **Root endpoint**: MCP handler at `/` (Claude expects this, not `/mcp`)
- **JSON fallback**: `enableJsonResponse: true` for clients without SSE support

**Config Options** (env vars or `macos-mcp.config.json`):
| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `stdio` | `stdio`, `http`, or `both` |
| `MCP_HTTP_ENABLED` | `false` | Enable HTTP transport |
| `MCP_HTTP_PORT` | `3847` | HTTP server port |

**Important:** When running via HTTP transport as a LaunchAgent, the Messages tool requires Full Disk Access granted to the node binary. See `docs/CLOUDFLARE_SETUP.md` Step 10 for setup instructions.

## Architecture

MCP server providing native macOS integration via two bridges:

- **EventKit (Swift binary)** — Reminders, Calendar
- **JXA (JavaScript for Automation)** — Notes, Mail, Messages, Contacts

### Key Files

```
src/
├── config/              # Configuration system
│   ├── schema.ts        # Zod schemas for config validation
│   └── index.ts         # loadConfig() - file + env var loading
├── server/
│   ├── server.ts        # MCP server factory
│   └── transports/http/ # HTTP transport layer
│       ├── index.ts     # Express + StreamableHTTPServerTransport
│       ├── auth.ts      # Cloudflare Access JWT verification
│       ├── middleware.ts # Rate limiting, logging, CORS
│       └── health.ts    # /health endpoints
├── tools/
│   ├── definitions.ts   # MCP tool schemas (dependentSchemas for validation)
│   ├── index.ts         # Tool routing
│   └── handlers/        # Domain handlers (reminderHandlers.ts, notesHandlers.ts, etc.)
├── utils/
│   ├── cliExecutor.ts   # Swift binary execution + permission retry
│   ├── jxaExecutor.ts   # JXA/AppleScript execution + retry logic
│   ├── logging.ts       # Structured error logging (tool failures → stderr)
│   └── sqliteMessageReader.ts  # Messages SQLite fallback
└── validation/
    └── schemas.ts       # Zod schemas
```

### Data Flow

**EventKit** (Reminders, Calendar): Handler → Repository → `executeCli()` → Swift binary → JSON response

**JXA** (Notes, Mail, Messages, Contacts): Handler → `buildScript()` → `executeJxaWithRetry()` → osascript → JSON response

### Key Patterns

- **Zod validation**: All inputs validated via schemas in `validation/schemas.ts`
- **Error handling**: Use `handleAsyncOperation()` wrapper from `errorHandling.ts`
- **JXA safety**: Always use `sanitizeForJxa()` before interpolating user input
- **Date formats**: `YYYY-MM-DD HH:mm:ss` for local time, ISO 8601 for UTC

## Direct Data Access (Debugging)

When MCP tools aren't available:

```bash
# Messages (SQLite - most reliable on modern macOS)
sqlite3 -json ~/Library/Messages/chat.db "
SELECT m.text, m.is_from_me,
       datetime(m.date/1000000000 + strftime('%s','2001-01-01'), 'unixepoch', 'localtime') as time
FROM message m ORDER BY m.date DESC LIMIT 20"

# Notes
osascript -l JavaScript -e 'Application("Notes").notes.slice(0,5).map(n=>n.name())'

# Mail
osascript -l JavaScript -e 'Application("Mail").inbox().messages.slice(0,5).map(m=>m.subject())'

# Contacts
osascript -l JavaScript -e 'Application("Contacts").people.slice(0,5).map(p=>p.name())'
```

**Apple timestamp**: nanoseconds since 2001-01-01. Convert with `datetime(date/1000000000 + strftime('%s','2001-01-01'), 'unixepoch', 'localtime')`

## Testing

- Jest with ts-jest ESM preset
- Coverage threshold: 96% statements, 90% branches
- Mock CLI: `src/utils/__mocks__/cliExecutor.ts`
- Mock JXA: `src/tools/jxaHandlers.test.ts`

## Commits

See `~/.claude/CLAUDE.md` for commit guidelines. Use `/commit` skill.

Key project patterns:
- Conventional commits: `feat(tool):`, `fix(handler):`, `refactor(utils):`
- Link issues: `Closes #XX`, `Fixes #XX`, `(#XX)`
- Reference ADRs when implementing architectural decisions
