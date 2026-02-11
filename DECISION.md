# Architecture Decision Records

## ADR-001: SQLite for Reads, JXA for Writes

**Date**: 2026-02-11
**Status**: Accepted
**Issues**: #75 (Messages), #76 (Mail)

### Context

JXA (JavaScript for Automation) accesses macOS apps via Apple Events. Read operations that touch large collections (`messages()`, `mailboxes()`) are O(n) — every call materializes the entire collection. `whose()` predicates help for filtered searches but don't solve bulk reads (inbox listing, default views).

Performance evidence:
- **Messages**: JXA `c.messages()` broken on Sonoma+ entirely. SQLite reads: 135ms vs 60s+ timeout.
- **Mail**: JXA inbox read: 60s timeout (4,446 messages in All Mail). `whose()` fix (`df8bf7a`) insufficient — `accounts()` and `mailboxes()` materialization still O(n).
- **Contacts**: `whose()` fix worked (#77) — smaller collections (~1k contacts).
- **Notes**: `whose()` fix worked (#78) — smaller collections.

### Decision

Use SQLite for all read operations where Apple stores data in an accessible SQLite database. Keep JXA exclusively for write operations (create, update, delete) which require Apple Events.

| App | Read Backend | Write Backend | Database Path |
|-----|-------------|---------------|---------------|
| Messages | SQLite | JXA | `~/Library/Messages/chat.db` |
| Mail | SQLite | JXA | `~/Library/Mail/V10/MailData/Envelope Index` |
| Notes | JXA (whose()) | JXA | N/A — no accessible SQLite |
| Contacts | JXA (whose()) | JXA | N/A — no accessible SQLite |

### Trade-offs

**Gains:**
- 100-1000x faster reads (indexed SQLite vs O(n) Apple Events)
- Predictable performance regardless of collection size
- No app launch required for reads

**Costs:**
- Full Disk Access required (already needed for Messages)
- No full message body in Mail SQLite — `summaries` table has previews only (current JXA truncates to 200 chars anyway)
- Message ROWID in SQLite = `m.id()` in JXA — IDs are compatible across backends
- Hybrid complexity: two code paths per tool (SQLite read + JXA write)

### References

- `src/utils/sqliteMessageReader.ts` — Messages SQLite reader (established pattern)
- `src/utils/sqliteMailReader.ts` — Mail SQLite reader (this ADR)
- `df8bf7a` — Mail SOM-level JXA fix (necessary but insufficient)
- `cee2366` — Messages JXA read paths removed
