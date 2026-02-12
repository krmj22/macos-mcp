/**
 * Functional E2E tests for macos-mcp tools.
 *
 * Connects to the MCP server via stdio (dist/index.js) and exercises
 * create → read → search → delete flows for Reminders, Calendar, Notes,
 * plus read/search for Mail, Messages, and Contacts.
 *
 * Run: pnpm test:e2e:functional   (or pnpm test:e2e which also runs this)
 * Requires: pnpm build first (the npm script handles this).
 */

import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import {
  callTool,
  extractId,
  fmt,
  type PerfEntry,
  PREFIX,
  printPerfSummary,
} from './helpers/shared.mts';

let client: Client;
let transport: StdioClientTransport;

/** Performance ledger — collected and printed at the end. */
const perfLog: PerfEntry[] = [];

/** Convenience wrapper: calls callTool with the module-level client and perfLog. */
async function call(name: string, args: Record<string, unknown>, suite = '') {
  return callTool(client, name, args, suite, perfLog);
}

before(async () => {
  transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    cwd: process.cwd(),
  });
  client = new Client({ name: 'e2e-test', version: '1.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client.close();
  printPerfSummary(perfLog);
});

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------
describe('Reminders CRUD', () => {
  let reminderId: string;
  const title = `${PREFIX} Buy milk ${Date.now()}`;

  it('create', async () => {
    const { text, elapsed } = await call(
      'reminders_tasks',
      { action: 'create', title },
      'Reminders',
    );
    assert.ok(
      text.includes('Successfully created'),
      `unexpected response: ${text.slice(0, 200)}`,
    );
    reminderId = extractId(text)!;
    assert.ok(reminderId, 'should extract an id from response');
    assert.ok(elapsed < 5000, `create took ${elapsed}ms (>5s)`);
  });

  it('read by id', async () => {
    const { text, elapsed } = await call(
      'reminders_tasks',
      { action: 'read', id: reminderId },
      'Reminders',
    );
    assert.ok(text.includes(PREFIX), 'should find the created reminder');
    assert.ok(elapsed < 3000, `read took ${elapsed}ms (>3s)`);
  });

  it('search', async () => {
    const { text, elapsed } = await call(
      'reminders_tasks',
      { action: 'read', search: 'Buy milk' },
      'Reminders',
    );
    assert.ok(text.includes(PREFIX), 'search should find the created reminder');
    assert.ok(elapsed < 5000, `search took ${elapsed}ms (>5s)`);
  });

  it('delete', async () => {
    const { text, elapsed } = await call(
      'reminders_tasks',
      { action: 'delete', id: reminderId },
      'Reminders',
    );
    assert.ok(
      text.includes('Successfully deleted'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 5000, `delete took ${elapsed}ms (>5s)`);
  });

  it('verify deleted', async () => {
    const { text } = await call('reminders_tasks', {
      action: 'read',
      id: reminderId,
    });
    assert.ok(
      !text.includes(title),
      'reminder should not exist after deletion',
    );
  });
});

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------
describe('Calendar CRUD', () => {
  let eventId: string;
  const title = `${PREFIX} Test Meeting ${Date.now()}`;
  const now = new Date();
  const start = new Date(now.getTime() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  it('create', async () => {
    const { text, elapsed } = await call(
      'calendar_events',
      { action: 'create', title, startDate: fmt(start), endDate: fmt(end) },
      'Calendar',
    );
    assert.ok(
      text.includes('Successfully created'),
      `unexpected response: ${text.slice(0, 200)}`,
    );
    eventId = extractId(text)!;
    assert.ok(eventId, 'should extract an id from response');
    assert.ok(elapsed < 5000, `create took ${elapsed}ms (>5s)`);
  });

  it('read by id (bounded range — #73 fix)', async () => {
    const { text, elapsed } = await call(
      'calendar_events',
      { action: 'read', id: eventId, enrichContacts: false },
      'Calendar',
    );
    assert.ok(text.includes(PREFIX), 'should find the created event');
    // #73 fix: read-by-id uses ±2yr bounded range, must be fast
    assert.ok(elapsed < 3000, `read took ${elapsed}ms (>3s) — #73 regression?`);
  });

  it('search by date range', async () => {
    // Search within the window that contains our event
    const { text, elapsed } = await call(
      'calendar_events',
      {
        action: 'read',
        startDate: fmt(start),
        endDate: fmt(end),
        enrichContacts: false,
      },
      'Calendar',
    );
    assert.ok(text.includes(PREFIX), 'date-range search should find the event');
    assert.ok(elapsed < 5000, `search took ${elapsed}ms (>5s)`);
  });

  it('delete', async () => {
    const { text, elapsed } = await call(
      'calendar_events',
      { action: 'delete', id: eventId },
      'Calendar',
    );
    assert.ok(
      text.includes('Successfully deleted'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 5000, `delete took ${elapsed}ms (>5s)`);
  });
});

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------
describe('Notes CRUD + Search', () => {
  let noteId: string;
  const title = `${PREFIX} Test Note ${Date.now()}`;
  const body = 'E2E test body — golden path verification';

  it('create', async () => {
    const { text, elapsed } = await call(
      'notes_items',
      { action: 'create', title, body },
      'Notes',
    );
    assert.ok(
      text.includes('Successfully created'),
      `unexpected response: ${text.slice(0, 200)}`,
    );
    noteId = extractId(text)!;
    assert.ok(noteId, 'should extract an id from response');
    assert.ok(elapsed < 10000, `create took ${elapsed}ms (>10s)`);
  });

  it('read by id', async () => {
    const { text, elapsed } = await call(
      'notes_items',
      { action: 'read', id: noteId },
      'Notes',
    );
    assert.ok(text.includes(PREFIX), 'should find the created note');
    assert.ok(elapsed < 10000, `read took ${elapsed}ms (>10s)`);
  });

  it('search (whose predicate — #78)', async () => {
    const { text, elapsed } = await call(
      'notes_items',
      { action: 'read', search: 'Test Note' },
      'Notes',
    );
    assert.ok(text.includes(PREFIX), 'search should find the created note');
    // #78 fix target: search should use whose() and be <5s
    assert.ok(
      elapsed < 30000,
      `search took ${elapsed}ms (>30s) — #78 regression?`,
    );
  });

  it('delete', async () => {
    const { text, elapsed } = await call(
      'notes_items',
      { action: 'delete', id: noteId },
      'Notes',
    );
    assert.ok(
      text.includes('Successfully deleted'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 10000, `delete took ${elapsed}ms (>10s)`);
  });
});

// ---------------------------------------------------------------------------
// Mail (SQLite backend — read-only E2E)
// ---------------------------------------------------------------------------
describe('Mail read + search', () => {
  it('read inbox (SQLite — #76 fix)', async () => {
    const { text, elapsed } = await call(
      'mail_messages',
      { action: 'read', limit: 5, enrichContacts: false },
      'Mail',
    );
    // May return messages or "no messages" — both are valid
    assert.ok(text.length > 0, 'should return data');
    // #76 fix: SQLite reads should be <1s (was 60s timeout with JXA)
    assert.ok(
      elapsed < 5000,
      `mail read took ${elapsed}ms (>5s) — #76 regression?`,
    );
  });

  it('search (SQLite — no enrichment)', async () => {
    const { text, elapsed } = await call(
      'mail_messages',
      { action: 'read', search: 'test', limit: 3, enrichContacts: false },
      'Mail',
    );
    assert.ok(text.length > 0, 'should return data');
    // Pure SQLite search should be fast — enrichment tested separately
    assert.ok(elapsed < 5000, `mail search took ${elapsed}ms (>5s)`);
  });
});

// ---------------------------------------------------------------------------
// Messages (SQLite — read-only)
// ---------------------------------------------------------------------------
describe('Messages read', () => {
  it('list chats (no enrichment)', async () => {
    const { text, elapsed } = await call(
      'messages_chat',
      { action: 'read', limit: 5, enrichContacts: false },
      'Messages',
    );
    assert.ok(text.length > 0, 'should return data');
    assert.ok(elapsed < 5000, `messages read took ${elapsed}ms (>5s)`);
  });

  it('list chats (with enrichment)', async () => {
    const { text, elapsed } = await call(
      'messages_chat',
      { action: 'read', limit: 3, enrichContacts: true },
      'Messages',
    );
    assert.ok(text.length > 0, 'should return data');
    // Enrichment adds contact lookup overhead
    assert.ok(
      elapsed < 15000,
      `messages enriched read took ${elapsed}ms (>15s)`,
    );
  });
});

// ---------------------------------------------------------------------------
// Contacts (read + search)
// ---------------------------------------------------------------------------
describe('Contacts read + search', () => {
  it('read (default list)', async () => {
    const { text, elapsed } = await call(
      'contacts_people',
      { action: 'read', limit: 5 },
      'Contacts',
    );
    assert.ok(text.length > 0, 'should return data');
    assert.ok(elapsed < 10000, `contacts read took ${elapsed}ms (>10s)`);
  });

  it('search (whose predicate — #77 fix)', async () => {
    const { text, elapsed } = await call(
      'contacts_people',
      { action: 'search', search: 'Kyle' },
      'Contacts',
    );
    assert.ok(text.length > 0, 'should return data');
    // #77 fix: whose() predicate should be <2s (was 60s timeout)
    assert.ok(
      elapsed < 5000,
      `contacts search took ${elapsed}ms (>5s) — #77 regression?`,
    );
  });
});
