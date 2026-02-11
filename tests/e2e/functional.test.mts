/**
 * Functional E2E tests for macos-mcp tools.
 *
 * Connects to the MCP server via stdio (dist/index.js) and exercises
 * create → read → delete flows for Reminders, Calendar, Notes, and
 * a read-only sanity check for Messages.
 *
 * Run: pnpm test:e2e
 * Requires: pnpm build first (the npm script handles this).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

const PREFIX = '[E2E-TEST]';
let client: Client;
let transport: StdioClientTransport;

/** Call a tool and return raw text content. */
async function callTool(name: string, args: Record<string, unknown>) {
  const start = performance.now();
  const result = await client.callTool({ name, arguments: args });
  const elapsed = Math.round(performance.now() - start);
  const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
  console.log(`  ${name}(${args.action}) → ${elapsed}ms`);
  return { text, elapsed };
}

/** Extract ID from success message like: Successfully created reminder "title".\n- ID: xxx */
function extractId(text: string): string | undefined {
  const match = text.match(/ID:\s*(.+)/);
  return match?.[1]?.trim();
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
});

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------
describe('Reminders CRUD', () => {
  let reminderId: string;
  const title = `${PREFIX} Buy milk ${Date.now()}`;

  it('create', async () => {
    const { text, elapsed } = await callTool('reminders_tasks', {
      action: 'create',
      title,
    });
    assert.ok(text.includes('Successfully created'), `unexpected response: ${text.slice(0, 200)}`);
    reminderId = extractId(text)!;
    assert.ok(reminderId, 'should extract an id from response');
    assert.ok(elapsed < 5000, `create took ${elapsed}ms (>5s)`);
  });

  it('read by id', async () => {
    const { text, elapsed } = await callTool('reminders_tasks', {
      action: 'read',
      id: reminderId,
    });
    assert.ok(text.includes(PREFIX), 'should find the created reminder');
    assert.ok(elapsed < 3000, `read took ${elapsed}ms (>3s)`);
  });

  it('delete', async () => {
    const { text, elapsed } = await callTool('reminders_tasks', {
      action: 'delete',
      id: reminderId,
    });
    assert.ok(text.includes('Successfully deleted'), `unexpected: ${text.slice(0, 200)}`);
    assert.ok(elapsed < 5000, `delete took ${elapsed}ms (>5s)`);
  });

  it('verify deleted', async () => {
    const { text } = await callTool('reminders_tasks', {
      action: 'read',
      id: reminderId,
    });
    // Should not contain our prefix title anymore (error or empty)
    assert.ok(!text.includes(title), 'reminder should not exist after deletion');
  });
});

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------
describe('Calendar CRUD', () => {
  let eventId: string;
  const title = `${PREFIX} Test Meeting ${Date.now()}`;
  // Schedule 1 hour from now
  const now = new Date();
  const start = new Date(now.getTime() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const fmt = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  it('create', async () => {
    const { text, elapsed } = await callTool('calendar_events', {
      action: 'create',
      title,
      startDate: fmt(start),
      endDate: fmt(end),
    });
    assert.ok(text.includes('Successfully created'), `unexpected response: ${text.slice(0, 200)}`);
    eventId = extractId(text)!;
    assert.ok(eventId, 'should extract an id from response');
    assert.ok(elapsed < 5000, `create took ${elapsed}ms (>5s)`);
  });

  it('read by id', async () => {
    const { text, elapsed } = await callTool('calendar_events', {
      action: 'read',
      id: eventId,
      enrichContacts: false,
    });
    assert.ok(text.includes(PREFIX), 'should find the created event');
    assert.ok(elapsed < 3000, `read took ${elapsed}ms (>3s)`);
  });

  it('delete', async () => {
    const { text, elapsed } = await callTool('calendar_events', {
      action: 'delete',
      id: eventId,
    });
    assert.ok(text.includes('Successfully deleted'), `unexpected: ${text.slice(0, 200)}`);
    assert.ok(elapsed < 5000, `delete took ${elapsed}ms (>5s)`);
  });
});

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------
describe('Notes CRUD', () => {
  let noteId: string;
  const title = `${PREFIX} Test Note ${Date.now()}`;

  it('create', async () => {
    const { text, elapsed } = await callTool('notes_items', {
      action: 'create',
      title,
      body: 'E2E test body content',
    });
    assert.ok(text.includes('Successfully created'), `unexpected response: ${text.slice(0, 200)}`);
    noteId = extractId(text)!;
    assert.ok(noteId, 'should extract an id from response');
    assert.ok(elapsed < 10000, `create took ${elapsed}ms (>10s)`);
  });

  it('read by id', async () => {
    const { text, elapsed } = await callTool('notes_items', {
      action: 'read',
      id: noteId,
    });
    assert.ok(text.includes(PREFIX), 'should find the created note');
    assert.ok(elapsed < 10000, `read took ${elapsed}ms (>10s)`);
  });

  it('delete', async () => {
    const { text, elapsed } = await callTool('notes_items', {
      action: 'delete',
      id: noteId,
    });
    assert.ok(text.includes('Successfully deleted'), `unexpected: ${text.slice(0, 200)}`);
    assert.ok(elapsed < 10000, `delete took ${elapsed}ms (>10s)`);
  });
});

// ---------------------------------------------------------------------------
// Messages (read-only sanity check)
// ---------------------------------------------------------------------------
describe('Messages read', () => {
  it('list chats', async () => {
    const { text, elapsed } = await callTool('messages_chat', {
      action: 'read',
      limit: 5,
      enrichContacts: false,
    });
    assert.ok(text.length > 0, 'should return data');
    assert.ok(elapsed < 10000, `messages read took ${elapsed}ms (>10s)`);
  });
});
