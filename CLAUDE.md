# CLAUDE.md

**Read [INTENT.md](INTENT.md) first.** Every decision must serve the intent.

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
```

`bin/run.cjs` runs compiled `dist/index.js` — requires `pnpm build`. Use `pnpm dev` for source-level iteration (stdio only).

## Current State

See [STATE.md](STATE.md) for tool matrix, open issues, performance baselines, and known limitations.

## Known Gotchas

- **Calendar**: Recurring event deletion only removes single occurrence (`.thisEvent` span)
- **Notes folders**: No rename/delete via JXA (Apple API limitation)
- **Messages**: No delete/edit via JXA or SQLite (Apple API limitation)
- **Messages reads**: JXA broken on Sonoma+ — all reads use SQLite at `~/Library/Messages/chat.db`
- **Mail create**: Creates draft only — user must click Send in Mail.app
- **Mail reads**: Use SQLite (`~/Library/Mail/V10/MailData/Envelope Index`), JXA for writes only. See ADR-001
- **Gmail labels**: Messages live in `[Gmail]/All Mail`. Folder membership is in the `labels` join table. Both `listInboxMessages()` and `listMailboxMessages()` check this. See ADR-001 addendum
- **JXA rule**: Always use `whose()` predicates for search, never JS iteration over collections

## Architecture

Three bridges to Apple apps:

- **EventKit (Swift binary)** — Reminders, Calendar
- **JXA** — Notes, Mail writes, Contacts, Messages send
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

- **EventKit**: Handler → Repository → `executeCli()` → Swift binary → JSON
- **JXA**: Handler → `buildScript()` → `executeJxaWithRetry()` → osascript → JSON

### Key Patterns

- **Zod validation**: All inputs validated via schemas in `validation/schemas.ts`
- **Error handling**: Use `handleAsyncOperation()` from `errorHandling.ts`. Permission errors include System Settings deep-link URLs.
- **JXA safety**: Always use `sanitizeForJxa()` before interpolating user input
- **Date formats**: `YYYY-MM-DD HH:mm:ss` for local time, ISO 8601 for UTC

### HTTP Transport Design

- **Stateless mode**: Required for multi-client support
- **Root endpoint**: MCP handler at `/` (Claude expects this, not `/mcp`)
- **JSON fallback**: `enableJsonResponse: true` for clients without SSE support
- Config: env vars or `macos-mcp.config.json`. See README for options.

## Testing

- **Unit**: Jest with ts-jest ESM. Coverage thresholds in `jest.config.mjs` (95%/80%/95%/95%). If coverage drops, write tests for uncovered branches.
- **E2E**: `pnpm test:e2e` — node:test suite, real MCP client, real OS calls. Tests use `[E2E-TEST]` prefix for cleanup.
- **Mocks**: `src/utils/__mocks__/cliExecutor.ts`, `src/tools/jxaHandlers.test.ts`

## Development Workflow

This is a public repository.

- **Features and fixes** → branch + PR. Issue first, link it (`Closes #XX`)
- **Chores, docs, config** → direct to `main`. No PR ceremony for trivial changes
- Pre-push hook (`scripts/hooks/pre-push`) runs tests + build automatically

## Releasing

Before any release, run `pnpm release:preview` and verify the version bump matches intent. `fix:` → patch, `feat:` → minor, `BREAKING CHANGE:` → major.

## Commits

Use `/commit` skill.
