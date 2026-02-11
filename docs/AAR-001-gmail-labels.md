# AAR-001: Gmail Labels — Empty Inbox Treated as Passing

**Date**: 2026-02-11
**Severity**: Process failure — shipped broken functionality, marked it SAT
**Root cause**: Tested for technical correctness (no errors) instead of verifying user intent (can the user read their mail?)

## Timeline

1. **E2E test written**: Mail inbox read test passes with `assert.ok(text.length > 0)`. Returns "No messages in inbox." — which is technically `text.length > 0`, so it passes.

2. **Mail search test times out (60s)**: Instead of investigating *why*, the fix was to catch the timeout and skip. A test that silently skips is worse than no test — it creates false confidence.

3. **User points out their inbox has 7 messages**: Screenshot shows All Inboxes with real emails. The "passing" test was returning 0 results for a mailbox with 7 messages.

4. **Inbox fix applied**: Gmail `labels` table discovered. Inbox now returns the correct 7 messages.

5. **But only inbox was fixed**: The same Gmail labels pattern affects *every* custom folder — Business, Real Estate, Finance, Work, code. User had to explicitly ask "what about those other folders?" before the fix was extended.

## What Went Wrong

### 1. "No messages" was accepted as valid

The test asserted `text.length > 0` — meaning "No messages in inbox." counted as a pass. The test should have asked: **does this match what the user would see in Mail.app?** An empty inbox on a machine with 7 visible inbox messages is a bug, not a valid state.

**The deeper problem**: There was no mental model of what "correct" looks like. The test verified the code ran without errors, not that it produced the right output. This is the difference between testing the *letter* and testing the *intent*.

### 2. Timeout was treated as environmental, not as a signal

When mail search timed out at 60s, the response was to catch and skip. But a 60s timeout on a 5,000-row SQLite database is a screaming signal that something is wrong. The correct response was to investigate the full call chain — which would have revealed that `enrichMailSenders()` calls `resolveBatch()` which does a bulk JXA contact fetch, which is the known-slow O(n) pattern.

**The deeper problem**: Timeouts were categorized as "transient environment issues" rather than reproducible bugs. The evidence was right there — inbox read (0 results, no enrichment needed) was 48ms, search (3 results, enrichment triggered) was 60s. That 1000x difference should have triggered investigation, not a try/catch.

### 3. Fix was scoped too narrowly

After discovering the Gmail `labels` table for inbox, the fix was applied *only* to `listInboxMessages()`. But the same pattern applies to every Gmail folder. The user had to ask "what about Business and Real Estate?" before `listMailboxMessages()` was also fixed.

**The deeper problem**: The fix addressed the symptom (inbox returns 0) without asking "where else does this assumption exist?" A 30-second grep for `mb.url` or `messages.mailbox` in the SQLite reader would have revealed every query that makes the same broken assumption.

### 4. No user-perspective validation

At no point was the question asked: "If I were a user on Claude iOS asking to read my Business emails, would this work?" The testing was entirely from the developer perspective — does the function return without error? The user perspective — does the AI have access to my actual mail? — was never checked.

## Lessons Learned

### L1: "No data" is a bug until proven otherwise

When a read operation returns empty results, the default assumption should be **something is wrong**, not "the mailbox is empty." Verify against the actual application state. For mail: open Mail.app and check. For calendar: open Calendar.app and check. An E2E test that returns "no items found" for a tool that the user demonstrably has items in is **UNSAT**, not SAT.

**Concrete rule**: When an E2E test returns 0 results for a default read, manually verify against the native app before accepting.

### L2: Timeouts are bugs, not environment noise

A 60-second timeout in a tool that should complete in <1s is always a bug. Never catch-and-skip. Always investigate the full call chain. The fix for a timeout is understanding *why* it's slow, not hiding it.

**Concrete rule**: Never write `catch timeout → skip` in a test. If a timeout is expected and documented (e.g., known-broken path with an open issue), mark the test as `todo` with the issue number, not silently passing.

### L3: Fix the pattern, not the instance

When a bug is found in one query, grep for the same pattern in all queries. The Gmail labels issue affected every function that joins `messages.mailbox` → `mailboxes.ROWID`. Fixing only `listInboxMessages()` and not `listMailboxMessages()` left the same bug in place for every custom folder.

**Concrete rule**: After fixing a bug, search for the same pattern elsewhere. Ask: "What other code makes this same assumption?"

### L4: Test from the user's perspective

The project's purpose is to give Claude (on iOS/web) intelligence across the user's macOS apps. Every test should be framed as: **"Can the AI answer questions about the user's actual data?"** Not "does the function return without error?"

Good test question: "Show me my Business emails" → should return real Business emails
Bad test question: "Does `mail_messages(read)` return a non-empty string?" → accepts "No messages" as valid

**Concrete rule**: Frame E2E assertions around user scenarios, not technical success. Include at least one assertion that verifies *content correctness*, not just *no errors*.

### L5: Consider the full user base, not just the happy path

This MCP server is open source. Users have Gmail, Outlook, iCloud, Exchange, and custom IMAP servers. Gmail is the most popular email provider in the world. A mail read function that silently returns 0 results for all Gmail users is a critical bug, not an edge case.

**Concrete rule**: When building data access paths, ask: "How does Gmail store this? How does Outlook store this? How does iCloud store this?" Test with at least two providers if available.

## Changes Made

| Commit | Fix |
|--------|-----|
| `8b7019b` | `listInboxMessages()` — check `labels` table for Gmail inbox membership |
| `1ebccaa` | `listMailboxMessages()` — check `labels` table for all Gmail folder membership |

## Process Changes

1. **E2E tests must verify content, not just non-error**: At minimum, default reads for mail/messages/contacts should assert result count > 0 when the machine has data.
2. **No catch-and-skip for timeouts**: Timeouts get investigated or marked `todo` with an issue number.
3. **Pattern-level fixes**: After any SQLite query fix, grep for the same join pattern in all queries.
4. **User-perspective smoke test**: After any mail/messages change, manually verify against Mail.app/Messages.app that the output matches.
