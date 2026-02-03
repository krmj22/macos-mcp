# Handoff: macos-mcp Integration Testing Complete

**Date:** 2026-02-03
**Session:** Integration testing all 6 subsystems

## Status

Integration testing complete. 3 critical bugs found and documented.

## Next Actions (Priority Order)

### 1. Fix Contacts (#21) - Easiest
**File:** `src/tools/handlers/contactsHandlers.ts:369-376`
```javascript
// Change this:
Contacts.Email({value: "...", label: "..."}).pushOnto(person.emails);
// To this:
person.emails.push(Contacts.Email({value: "...", label: "..."}));
```

### 2. Fix Mail (#20) - Medium
**File:** `src/tools/handlers/mailHandlers.ts:208`
- Remove `Mail.send(msg)` from create action
- Create should save draft, not send

### 3. Fix Reminders Lists (#19) - Hardest
**File:** `src/swift/EventKitCLI.swift:332`
```swift
// Add source assignment:
if let defaultSource = eventStore.defaultCalendarForNewReminders()?.source {
    list.source = defaultSource
}
```

## Open Issues

| Issue | Description |
|-------|-------------|
| #19 | Reminders list creation fails |
| #20 | Mail create sends instead of drafts |
| #21 | Contacts create/update/search broken |
| #22 | Full roadmap to professional status |

## Manual Cleanup Needed

- **Notes app:** Delete "MCP Test Folder" and "MCP Test Folder 2"

## Working Features (Verified)

- Reminders: tasks CRUD
- Calendar: events CRUD + recurrence (PR #17)
- Notes: items CRUD + folder move (PR #16)
- Messages: read/create via SQLite fallback
- Contacts: read, delete (PR #15)

## Commands

```bash
cd ~/Projects/macos-mcp
pnpm build && pnpm test
```
