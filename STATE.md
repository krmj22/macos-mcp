# Project State

Last updated: 2026-02-10

## Overview

macOS MCP server providing native integration with Reminders, Calendar, Notes, Mail, Messages, and Contacts. Two backends: EventKit (Swift binary) for Reminders/Calendar, JXA (AppleScript) for Notes/Mail/Messages/Contacts. Messages reads use SQLite directly (JXA broken on Sonoma+).

## Codebase

- **Source**: ~10k LOC TypeScript across `src/`
- **Tests**: 552 unit tests, 28 test files, 96% statement coverage, all passing in 1.5s
- **Build**: TypeScript + Swift binary via `pnpm build`
- **Transport**: stdio (default) or HTTP (Cloudflare Tunnel to `mcp.kyleos.ai`)

## Tools

| Tool | Backend | Actions | Status |
|------|---------|---------|--------|
| `reminders_tasks` | EventKit/Swift | read, create, update, delete | Working |
| `reminders_lists` | EventKit/Swift | read, create, update, delete | Working |
| `calendar_events` | EventKit/Swift | read, create, update, delete | Working |
| `calendar_calendars` | EventKit/Swift | read | Working |
| `notes_items` | JXA | read, create, update, delete, append | Working |
| `notes_folders` | JXA | read, create | Working (no delete via API) |
| `mail_messages` | JXA | read, create (draft), update, delete | Working |
| `messages_chat` | SQLite + JXA | read, create (send) | Working |
| `contacts_people` | JXA | read, search, create, update, delete | Working |

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

### E2E Test Suite (P0 to P2)

Execution order: #64-69 parallel, then #70-71 sequential, then #72 informed by results.

| Issue | Scope | Test Cases | Priority |
|-------|-------|-----------|----------|
| #64 | Reminders — tasks + lists CRUD | 22 | P0 |
| #65 | Calendar — CRUD, recurrence, attendee enrichment | 20 | P0 |
| #66 | Notes — CRUD, append, search | 21 | P0 |
| #67 | Mail — read, draft, reply, contact enrichment | 18 | P0 |
| #68 | Messages — read, search, send, date filtering | 19 | P0 |
| #69 | Contacts — CRUD, search, cross-tool resolution | 15 | P0 |
| #70 | Cross-tool intelligence — enrichment pipelines | 13 | P1 |
| #71 | Performance benchmarks and reliability | 14 | P1 |
| #72 | Unit test audit — redundancy, gaps, optimization | — | P2 |

**Total: ~142 E2E test cases** covering every tool action, edge case, and cross-tool workflow.

## Performance Baselines (from previous smoke tests)

| Tool | Backend | Approx Latency | Notes |
|------|---------|---------------|-------|
| Messages | SQLite | ~50-150ms | Fastest — recently refactored |
| Calendar | EventKit/Swift | ~100ms | Fast |
| Mail | JXA | ~1.5s | JXA overhead |
| Reminders | EventKit/Swift | ~1.7s | Includes Swift binary spawn |
| Notes | JXA | ~2.2s | Slowest — AppleScript overhead |

Formal benchmarks pending (#71).

## Known Limitations

- **Messages**: No delete/edit (Apple API limitation)
- **Notes folders**: No rename/delete via JXA (Apple API limitation)
- **Calendar recurring delete**: Only removes single occurrence
- **Mail create**: Creates draft only (user must click Send)
- **Contacts update**: Basic fields only (name, org, jobTitle, note)
- **JXA tools**: Slower than EventKit/SQLite due to AppleScript overhead

## Infrastructure

- **Production**: LaunchAgent `com.macos-mcp.server` on Mac Mini
- **Tunnel**: Cloudflare Tunnel `com.cloudflare.macos-mcp-tunnel` at `mcp.kyleos.ai:3847`
- **After restart**: Always restart both server AND tunnel LaunchAgents
