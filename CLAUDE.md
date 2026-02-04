# CLAUDE.md

Guidance for Claude Code working with this macOS MCP server.

## Commands

```bash
pnpm install          # Install dependencies
pnpm build            # Build TypeScript + Swift binary (required before running)
pnpm test             # Run all tests
pnpm lint             # Lint and format with Biome
```

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
| `messages_chat` | read, create | `chatId`, `search`, `to` | ⚠️ Chat listing broken (#23) |
| `contacts_people` | read, create, ~~update~~, delete | `search`, `id` | ⚠️ Update/search broken (#21) |

Both underscore (`reminders_tasks`) and dot notation (`reminders.tasks`) work.

## Known Issues & Permissions

### Known Bugs (as of 2026-02-04)

| Issue | Subsystem | Problem | File |
|-------|-----------|---------|------|
| #21 | Contacts | Update/search fail - JXA errors | `contactsHandlers.ts` |
| #23 | Messages | Chat listing fails (SQLite fallback missing) | `messagesHandlers.ts` |

### Minor Issues

- **Calendar**: Recurring event deletion only removes single occurrence (uses `.thisEvent` span)

### Messages JXA Broken (Sonoma+)

JXA `c.messages()` throws "Can't convert types". Server auto-falls back to SQLite at `~/Library/Messages/chat.db`. Requires **Full Disk Access** for terminal app.

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

## Architecture

MCP server providing native macOS integration via two bridges:

- **EventKit (Swift binary)** — Reminders, Calendar
- **JXA (JavaScript for Automation)** — Notes, Mail, Messages, Contacts

### Key Files

```
src/
├── tools/
│   ├── definitions.ts    # MCP tool schemas (dependentSchemas for validation)
│   ├── index.ts          # Tool routing
│   └── handlers/         # Domain handlers (reminderHandlers.ts, notesHandlers.ts, etc.)
├── utils/
│   ├── cliExecutor.ts    # Swift binary execution + permission retry
│   ├── jxaExecutor.ts    # JXA/AppleScript execution + retry logic
│   └── sqliteMessageReader.ts  # Messages SQLite fallback
└── validation/
    └── schemas.ts        # Zod schemas
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
