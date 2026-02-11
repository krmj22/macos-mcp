# Project State

Last updated: 2026-02-11 (Wave 1 verified, 5 issues closed)

## Overview

macOS MCP server providing native integration with Reminders, Calendar, Notes, Mail, Messages, and Contacts. Three backends: EventKit (Swift binary) for Reminders/Calendar, JXA (AppleScript) for Notes/Mail writes/Contacts, SQLite for Messages and Mail reads. See ADR-001 in DECISION.md.

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
| `calendar_events` | EventKit/Swift | read, create, update, delete | 21/21 — #73 CLOSED, verified 646ms |
| `calendar_calendars` | EventKit/Swift | read | PASS (461ms) |
| `notes_items` | JXA | read, create, update, delete, append | 17/17 — #74 CLOSED (1.9s), #78 CLOSED (973ms) |
| `notes_folders` | JXA | read, create | ALL PASS (<500ms, no delete via API) |
| `mail_messages` | SQLite + JXA | read, create (draft), update, delete | SQLite reads <40ms, JXA writes only (#76 FIXED) |
| `messages_chat` | SQLite + JXA | read, create (send) | 13/13 — #75 CLOSED (5.3s, was 60s+) |
| `contacts_people` | JXA | read, search, create, update, delete | 14/14 — #77 CLOSED (570ms, was 30s+) |

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
| #65 | Calendar — CRUD, recurrence, enrichment | 21/21 PASS | Bugs fixed, needs re-verify to close |
| #66 | Notes — CRUD, append, search | 17/17 PASS | Bugs fixed, needs re-verify to close |
| #67 | Mail — read, draft, reply, enrichment | 8/14 PASS | Open (#76 still broken) |
| #68 | Messages — read, search, date filtering | 13/13 PASS | Bug fixed, needs re-verify to close |
| #69 | Contacts — CRUD, search | 14/14 PASS | Bug fixed, needs re-verify to close |
| #70 | Cross-tool intelligence | — | Blocked on #65-69 |
| #71 | Performance benchmarks | — | Blocked on #65-69 |
| #72 | Unit test audit | — | P2, after E2E |

### Bug Fixes from E2E (Priority Order)

| Issue | Problem | Severity | Fix Complexity |
|-------|---------|----------|---------------|
| #73 | Calendar findEventById unbounded range | ~~P1~~ | **CLOSED** `be122e7` — verified 646ms |
| #74 | Notes move-to-folder double-escaping | ~~P1~~ | **CLOSED** `1c61735` — verified 1.9s |
| #76 | Mail JXA read/search timeout 60s | ~~P0~~ | **CLOSED** — SQLite backend, reads <40ms |
| #77 | Contacts search iterates all 30s | ~~P1~~ | **CLOSED** `b5c1430` — verified 570ms |
| #75 | Messages enrichment timeout 60s | ~~P0~~ | **CLOSED** `afe64cf` — verified 5.3s |
| #78 | Notes search scans all 24s | ~~P2~~ | **CLOSED** `c9a9239` — verified 973ms |

## E2E Performance Baselines (2026-02-11)

| Tool | Backend | CRUD | Search | Default Read | Enrichment |
|------|---------|------|--------|-------------|------------|
| Reminders | EventKit/Swift | 42-203ms | 339ms | 981ms (cold), 338ms | N/A |
| Calendar | EventKit/Swift | 34-72ms | 51ms | 646ms (#73 fixed) | 59-67ms |
| Notes | JXA | 146-583ms | 973ms (#78 fixed) | 2.0s | N/A |
| Mail | SQLite + JXA | 563ms-2.5s (writes) | <10ms (#76 fixed) | <40ms (#76 fixed) | N/A (SQLite has sender) |
| Messages | SQLite | N/A (read-only) | 135ms | 5.3s (#75 fixed) | 5.3s (#75 fixed) |
| Contacts | JXA | 161-955ms | 570ms (#77 fixed) | 6.4s (slow) | N/A |

Key finding: **`whose()` JXA predicates are fast (indexed), JS iteration over collections is O(n) and times out.**

### Functional E2E Suite (`pnpm test:e2e`) — 2026-02-11

| Suite | Tests | Total Time | Create | Read | Delete |
|-------|-------|-----------|--------|------|--------|
| Reminders CRUD | 4 | 1.9s | 699ms | 444ms | 141ms |
| Calendar CRUD | 3 | 2.3s | 1399ms | 811ms | 52ms |
| Notes CRUD | 3 | 3.6s | 1283ms | 1894ms | 420ms |
| Messages read | 1 | 0.3s | — | 308ms | — |

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
