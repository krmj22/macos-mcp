# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
pnpm install

# Build TypeScript and Swift binary (required before running)
pnpm build

# Run all tests
pnpm test

# Run a single test file
pnpm test -- src/path/to/file.test.ts

# Lint and format with Biome
pnpm lint
```

## Architecture

This is an MCP (Model Context Protocol) server providing native macOS integration with seven Apple apps: **Reminders**, **Calendar**, **Notes**, **Mail**, **Messages**, and **Contacts**. The server uses two bridging strategies:

- **EventKit (Swift binary)** — Reminders and Calendar
- **JXA (JavaScript for Automation)** — Notes, Mail, Messages, Contacts

### Layer Structure

```
src/
├── index.ts              # Entry point: loads config, starts server
├── server/
│   ├── server.ts         # MCP server setup with stdio transport
│   ├── handlers.ts       # Request handler registration (tools, prompts)
│   ├── prompts.ts        # Prompt template definitions and builders
│   └── promptAbstractions.ts
├── tools/
│   ├── definitions.ts    # MCP tool schemas (uses dependentSchemas for conditional validation)
│   ├── index.ts          # Tool routing: normalizes names, dispatches to handlers
│   └── handlers/         # Domain-specific CRUD handlers
│       ├── reminderHandlers.ts   # EventKit — reminders CRUD
│       ├── listHandlers.ts       # EventKit — reminder lists CRUD
│       ├── calendarHandlers.ts   # EventKit — calendar events CRUD
│       ├── notesHandlers.ts      # JXA — notes CRUD + folder management
│       ├── mailHandlers.ts       # JXA — mail read/send/reply/delete
│       ├── messagesHandlers.ts   # JXA — iMessage read/send
│       ├── contactsHandlers.ts   # JXA — contacts read/search/create
│       ├── shared.ts             # Shared formatting (formatListMarkdown, extractAndValidateArgs)
│       └── index.ts              # Handler barrel export
├── utils/
│   ├── cliExecutor.ts          # Executes Swift binary, parses JSON responses
│   ├── jxaExecutor.ts          # Executes JXA/AppleScript via osascript, with retry logic
│   ├── permissionPrompt.ts     # AppleScript-based permission prompting
│   ├── reminderRepository.ts   # Repository pattern for reminders
│   ├── calendarRepository.ts   # Repository pattern for calendar events
│   ├── binaryValidator.ts      # Secure binary path validation
│   └── errorHandling.ts        # Centralized async error wrapper (JxaError hints)
├── validation/
│   └── schemas.ts        # Zod schemas for input validation
└── types/
    └── index.ts          # TypeScript interfaces and type constants
