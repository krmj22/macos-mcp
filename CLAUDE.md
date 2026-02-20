# CLAUDE.md

Guidance for Claude Code working with this macOS MCP server.

**Read [INTENT.md](INTENT.md) first.** Every decision must serve the intent. When in doubt, reference it.

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Build TypeScript + Swift binary (required before running)
pnpm test             # Run all tests
pnpm lint             # Lint and format with Biome
pnpm dev              # Run from source via tsx (stdio only, no build needed)
pnpm test:e2e         # Build + run functional E2E tests (node:test, real OS calls)
pnpm test:e2e:all     # Build + run ALL per-tool E2E suites (serial, no JXA contention)
pnpm release:preview  # Dry-run semantic-release (shows next version + changelog)
node dist/index.js --check  # Preflight validation (macOS, Node, FDA, JXA permissions)
```

**Note:** `bin/run.cjs` runs compiled `dist/index.js`. You must `pnpm build` before the server will start. Use `pnpm dev` for quick source-level iteration (stdio transport only — HTTP transport requires compiled output).

## Current State

See [STATE.md](STATE.md) for tool matrix, open issues, performance baselines, and known limitations.

## Known Gotchas

- **Calendar**: Recurring event deletion only removes single occurrence (uses `.thisEvent` span)
- **Notes folders**: No rename/delete via JXA (Apple API limitation)
- **Messages**: No delete/edit via JXA or SQLite (Apple API limitation)
- **Mail create**: Creates draft only — user must click Send in Mail.app
- **Mail reads**: Use SQLite (`~/Library/Mail/V10/MailData/Envelope Index`), JXA for writes only. See ADR-001 in DECISION.md
- **Gmail labels**: All messages live in `[Gmail]/All Mail`. Folder membership (Inbox, Business, etc.) is in the `labels` join table. Both `listInboxMessages()` and `listMailboxMessages()` check this. See ADR-001 addendum
- **JXA rule**: Always use `whose()` predicates for search, never JS iteration over collections

### Messages JXA Broken (Sonoma+)

JXA `c.messages()` throws "Can't convert types". All message reads use SQLite at `~/Library/Messages/chat.db` (JXA read paths removed in `cee2366`). Requires **Full Disk Access** for the process reading the database:
- **stdio transport**: Grant Full Disk Access to your terminal app (Terminal, iTerm2, etc.)
- **HTTP transport (LaunchAgent)**: Grant Full Disk Access to the **actual node binary** (not a version manager shim). See `docs/CLOUDFLARE_SETUP.md` Step 11 for detailed instructions including troubleshooting.

**Quick FDA setup commands:**
```bash
# Find the actual node binary (not the shim)
node -e "console.log(process.execPath)"

# Reveal it in Finder for drag-and-drop into FDA settings
open -R "$(node -e "console.log(process.execPath)")"

# Open the Full Disk Access settings pane
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
```

> **Volta users:** `~/.volta/bin/node` is a shim that points to `volta-shim`. You need the resolved path under `~/.volta/tools/image/node/<VERSION>/bin/node`. Use `volta which node` or `node -e "console.log(process.execPath)"` to get it.

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

**Important:** When running via HTTP transport as a LaunchAgent, the Messages tool requires Full Disk Access granted to the actual node binary (not a shim). See `docs/CLOUDFLARE_SETUP.md` Step 11 for setup and troubleshooting.

## Architecture

MCP server providing native macOS integration via two bridges:

- **EventKit (Swift binary)** — Reminders, Calendar
- **JXA (JavaScript for Automation)** — Notes, Mail, Contacts (Messages send only)
- **SQLite** — Messages reads (`~/Library/Messages/chat.db`), Mail reads (`~/Library/Mail/V10/MailData/Envelope Index`)

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
│   ├── cliExecutor.ts          # Swift binary execution + permission retry
│   ├── contactResolver.ts      # Cross-tool contact enrichment (name ↔ phone/email)
│   ├── jxaExecutor.ts          # JXA/AppleScript execution + retry logic
│   ├── logging.ts              # Structured error logging (tool failures → stderr)
│   ├── sqliteContactReader.ts  # Contact enrichment cache via AddressBook SQLite (ADR-002)
│   ├── sqliteMailReader.ts     # Mail SQLite reader (ADR-001)
│   ├── sqliteMessageReader.ts  # Messages SQLite reader
│   └── preflight.ts            # Startup --check validation
└── validation/
    └── schemas.ts       # Zod schemas
```

