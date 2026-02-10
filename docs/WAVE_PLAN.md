# Execution Plan: Issues #65-79 (Waves 2-6 Remaining)

## Status: Wave 1 COMPLETE, Wave 2 Ready

**Wave 1 completed 2026-02-10** — 4 bug fixes merged to main, 552/552 tests passing.

| Issue | Fix | Commit | Branch |
|-------|-----|--------|--------|
| #73 | Calendar findEventById: ±2yr bounded date range | `be122e7` | merged |
| #74 | Notes move-to-folder: %%placeholder%% pattern | `1c61735` | merged |
| #76 | Mail timeout: SOM-level access + whose() | `df8bf7a` | merged |
| #77 | Contacts search: whose() predicate | `b5c1430` | merged |

**Main branch is 7 commits ahead of origin/main** (not pushed yet).

---

## Wave 2 — Remaining Bug Fixes (2 tasks, different files)

### 2A: #78 Notes search timeout
**File**: `src/tools/handlers/notesHandlers.ts` lines 59-88 (`SEARCH_NOTES_SCRIPT`)
**Fix**: Two-pass approach:
1. `Notes.notes.whose({name: {_contains: term}})()` for title matches (indexed, fast)
2. Call `plaintext()` only on matched notes (not all notes)
3. Remove JS iteration over entire `Notes.notes()` collection

**Current code** (the slow part):
```javascript
const notes = Notes.notes();  // materializes ALL notes
const term = "{{search}}".toLowerCase();
for (let i = 0; i < notes.length && result.length < limit; i++) {
    const n = notes[i];
    const name = n.name();
    const body = n.plaintext();  // called for EVERY note
    if (name.toLowerCase().includes(term) || body.toLowerCase().includes(term)) { ... }
}
```

**New script** (replace lines 59-88):
```javascript
const SEARCH_NOTES_SCRIPT = `
(() => {
  const Notes = Application("Notes");
  const term = "{{search}}";
  const titleMatches = Notes.notes.whose({name: {_contains: term}})();
  const result = [];
  const offset = {{offset}};
  const limit = {{limit}};
  const end = Math.min(titleMatches.length, offset + limit);
  for (let i = offset; i < end; i++) {
    const n = titleMatches[i];
    result.push({
      id: n.id(),
      name: n.name(),
      body: n.plaintext().substring(0, 500),
      folder: n.container().name(),
      creationDate: n.creationDate().toISOString(),
      modificationDate: n.modificationDate().toISOString()
    });
  }
  return JSON.stringify(result);
})()
`;
```

**Trade-off**: This only searches titles, not body content. Body-content search via `whose()` is not supported by Apple Notes. Title search covers the primary use case and drops from 24s to <1s.

### 2B: #75 Messages enrichment timeout
**Files**: `src/tools/handlers/messagesHandlers.ts` lines 165-249, possibly `src/utils/contactResolver.ts`
**Problem**: `enrichChatParticipants()` and `enrichMessagesWithContacts()` call `contactResolver.resolveBatch()` which does a bulk JXA fetch of ALL contacts with phones/emails. For 600+ contacts, this times out at 60s.

**Fix approach**:
1. Add a max handles cap (~20) to enrichment functions — only enrich first 20 unique handles, return raw handles for the rest
2. Add a 5s timeout wrapper around the `resolveBatch()` call in enrichment — if it takes >5s, return unenriched data
3. In `enrichChatParticipants()`, cap handles before calling `resolveBatch()`

**Key pattern** — wrap enrichment with timeout:
```typescript
async function enrichWithTimeout<T>(
  enrichFn: () => Promise<T[]>,
  fallback: T[],
  timeoutMs = 5000,
): Promise<T[]> {
  try {
    return await Promise.race([
      enrichFn(),
      new Promise<T[]>((_, reject) =>
        setTimeout(() => reject(new Error('enrichment timeout')), timeoutMs),
      ),
    ]);
  } catch {
    return fallback;
  }
}
```

**QA gate**: `pnpm test` + `pnpm build` + restart server & tunnel LaunchAgents

---

## Wave 3 — E2E Re-verification (5 parallel tasks)

Re-run E2E test suites to verify Wave 1+2 bug fixes. Each uses the E2E infrastructure from `/tmp/e2e-batch-*.mjs` scripts.

| Issue | Verifies | Key assertions |
|-------|----------|---------------|
| #65 | Calendar (#73) | `findEventById` returns event, not 0 results |
| #66 | Notes (#74, #78) | move-to-folder works, search completes <5s |
| #67 | Mail (#76) | inbox read completes, search returns results |
| #68 | Messages (#75) | default chat list completes, enrichment finishes |
| #69 | Contacts (#77) | search completes <5s |

**E2E infrastructure**: MCP SDK client via stdio (`new StdioClientTransport({ command: "node", args: ["dist/index.js"] })`). Requires `pnpm build` first.

---

## Wave 4 — Cross-Tool & Performance E2E

| Issue | Scope |
|-------|-------|
| #70 | Cross-tool intelligence: enrichment pipelines, multi-tool workflows |
| #71 | Performance benchmarks: updated baselines after all bug fixes |

Update STATE.md with new baselines.

---

## Wave 5 — Unit Test Coverage (#79, 4 sub-tasks)

| Slot | Scope | File | ~Tests |
|------|-------|------|--------|
| 5A | Contacts handlers (5 handlers) | NEW `contactsHandlers.test.ts` | ~20 |
| 5B | JXA executor (pure functions) | NEW `jxaExecutor.test.ts` | ~15 |
| 5C | SQLite reader (utilities) | ADD TO `sqliteMessageReader.test.ts` | ~10 |
| 5D | Messages branches (error paths) | ADD TO `jxaHandlers.test.ts` | ~10 |

---

## Wave 6 — Unit Test Audit (#72)

Solo P2 task. Audit for redundancy, remove padding tests, optimize suite.

---

## Critical Files Reference

```
src/utils/calendarRepository.ts        — #73 DONE
src/tools/handlers/notesHandlers.ts    — #74 DONE, #78 Wave 2
src/tools/handlers/contactsHandlers.ts — #77 DONE
src/tools/handlers/mailHandlers.ts     — #76 DONE
src/tools/handlers/messagesHandlers.ts — #75 Wave 2
src/utils/contactResolver.ts           — #75 may need timeout wrapper
```

## Reusable Patterns

- `whose()` predicate: `contactResolver.ts:106` (`buildTargetedSearchScript()`)
- `%%placeholder%%` for pre-sanitized code blocks: `contactsHandlers.ts:217`, `notesHandlers.ts:126`
- JXA mock pattern: `jxaHandlers.test.ts:6-14`
- SOM-level access (no parens): `mailHandlers.ts:75` (`inbox.messages` not `inbox.messages()`)

## Post-Completion Checklist

After all waves:
- [ ] Push to origin: `git push`
- [ ] Restart both LaunchAgents:
  ```bash
  launchctl kickstart -k gui/$(id -u)/com.macos-mcp.server
  launchctl kickstart -k gui/$(id -u)/com.cloudflare.macos-mcp-tunnel
  ```
- [ ] Update STATE.md with final tool matrix and baselines
- [ ] Close GitHub issues #65-79
- [ ] Update ledger via `/update-ledger`