```

### Data Flow

#### EventKit Path (Reminders, Calendar)

1. MCP client sends tool call via stdio
2. `handlers.ts` routes to `handleToolCall()` in `tools/index.ts`
3. Tool router normalizes name (supports both `reminders_tasks` and `reminders.tasks`)
4. Action router dispatches to specific handler (e.g., `handleCreateReminder`)
5. Handler validates input via Zod schema, calls repository
6. Repository calls `executeCli()` which:
   - Proactively triggers AppleScript permission prompt on first access
   - Runs Swift binary for EventKit operations
   - Retries with AppleScript fallback on permission errors
7. Swift binary performs EventKit operations, returns JSON
8. Response flows back through layers as `CallToolResult`

#### JXA Path (Notes, Mail, Messages, Contacts)

1. MCP client sends tool call via stdio
2. `handlers.ts` routes to `handleToolCall()` in `tools/index.ts`
3. Tool router dispatches to JXA handler (e.g., `handleReadNotes`)
4. Handler validates input via Zod schema
5. Handler builds JXA script from template using `buildScript()` (parameter interpolation)
6. Script executes via `executeJxaWithRetry()` or `executeJxa()`:
   - Runs `osascript -l JavaScript` with the script
   - `executeJxaWithRetry` adds retry on transient failures
   - Parses JSON result from stdout
7. Response flows back through layers as `CallToolResult`

### Permission Handling

The server implements a two-layer permission prompt strategy for EventKit:

1. **Proactive AppleScript Prompt**: On the first access to reminders or calendars, `executeCli()` proactively triggers an AppleScript command to ensure the permission dialog appears, even in non-interactive contexts where the Swift binary's native EventKit permission request may be suppressed.

2. **Swift Binary Permission Check**: The Swift binary checks authorization status and requests permissions through EventKit's native API.

3. **Retry with AppleScript Fallback**: If a permission error occurs after the Swift binary runs, the system retries once with the AppleScript fallback.

JXA-based tools rely on macOS Automation permissions (System Settings > Privacy & Security > Automation). The user must grant access for `osascript` to control Notes, Mail, Messages, and Contacts.

### Swift Bridge

The `bin/EventKitCLI` binary handles all native macOS EventKit operations. TypeScript communicates via JSON:

```typescript
// CLI returns: { "status": "success", "result": {...} } or { "status": "error", "message": "..." }
const result = await executeCli<Reminder[]>(['--action', 'read', '--showCompleted', 'true']);
```

### JXA Bridge

The `utils/jxaExecutor.ts` module handles all JXA script execution:

```typescript
// Build script from template with parameter interpolation
const script = buildScript(TEMPLATE, { id: "note-123", limit: "50" });
// Execute with retry logic
const result = await executeJxaWithRetry<NoteItem[]>(script, 30000, 'Notes');
```

Key functions:
- `executeJxa<T>(script, timeout, app)` — single execution, throws `JxaError` on failure
- `executeJxaWithRetry<T>(script, timeout, app)` — retries once on transient errors
- `executeAppleScript(script, timeout, app)` — for AppleScript (non-JXA) execution
- `buildScript(template, params)` — replaces `{{key}}` placeholders in script templates
- `sanitizeForJxa(input)` — escapes strings for safe JXA interpolation

## Key Patterns

### Zod Schema Validation

All handler inputs are validated through Zod schemas in `validation/schemas.ts`. The tool definitions use `dependentSchemas` for conditional validation based on action type.

### Repository Pattern

Data access for EventKit tools is abstracted through repositories (`reminderRepository.ts`, `calendarRepository.ts`) that handle CLI execution and response mapping.

### Error Handling

Use `handleAsyncOperation()` wrapper from `errorHandling.ts` for consistent error formatting. JXA errors (`JxaError`) include app name and timeout hints:

```typescript
return handleAsyncOperation(async () => {
  // operation logic
}, 'operation description');
```

### Tool Naming

Tools support both underscore and dot notation:
- `reminders_tasks` / `reminders.tasks` — Reminder CRUD
- `reminders_lists` / `reminders.lists` — Reminder list management
- `calendar_events` / `calendar.events` — Calendar event CRUD
- `calendar_calendars` / `calendar.calendars` — Calendar listing
- `notes_items` / `notes.items` — Notes CRUD
- `notes_folders` / `notes.folders` — Notes folder management
- `mail_messages` / `mail.messages` — Mail read/send/reply/delete
- `messages_chat` / `messages.chat` — iMessage read/send
- `contacts_people` / `contacts.people` — Contacts read/search/create

### Shared Formatting

JXA handlers use shared utilities from `handlers/shared.ts`:
- `formatListMarkdown(title, items, formatter, emptyMsg, pagination?)` — consistent list output with pagination headers
- `extractAndValidateArgs(args, schema)` — strips `action` field and validates via Zod

## Testing

- Tests use Jest with ts-jest ESM preset
- Mock the CLI executor in `src/utils/__mocks__/cliExecutor.ts`
- JXA handler tests in `src/tools/jxaHandlers.test.ts` mock `jxaExecutor.ts`
- Coverage threshold: 96% statements, 90% branches
- Swift binary tests in `src/swift/Info.plist.test.ts` validate permission keys

## Critical Constraints

- **macOS only**: Requires EventKit framework and JXA/osascript
- **Permission handling**: Swift layer manages `EKEventStore.authorizationStatus()`; JXA requires Automation permissions
- **Binary security**: Path validation in `binaryValidator.ts` restricts allowed binary locations
- **Date formats**: Prefer `YYYY-MM-DD HH:mm:ss` for local time, ISO 8601 with timezone for UTC
- **JXA string safety**: Always use `sanitizeForJxa()` before interpolating user input into JXA scripts

## Quick Tool Reference

| Tool | Actions | Key Parameters |
|------|---------|----------------|
| `reminders_tasks` | read, create, update, delete | `filterList`, `dueWithin`, `search` |
| `reminders_lists` | read, create, update, delete | `name` |
| `calendar_events` | read, create, update, delete | `startDate`, `endDate`, `calendarName` |
| `calendar_calendars` | read | - |
| `notes_items` | read, create, update, delete | `search`, `folderId`, `limit`, `offset` |
| `notes_folders` | read, create | `name` |
| `mail_messages` | read, create, update, delete | `mailbox`, `account`, `replyToId`, `cc`, `bcc` |
| `messages_chat` | read, create | `chatId`, `search`, `searchMessages`, `to` |
| `contacts_people` | read, search, create | `search`, `firstName`, `lastName`, `email`, `phone` |

Both underscore (`reminders_tasks`) and dot notation (`reminders.tasks`) work identically.

## Known Issues & Workarounds

### Messages JXA Broken (Sonoma+)

JXA `c.messages()` throws "Can't convert types" on modern macOS. The server automatically falls back to SQLite:

1. **First attempt**: JXA (works on older macOS)
2. **Fallback**: SQLite at `~/Library/Messages/chat.db`

SQLite requires **Full Disk Access** for your terminal app:
- System Settings → Privacy & Security → Full Disk Access → Enable for Terminal/iTerm

### Permission Dialog Suppression

Swift binary permission dialogs may not appear in non-interactive contexts. The server proactively triggers an AppleScript prompt before the first EventKit call to ensure the dialog surfaces.

## Permission Troubleshooting

| App | Permission | Location |
|-----|------------|----------|
| Reminders | Full Access | Privacy & Security → Reminders |
| Calendar | Full Access | Privacy & Security → Calendars |
| Notes | Automation | Privacy & Security → Automation → Notes |
| Mail | Automation | Privacy & Security → Automation → Mail |
| Messages | Automation + Full Disk Access | Automation → Messages, Full Disk Access |
| Contacts | Automation | Privacy & Security → Automation → Contacts |

## Verification Commands

```bash
# Test all tools work
pnpm test

