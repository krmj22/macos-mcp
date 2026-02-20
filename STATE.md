# Project State

Last updated: 2026-02-20 (v2.1.0, HN hardening pass)

## Overview

macOS MCP server providing native integration with Reminders, Calendar, Notes, Mail, Messages, and Contacts. Three backends: EventKit (Swift binary) for Reminders/Calendar, JXA (AppleScript) for Notes/Mail writes/Contacts, SQLite for Messages and Mail reads. See ADR-001 in DECISION.md.

## Codebase

- **Source**: ~10k LOC TypeScript across `src/`
- **Tests**: 895 unit tests, 35 test files, all passing
- **E2E**: 149 tests across 8 suites — serial runner (#81 fixed), 2 send skipped
  - 124 stdio transport tests (7 suites)
  - 25 HTTP transport tests (1 suite) — validates full Claude iOS/web path
- **Build**: TypeScript + Swift binary via `pnpm build`
- **Transport**: stdio (default) or HTTP (Cloudflare Tunnel to `mcp.kyleos.ai`)

## Tools

| Tool | Backend | Actions | E2E Status |
|------|---------|---------|------------|
| `reminders_tasks` | EventKit/Swift | read, create, update, delete | ALL PASS (<1s) |
| `reminders_lists` | EventKit/Swift | read, create, update, delete | ALL PASS (<400ms) |
| `calendar_events` | EventKit/Swift | read, create, update, delete | 21/21 — #73 CLOSED, verified 646ms. Attendee emails extracted from EKParticipant (`7ca8c5d`). |
| `calendar_calendars` | EventKit/Swift | read | PASS (461ms) |
| `notes_items` | JXA | read, create, update, delete, append | 40/40 — list uses folder iteration (was O(n) timeout), Recently Deleted filtered, title preserved after append |
| `notes_folders` | JXA | read, create | ALL PASS (<500ms, no delete via API) |
| `mail_messages` | SQLite + JXA | read, create (draft), update, delete | SQLite reads <40ms, Gmail labels supported (all mailboxes), JXA writes only (#76 FIXED) |
| `messages_chat` | SQLite + JXA | read, create (send) | 13/13 — #75 CLOSED (5.3s, was 60s+) |
| `contacts_people` | JXA | read, search, create, update, delete | 14/14 — #77 CLOSED (570ms, was 30s+) |

## Contact Enrichment

Cross-tool intelligence layer resolves raw phone numbers and emails to contact names:
- **Messages**: phone numbers enriched to "Name (+1234567890)" format
- **Mail**: sender emails enriched to contact names
- **Calendar**: attendee emails enriched to contact names
- Toggle: `enrichContacts` param (default: true)
- Engine: `contactResolver.ts` — targeted JXA search for name-to-handles, **SQLite bulk read** for handle-to-name enrichment cache
- **Bulk cache**: SQLite reads from `~/Library/Application Support/AddressBook/Sources/*/AddressBook-v22.abcddb` (<50ms, was 15s JXA timeout). See ADR-002 in DECISION.md.
- **Cache warming**: `warmCache()` called at startup, fire-and-forget. Now succeeds in <50ms (was always timing out with JXA).
- **All enrichment paths** protected by `withTimeout(5000ms)` — Messages, Mail, Calendar

## Phone Test Results (2026-02-12)

Real-world testing from Claude iOS via Cloudflare Tunnel (`mcp.kyleos.ai`). 26 test cases, 23 pass, 3 warnings, 0 failures.

| Finding | Verdict | Action |
|---------|---------|--------|
| Notes body/title merging | Apple re-derives n.name() from body on n.body assignment | Fixed: save and re-set name after body update (`45f8eb4`) |
| Messages enrichment returns raw phone numbers | **Bug #90** — cold contact cache timeout | Fixed: cache warming + negative cache + withTimeout |
| Mail enrichment shows mixed names/emails | Expected — three-layer fallback (Contact name → Mail DB comment → email) | No code change |

## Recent Work (2026-02-09 to 2026-02-17)

| Commit | Description |
|--------|-------------|
| `45f8eb4` | **fix(notes)**: preserve title after body update/append — Apple re-derives n.name() from body |
| `9795e76` | **fix(notes)**: folder-based list (was O(n) timeout) + filter Recently Deleted from list/search |
| `ff2dd8c` | **fix(calendar)**: default findEvents to ±2yr date bounds (same class as #73) |
| `900fd6d` | **fix(calendar)**: filter non-mailto attendee URLs (CalDAV principals) |
| `7ca8c5d` | **feat(calendar)**: extract attendee emails from EKEvent in Swift binary |
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
| `c0231bb` | **fix(mail)**: fall back to sender display name when contact has no email |
| `0f7b57a` | **chore**: GitHub Actions CI and deploy script (#86) |
| `530a975` | **feat**: npm release infrastructure (mcp-macos) |
| `a32b54b` | **fix**: use package root for Swift build paths (not cwd) |
| `8438cbe` | **fix(config)**: update stale package name in project root detection |
| `bd51a79` | **chore(release)**: 2.0.2 |
| `12d5f33` | **fix(config)**: force stdio transport in .mcp.json to avoid port conflict |
| `dd3b74f` | **chore**: remove project-level .mcp.json to avoid tool duplication |
| `68bebef` | **chore(release)**: 2.0.3 |
| `804a190` | **docs(readme)**: demo video — trimmed GIF, centered, auto-playing |

## Unit Test Assessment

895 tests across 35 files. Coverage thresholds: 95/80/95/95 (stmts/branches/functions/lines). All above thresholds. `pnpm test --coverage` exits 0.

| Layer | Confidence | Why |
|-------|-----------|-----|
| Validation (Zod), date filtering, phone normalization | **High** | Pure logic, no mocks |
| Handler formatting, Markdown output | **High** | All handlers tested with mocked backends |
| JXA executor, SQLite readers | **High** | All public functions tested, OS calls mocked |
| Tool routing dispatch | **High** | Every tool + action tested, plus alias routing |
| Error handling (JxaError hints, permission hints) | **High** | All hint branches tested including permission/FDA |
| Preflight checks | **High** | All 6 sync checks + formatter tested with mocked OS |

Branches stays at 80%: many uncovered branches are defensive paths (empty catch, null coalesce, permission retry) that would require synthetic tests to cover. See #87.

## Open Issues

### E2E Test Results

| Issue | Scope | Result | Status |
|-------|-------|--------|--------|
| #64 | Reminders — tasks + lists CRUD | 24/24 PASS | CLOSED |
| #65 | Calendar — CRUD, recurrence, enrichment | 20/20 PASS | **CLOSED** `dcb2e31` |
| #66 | Notes — CRUD, append, search | 21/21 PASS | **CLOSED** `5116908` |
| #67 | Mail — read, draft, reply, enrichment | 18/18 PASS | **CLOSED** `dd13835` |
| #68 | Messages — read, search, date filtering | 17/17 PASS (+2 send skipped) | **CLOSED** `3b95672` |
| #69 | Contacts — CRUD, search | 15/15 PASS | **CLOSED** `cf978b0` |
| #70 | Cross-tool intelligence | 13/13 PASS | **CLOSED** `3904a87` |
| #71 | Performance benchmarks | — | Baselines captured in E2E suite |
| #79 | Unit test coverage gaps | 671 tests, all targets met | **CLOSED** `1817718`, `36cb043` |
| #72 | Unit test audit | 765 tests, thresholds resolved | **CLOSED** — 95.96/80.97/93.63/96.35 vs 95/80/93/95 thresholds |

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
| Notes | JXA | 146-583ms | 973ms (#78 fixed) | 4.7s (folder iteration, was timeout) | N/A |
| Mail | SQLite + JXA | 563ms-2.5s (writes) | <10ms (#76 fixed) | <40ms (#76 fixed) | N/A (SQLite has sender) |
| Messages | SQLite | N/A (read-only) | 135ms | 5.3s (#75 fixed) | 5.3s (#75 fixed) |
| Contacts | JXA | 161-955ms | 570ms (#77 fixed) | 6.4s (slow) | N/A |

Key finding: **`whose()` JXA predicates are fast (indexed), JS iteration over collections is O(n) and times out.**

### Per-Tool E2E Suites (2026-02-11)

| Suite | File | Tests | Status |
|-------|------|-------|--------|
| Functional (golden path) | `functional.test.mts` | 19/19 | PASS |
| Calendar | `calendar.test.mts` | 20/20 | PASS |
| Notes | `notes.test.mts` | 40/40 | PASS (folder list + Recently Deleted filter + title preservation) |
| Mail | `mail.test.mts` | 18/18 | PASS |
| Messages | `messages.test.mts` | 17/19 | PASS (2 send skipped) |
| Contacts | `contacts.test.mts` | 14/14 | PASS |
| Cross-tool | `cross-tool.test.mts` | 13/13 | PASS |
| HTTP transport | `http-transport.test.mts` | 25/25 | PASS |

Run with `pnpm test:e2e:all` (uses `--test-concurrency=1` to prevent JXA contention, fixes #81).
HTTP tests run separately: `pnpm test:e2e:http` (spawns HTTP server on port 48470).

### Functional E2E Baselines (`pnpm test:e2e`) — 2026-02-11 (pre-release)

19/19 pass, ~22s total. Golden path coverage across all 6 tools.

| Suite | Tests | Create | Read | Search | Delete |
|-------|-------|--------|------|--------|--------|
| Reminders CRUD | 5 | 1632ms | 487ms | 404ms | 74ms |
| Calendar CRUD | 4 | 1047ms | 698ms | 94ms | 62ms |
| Notes CRUD + Search | 4 | 1307ms | 1270ms | 4475ms | 407ms |
| Mail read + search | 2 | — | 37ms | 11ms | — |
| Messages read | 2 | — | 372ms | — | — |
| Messages enriched | — | — | 5141ms | — | — |
| Contacts read + search | 2 | — | 1156ms | 1116ms | — |

## Resolved Issues (2026-02-11)

### Production Readiness

| Issue | Priority | Resolution |
|-------|----------|------------|
| #80 | P1 | **CLOSED** — Bulk cache timeout 60s→15s, retries 2→1. Worst case 182s→31s. |
| #81 | P2 | **CLOSED** — `--test-concurrency=1` for all E2E scripts, `test:e2e:all` added |
| #82 | docs | **CLOSED** — STATE.md updated with final audit results |
| #83 | P0 | **CLOSED** — README troubleshooting: permissions, FDA, shims, Gmail labels |
| #84 | P0 | **CLOSED** — Actionable error messages with System Settings deep-link URLs |
| #85 | P0 | **CLOSED** — `prepublishOnly: "pnpm build && pnpm test"` |
| #87 | P2 | **CLOSED** — Functions 93→95% (actual 98.73%), branches 80% rationale documented |
| #88 | P3 | **CLOSED** — README HTTP transport / remote access section |
| #89 | P3 | **CLOSED** — `node dist/index.js --check` preflight validation |
| #90 | P1 | **CLOSED** — Contact cache warming + negative cache + withTimeout on all enrichment paths |

### Previously Deferred (Now Resolved)

| Issue | Priority | Description |
|-------|----------|-------------|
| #86 | ~~Deferred~~ | **CLOSED** `0f7b57a` — GitHub Actions CI pipeline (test + lint + release) |

## Known Limitations

- **Messages**: No delete/edit (Apple API limitation)
- **Notes folders**: No rename/delete via JXA (Apple API limitation)
- **Calendar recurring delete**: Only removes single occurrence
- **Mail create**: Creates draft only (user must click Send)
- **Contacts update**: Basic fields only (name, org, jobTitle, note)
- **Notes title**: Apple re-derives `n.name()` from body content on every `n.body =` — update/append scripts re-set name after body assignment to preserve it
- **JXA `collection.method()` is O(n)**: Always use `whose()` predicates for search/filter, never JS iteration. Notes list uses folder iteration instead of `Notes.notes()`
- **EventKit date range limit**: `predicateForEvents` cannot span >4 years. Both `findEventById` and `findEvents` default to ±2 years.
- **Contact enrichment at scale**: Per-handle JXA lookups don't scale beyond ~10 participants

## Infrastructure

- **Production**: LaunchAgent `com.macos-mcp.server` on Mac Mini (migrated from MacBook 2026-02-13)
- **Tunnel**: Cloudflare Tunnel `mac-mini-winston` → `mcp.kyleos.ai` → `localhost:3847`
- **npm**: Published as `mcp-macos` (v2.1.0), install via `npm install -g mcp-macos`
- **CI**: GitHub Actions — test + lint + release (#86 CLOSED)
- **After restart**: Always restart both server AND tunnel LaunchAgents
