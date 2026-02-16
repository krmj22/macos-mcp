# INTENT.md

Reference this document when making any decision — architecture, bug triage, feature scope, testing, documentation. If a choice doesn't serve the intent, it's the wrong choice.

## What This Looks Like

Kyle is grabbing coffee downtown. He pulls out his phone, opens Claude, and types: *"What's my afternoon look like? Anything I should prep for?"*

Claude checks his Calendar and finds a 2pm with Sarah Chen — a product review. It pulls the last few emails between them and sees she sent a deck yesterday with questions about the Q3 roadmap. There's also an overdue reminder: "Review competitive analysis doc." Claude puts it together:

> You have a product review with Sarah Chen at 2pm. She sent you a deck yesterday with three open questions about the Q3 roadmap — looks like she's expecting answers. You also have an overdue reminder to review the competitive analysis doc, which is probably relevant. Want me to pull up her questions?

Kyle replies: *"Yeah, pull those out and make me a prep note. And remind me to review it at 1:30."*

Claude reads the email body, extracts the three questions, creates a note titled "Product Review Prep — Sarah 2pm" with the questions and bullet points for each, and sets a reminder for 1:30pm. Done in seconds, from a phone, while he's in line for coffee.

That's the product. Not a demo, not a toy — a genuine extension of what Claude can do when it has real access to real data on a real Mac. The six tools (Calendar, Mail, Contacts, Notes, Reminders, Messages) aren't interesting individually. They're interesting because they work together, reliably, on actual user data, and they make Claude meaningfully more useful in daily life.

Everything in this document — the architecture, the testing philosophy, the quality bar — exists to make that interaction work every time.

## What We're Building

An MCP server that gives Claude genuine, reliable access to a user's macOS personal data — Reminders, Calendar, Notes, Mail, Messages, and Contacts. Six apps, done well.

The end state: a user on Claude iOS, Claude web, or Claude desktop says "what did Kyle email me about the property?" and Claude can actually answer — by reading real mail, correlating it with real contacts, and pulling context from real calendar events. The AI has intelligence across the user's digital life, not access to a toy demo.

## Who It's For

1. **The user running it.** This is a personal tool first. It must work reliably for the person who installs it on their Mac. If it doesn't work for real Gmail, real Outlook, real iCloud setups with real data volumes, it's broken — regardless of what the tests say.

2. **The open-source community.** This is a reference implementation of what a production MCP server looks like. Other developers will read this code, fork it, and learn from it. The quality of the code, the documentation, and the architectural decisions reflects on the project and its author.

3. **A portfolio piece.** This project demonstrates applied AI engineering — not just "I called an API" but "I solved real integration problems between AI and native OS tooling." The quality bar is: would a senior engineer reviewing this repo come away impressed by the thoughtfulness of the approach?

## Core Principles

### The user's data is the truth

If Mail.app shows 7 messages in the inbox, the MCP server returns 7 messages. If Reminders shows 3 overdue tasks, the MCP server returns 3 overdue tasks. Any discrepancy between what the native app shows and what the MCP server returns is a bug — full stop.

"No data found" is never an acceptable default when the user has data. Verify against the native app.

### Robust means it works for everyone, not just the developer

Gmail, Outlook, iCloud, Exchange, and custom IMAP servers all store data differently. "Works on my machine" is not robust. Every data access path must account for the real diversity of how Apple Mail, Messages, Calendar, etc. actually store and organize data across providers and configurations.

When building or fixing a feature, ask: "How does this work for a Gmail user? An Outlook user? Someone with 50,000 emails? Someone with 3?"

### Reliability over features

Six tools that work flawlessly beat twelve tools that work sometimes. Every tool must:
- Return correct, complete data that matches the native app
- Perform within reasonable time bounds (seconds, not minutes)
- Fail clearly with actionable messages when something goes wrong
- Work across different account types and data volumes

Don't add new capabilities until existing ones are rock-solid.

### Cross-tool intelligence is the destination, not the starting point

The vision is Claude connecting dots across apps — "who emailed me about tomorrow's meeting?" requires Mail + Calendar + Contacts working together. But this emerges naturally from reliable per-tool access and good contact enrichment. Don't over-engineer cross-tool features. Build each tool right, enrich with contacts where it makes sense, and the intelligence follows.

### No shortcuts, no "good enough"

- A test that silently skips on timeout is worse than no test
- An empty result that passes because "no error was thrown" is a false positive
- A fix applied to one query but not the three other queries with the same pattern is incomplete
- A feature that works for one email provider but silently fails for the most popular one is broken

When fixing a bug, fix the pattern — not just the instance. Grep for the same assumption everywhere.

### Intent over implementation

When evaluating any piece of work, ask: **"Does this actually do what the user needs?"** — not "does this pass the tests?" or "does this run without errors?" The difference between these questions is the difference between a working product and a technically-passing-but-broken one.

## Scope

**In scope (these 6, done well):**
- Reminders (EventKit)
- Calendar (EventKit)
- Notes (JXA)
- Mail (SQLite reads, JXA writes)
- Messages (SQLite reads, JXA sends)
- Contacts (JXA)

**Out of scope:**
- Other Apple apps (Finder, Safari, Photos, Shortcuts, etc.)
- Non-macOS platforms
- Features that Apple's APIs don't support (deleting messages, editing sent iMessages, etc.)

## Decision Test

When facing a gray area, run the choice through these questions in order:

1. **Does it match what the native app shows?** If not, it's wrong.
2. **Does it work for Gmail, Outlook, AND iCloud users?** If not, it's incomplete.
3. **Would the user on Claude iOS get the right answer?** If not, it doesn't serve the intent.
4. **Would a senior engineer reviewing this be impressed?** If not, raise the bar.
5. **Are we over-engineering, or is this complexity necessary?** Keep it simple, but not simpler.