# Test specific subsystems
pnpm test -- src/swift/Info.plist.test.ts      # Permission keys declared
pnpm test -- src/tools/jxaHandlers.test.ts     # JXA handlers
pnpm test -- src/utils/cliExecutor.test.ts     # CLI with retry logic

# Quick smoke test (requires permissions granted)
node dist/index.js  # Start server, test via MCP client
```

## Direct Data Access (Debugging)

When MCP tools aren't available, access data directly:

```bash
# Messages (SQLite - most reliable on modern macOS)
sqlite3 -json ~/Library/Messages/chat.db "
SELECT m.text, m.is_from_me,
       datetime(m.date/1000000000 + strftime('%s','2001-01-01'), 'unixepoch', 'localtime') as time
FROM message m ORDER BY m.date DESC LIMIT 20"

# Notes (JXA - works reliably)
osascript -l JavaScript -e 'Application("Notes").notes.slice(0,5).map(n=>n.name())'

# Mail (JXA - works reliably)
osascript -l JavaScript -e 'Application("Mail").inbox().messages.slice(0,5).map(m=>m.subject())'

# Contacts (JXA - works reliably)
osascript -l JavaScript -e 'Application("Contacts").people.slice(0,5).map(p=>p.name())'
```

### Apple Timestamp Conversion

Messages database uses nanoseconds since 2001-01-01:
- **SQLite**: `datetime(date/1000000000 + strftime('%s','2001-01-01'), 'unixepoch', 'localtime')`
- **JavaScript**: `new Date(new Date('2001-01-01').getTime() + timestamp / 1_000_000)`

## CRUD Capabilities

| Subsystem | Create | Read | Update | Delete | Move | Limitations |
|-----------|:------:|:----:|:------:|:------:|:----:|-------------|
| **Reminders** | ✅ | ✅ | ✅ | ✅ | ✅ | No priority, recurrence, attachments |
| **Reminder Lists** | ✅ | ✅ | ✅ | ✅ | — | Full CRUD |
| **Calendar Events** | ✅ | ✅ | ✅ | ✅ | ✅ | No attendees, recurrence, alerts |
| **Calendars** | ❌ | ✅ | ❌ | ❌ | — | Read-only |
| **Notes** | ✅ | ✅ | ✅ | ✅ | ❌ | Cannot move between folders |
| **Note Folders** | ✅ | ✅ | ❌ | ❌ | — | No rename/delete |
| **Mail** | ✅ | ✅ | ⚠️ | ✅ | ❌ | Update = read/unread only, no attachments |
| **Messages** | ✅ | ✅ | ❌ | ❌ | — | Send/read only, no edit/delete |
| **Contacts** | ✅ | ✅ | ❌ | ❌ | — | No update/delete |