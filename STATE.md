# Project State

Last updated: 2026-02-10 (Wave 1 of #65-79 plan complete)

## Overview

macOS MCP server providing native integration with Reminders, Calendar, Notes, Mail, Messages, and Contacts. Two backends: EventKit (Swift binary) for Reminders/Calendar, JXA (AppleScript) for Notes/Mail/Messages/Contacts. Messages reads use SQLite directly (JXA broken on Sonoma+).

## Codebase

- **Source**: ~10k LOC TypeScript across `src/`
- **Tests**: 552 unit tests, 28 test files, 96% statement coverage, all passing in 1.5s
- **Build**: TypeScript + Swift binary via `pnpm build`
- **Transport**: stdio (default) or HTTP (Cloudflare Tunnel to `mcp.kyleos.ai`)

## Tools

| Tool | Backend | Actions | E2E Status |
|------|---------|---------|------------|
| `reminders_tasks` | EventKit/Swift | read, create, update, delete | ALL PASS (<1s) |
| `reminders_lists` | EventKit/Swift | read, create, update, delete | ALL PASS (<400ms) |
| `calendar_events` | EventKit/Swift | read, create, update, delete | 20/21 — read-by-ID **FIXED** (#73 `be122e7`) |
| `calendar_calendars` | EventKit/Swift | read | PASS (461ms) |
| `notes_items` | JXA | read, create, update, delete, append | 16/17 — move-to-folder **FIXED** (#74 `1c61735`), search 24s (#78 open) |
| `notes_folders` | JXA | read, create | ALL PASS (<500ms, no delete via API) |
| `mail_messages` | JXA | read, create (draft), update, delete | 8/14 — inbox/search **FIXED** (#76 `df8bf7a`), needs E2E re-verify |
| `messages_chat` | SQLite + JXA | read, create (send) | 3/13 — enrichment TIMEOUT 60s (#75) |
| `contacts_people` | JXA | read, search, create, update, delete | 12/14 — search **FIXED** (#77 `b5c1430`), needs E2E re-verify |

## Contact Enrichment

Cross-tool intelligence layer resolves raw phone numbers and emails to contact names:
- **Messages**: phone numbers enriched to "Name (+1234567890)" format
- **Mail**: sender emails enriched to contact names
- **Calendar**: attendee emails enriched to contact names
- Toggle: `enrichContacts` param (default: true)
- Engine: `contactResolver.ts` — targeted JXA search for name-to-handles, cached bulk fetch for handle-to-name

## Recent Work (2026-02-09 to 2026-02-10)

| Commit | Description |
|--------|-------------|
| `be122e7` | **fix(calendar)**: bound findEventById to 4-year date range (fixes #73) |
| `1c61735` | **fix(notes)**: prevent double-escaping in move-to-folder (fixes #74) |
| `b5c1430` | **fix(contacts)**: use whose() predicate for search (fixes #77) |
| `df8bf7a` | **fix(mail)**: SOM-level access + whose() to prevent timeout (fixes #76) |
| `cee2366` | Removed dead JXA read paths from Messages — SQLite-only now |
| `62c0cb9` | Guard against null messages() in Mail mailbox iteration |
| `ac37dcf` | Improved workflow guidance for mail contact and notes append |
| `ea1bbbb` | Fixed dateRange being ignored on default chat list path |
| `29467db` | Replaced bulk contact fetch with targeted JXA search (15s timeout) |
| `0eafe05` | Added dateRange shortcuts (today/yesterday/this_week/last_7_days/last_30_days) |
| `ad112e3` | Added append mode for note updates |
| `8f7a94e` | Added startDate/endDate filtering for Messages |
| `74f395f` | Enhanced all 9 tool descriptions with behavioral prompting |
| `b7b383b` | Added structured tool dispatch logging |
| `83f7edc` | Surfaced Error.message in all modes (not just dev) |

## Unit Test Assessment

552 tests provide logic and formatting confidence but mock all OS calls:

| Layer | Confidence | Why |
|-------|-----------|-----|
| Validation (Zod), date filtering, phone normalization | **High** | Pure logic, no mocks |
| Handler formatting, Markdown output | **Medium** | Proves output format, mocked data |
| Tool routing dispatch | **Low** | 13+ tests that all fail together |
| EventKit CLI / JXA / SQLite integration | **None** | All mocked away |

~10-15% of tests are redundant (repeated pagination, routing). E2E tests needed for real system confidence.

## Open Issues

### E2E Test Results

| Issue | Scope | Result | Status |
|-------|-------|--------|--------|
| #64 | Reminders — tasks + lists CRUD | 24/24 PASS | CLOSED |
| #65 | Calendar — CRUD, recurrence, enrichment | 20/21 PASS | Open (bug #73) |
| #66 | Notes — CRUD, append, search | 16/17 PASS | Open (bugs #74, #78) |
| #67 | Mail — read, draft, reply, enrichment | 8/14 PASS | Open (bug #76) |
| #68 | Messages — read, search, date filtering | 3/13 PASS | Open (bug #75) |
| #69 | Contacts — CRUD, search | 12/14 PASS | Open (bug #77) |
| #70 | Cross-tool intelligence | — | Blocked on #65-69 |
| #71 | Performance benchmarks | — | Blocked on #65-69 |
| #72 | Unit test audit | — | P2, after E2E |

### Bug Fixes from E2E (Priority Order)

| Issue | Problem | Severity | Fix Complexity |
|-------|---------|----------|---------------|
| #73 | Calendar findEventById unbounded range | ~~P1~~ | **FIXED** `be122e7` — 4yr bounded date range |
| #74 | Notes move-to-folder double-escaping | ~~P1~~ | **FIXED** `1c61735` — %%placeholder%% pattern |
| #76 | Mail JXA read/search timeout 60s | ~~P0~~ | **FIXED** `df8bf7a` — SOM-level access + whose() |
| #77 | Contacts search iterates all 30s | ~~P1~~ | **FIXED** `b5c1430` — whose() predicate |
| #75 | Messages enrichment timeout 60s | P0 — blocks #1 use case | **OPEN** — Wave 2 |
| #78 | Notes search scans all 24s | P2 — slow but works | **OPEN** — Wave 2 |

## E2E Performance Baselines (2026-02-10)

| Tool | Backend | CRUD | Search | Default Read | Enrichment |
|------|---------|------|--------|-------------|------------|
| Reminders | EventKit/Swift | 42-203ms | 339ms | 981ms (cold), 338ms | N/A |
| Calendar | EventKit/Swift | 34-72ms | 51ms | FIXED (#73) — needs re-baseline | 59-67ms |
| Notes | JXA | 146-583ms | **24s (BUG #78 open)** | 2.0s | N/A |
| Mail | JXA | 563ms-2.5s | FIXED (#76) — needs re-baseline | FIXED (#76) — needs re-baseline | 1.1-3.6s (w/limit) |
| Messages | SQLite | N/A (read-only) | 135ms | **60s TIMEOUT (#75 open)** | **60s TIMEOUT (#75 open)** |
| Contacts | JXA | 161-955ms | FIXED (#77) — needs re-baseline | 6.4s (slow) | N/A |

Key finding: **`whose()` JXA predicates are fast (indexed), JS iteration over collections is O(n) and times out.**

## Known Limitations

- **Messages**: No delete/edit (Apple API limitation)
- **Notes folders**: No rename/delete via JXA (Apple API limitation)
- **Calendar recurring delete**: Only removes single occurrence
- **Mail create**: Creates draft only (user must click Send)
- **Contacts update**: Basic fields only (name, org, jobTitle, note)
- **JXA `collection.method()` is O(n)**: Always use `whose()` predicates for search/filter, never JS iteration
- **EventKit date range limit**: `predicateForEvents` cannot span >4 years
- **Contact enrichment at scale**: Per-handle JXA lookups don't scale beyond ~10 participants

## Infrastructure

- **Production**: LaunchAgent `com.macos-mcp.server` on Mac Mini
- **Tunnel**: Cloudflare Tunnel `com.cloudflare.macos-mcp-tunnel` at `mcp.kyleos.ai:3847`
- **After restart**: Always restart both server AND tunnel LaunchAgents