### Data Flow

**EventKit** (Reminders, Calendar): Handler → Repository → `executeCli()` → Swift binary → JSON response

**JXA** (Notes, Mail, Messages, Contacts): Handler → `buildScript()` → `executeJxaWithRetry()` → osascript → JSON response

### Key Patterns

- **Zod validation**: All inputs validated via schemas in `validation/schemas.ts`
- **Error handling**: Use `handleAsyncOperation()` wrapper from `errorHandling.ts`. Permission/access errors include System Settings deep-link URLs via `createCliPermissionHint()`, `createFdaHint()`, and JXA automation hints.
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

## Testing Strategy

**Philosophy: AI-First Testing Protocol**
1.  **Safety Gates > Coverage %**: High coverage is a side effect of good testing, not the goal. We use 95% thresholds to force the AI to consider edge cases, but we trust E2E tests for actual reliability.
2.  **Protocol**:
    - **Step 1**: Write the feature (AI).
    - **Step 2**: Run `pnpm test --coverage`.
    - **Step 3**: If coverage drops, the AI *must* write tests for the uncovered branches. This finds hidden bugs (null checks, error handling).
3.  **Real Data is King**: Mocks are for speed; E2E tests against real macOS apps are for truth. If it passes unit tests but fails on a real Mac, the test was wrong.

**Implementation**
- **Unit**: Jest with ts-jest ESM preset. Coverage thresholds in `jest.config.mjs` (95%/80%/95%/95% stmts/branches/funcs/lines).
- **E2E**: `pnpm test:e2e` — node:test suite, real MCP client via stdio, creates/reads/deletes actual items.
  - Tests use `[E2E-TEST]` prefix for cleanup identification.
  - Separate from Jest to avoid coverage threshold conflicts.
- **Mock CLI**: `src/utils/__mocks__/cliExecutor.ts`
- **Mock JXA**: `src/tools/jxaHandlers.test.ts`

## Development Workflow

This is a public repository.

- **Features and fixes** → branch + PR. Issue first, descriptive branch name (`fix/notes-newline-rendering`, `feat/calendar-recurring`), link the issue (`Closes #XX`)
- **Chores, docs, config** → direct to `main` is fine. No PR ceremony for trivial changes
- The pre-push hook (`scripts/hooks/pre-push`) runs tests + build automatically — that's the safety net, not the PR process

## Releasing

Before any release (version bump, `chore(release):` commit, or npm publish):

1. **Run `pnpm release:preview`** — this dry-runs semantic-release and shows what version will be created and which commits drive it
2. **Verify the version bump is intentional** — a `fix:` commit triggers a patch, `feat:` triggers a minor, `BREAKING CHANGE:` triggers a major. If the bump doesn't match intent, fix the commit messages on the branch before merging
3. **Never skip this step** — catching a wrong version bump after merge means a follow-up release to fix it

The pre-push hook runs `pnpm test` + `pnpm build` automatically. You do not need to run those manually before pushing.

## Commits

See `~/.claude/CLAUDE.md` for commit guidelines. Use `/commit` skill.

Key project patterns:
- Conventional commits: `feat(tool):`, `fix(handler):`, `refactor(utils):`
- Link issues: `Closes #XX`, `Fixes #XX`, `(#XX)`
- Reference ADRs when implementing architectural decisions
