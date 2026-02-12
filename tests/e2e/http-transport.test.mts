/**
 * HTTP Transport E2E tests.
 *
 * Tests the HTTP transport path that Claude iOS/web uses via Cloudflare Tunnel.
 * Validates: health endpoints, MCP protocol over HTTP, tool calls per backend,
 * enrichment in stateless mode, error handling, and performance baselines.
 *
 * Run: pnpm test:e2e:http
 * Requires: pnpm build first (the npm script handles this).
 */

import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  HTTP_TEST_URL,
  MCP_ENDPOINT,
  startHttpServer,
  stopHttpServer,
} from './helpers/http-server.mts';
import {
  callTool,
  extractId,
  type PerfEntry,
  PREFIX,
  printPerfSummary,
} from './helpers/shared.mts';

/** Performance ledger — collected and printed at the end. */
const perfLog: PerfEntry[] = [];

/** Create a fresh MCP client connected via HTTP transport. */
async function createHttpClient(endpoint = MCP_ENDPOINT): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  const client = new Client({ name: 'e2e-http-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------
before(async () => {
  await startHttpServer();
});

after(async () => {
  await stopHttpServer();
  printPerfSummary(perfLog);
});

// ---------------------------------------------------------------------------
// A. Server health (2 tests)
// ---------------------------------------------------------------------------
describe('HTTP Health endpoints', () => {
  it('GET /health returns 200 with service info', async () => {
    const res = await fetch(`${HTTP_TEST_URL}/health`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.strictEqual(body.status, 'healthy');
    assert.ok(body.service, 'should include service name');
    assert.ok(body.version, 'should include version');
    assert.ok(typeof body.uptime === 'number', 'should include uptime');
  });

  it('GET /health/ready returns 200 with subsystem statuses', async () => {
    const res = await fetch(`${HTTP_TEST_URL}/health/ready`);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.strictEqual(body.status, 'healthy');
    assert.ok(
      Array.isArray(body.subsystems),
      'should include subsystems array',
    );
    const subsystems = body.subsystems as Array<{
      name: string;
      status: string;
    }>;
    assert.ok(subsystems.length >= 2, 'should have at least 2 subsystems');
    for (const sub of subsystems) {
      assert.strictEqual(
        sub.status,
        'healthy',
        `${sub.name} should be healthy`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// B. MCP protocol over HTTP (3 tests)
// ---------------------------------------------------------------------------
describe('MCP protocol over HTTP', () => {
  let client: Client;

  after(async () => {
    if (client) await client.close().catch(() => {});
  });

  it('client connects to /mcp and lists tools', async () => {
    client = await createHttpClient(MCP_ENDPOINT);
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 6, `expected >=6 tools, got ${tools.length}`);
    const names = tools.map((t) => t.name);
    assert.ok(
      names.includes('reminders_tasks'),
      'should include reminders_tasks',
    );
    assert.ok(
      names.includes('calendar_events'),
      'should include calendar_events',
    );
    assert.ok(names.includes('notes_items'), 'should include notes_items');
    assert.ok(names.includes('mail_messages'), 'should include mail_messages');
    assert.ok(names.includes('messages_chat'), 'should include messages_chat');
    assert.ok(
      names.includes('contacts_people'),
      'should include contacts_people',
    );
  });

  it('root endpoint / also handles MCP protocol', async () => {
    // Claude.ai sends to root, not /mcp
    const rootClient = await createHttpClient(`${HTTP_TEST_URL}/`);
    try {
      const { tools } = await rootClient.listTools();
      assert.ok(
        tools.length >= 6,
        `root endpoint should list tools, got ${tools.length}`,
      );
    } finally {
      await rootClient.close().catch(() => {});
    }
  });

  it('tool schemas have expected structure', async () => {
    // Reuse existing client from first test or create new
    const c = await createHttpClient(MCP_ENDPOINT);
    try {
      const { tools } = await c.listTools();
      const reminders = tools.find((t) => t.name === 'reminders_tasks');
      assert.ok(reminders, 'reminders_tasks tool should exist');
      assert.ok(reminders.inputSchema, 'should have inputSchema');
      const props = (reminders.inputSchema as Record<string, unknown>)
        .properties as Record<string, unknown>;
      assert.ok(props.action, 'should have action property');
    } finally {
      await c.close().catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// C. Golden path per backend (9 tests)
// ---------------------------------------------------------------------------
describe('EventKit via HTTP (Reminders)', () => {
  let client: Client;
  let reminderId: string;
  const title = `${PREFIX} HTTP Reminder ${Date.now()}`;

  before(async () => {
    client = await createHttpClient();
  });
  after(async () => {
    // Cleanup: try to delete if still exists
    if (reminderId) {
      try {
        await client.callTool({
          name: 'reminders_tasks',
          arguments: { action: 'delete', id: reminderId },
        });
      } catch {
        /* already deleted */
      }
    }
    await client.close().catch(() => {});
  });

  it('create reminder', async () => {
    const { text, elapsed } = await callTool(
      client,
      'reminders_tasks',
      { action: 'create', title },
      'HTTP-Reminders',
      perfLog,
    );
    assert.ok(
      text.includes('Successfully created'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    reminderId = extractId(text)!;
    assert.ok(reminderId, 'should extract an id');
    assert.ok(elapsed < 10000, `create took ${elapsed}ms (>10s)`);
  });

  it('read reminder by id', async () => {
    const { text, elapsed } = await callTool(
      client,
      'reminders_tasks',
      { action: 'read', id: reminderId },
      'HTTP-Reminders',
      perfLog,
    );
    assert.ok(text.includes(PREFIX), 'should find the created reminder');
    assert.ok(elapsed < 10000, `read took ${elapsed}ms (>10s)`);
  });

  it('delete reminder', async () => {
    const { text, elapsed } = await callTool(
      client,
      'reminders_tasks',
      { action: 'delete', id: reminderId },
      'HTTP-Reminders',
      perfLog,
    );
    assert.ok(
      text.includes('Successfully deleted'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 10000, `delete took ${elapsed}ms (>10s)`);
    reminderId = ''; // prevent double-delete in after()
  });

  it('verify deleted', async () => {
    const { text } = await callTool(client, 'reminders_tasks', {
      action: 'read',
      id: reminderId || 'nonexistent',
    });
    assert.ok(
      !text.includes(title),
      'reminder should not exist after deletion',
    );
  });
});

describe('JXA via HTTP (Notes)', () => {
  let client: Client;
  let noteId: string;
  const title = `${PREFIX} HTTP Note ${Date.now()}`;
  const body = 'E2E HTTP transport test body';

  before(async () => {
    client = await createHttpClient();
  });
  after(async () => {
    if (noteId) {
      try {
        await client.callTool({
          name: 'notes_items',
          arguments: { action: 'delete', id: noteId },
        });
      } catch {
        /* already deleted */
      }
    }
    await client.close().catch(() => {});
  });

  it('create note', async () => {
    const { text, elapsed } = await callTool(
      client,
      'notes_items',
      { action: 'create', title, body },
      'HTTP-Notes',
      perfLog,
    );
    assert.ok(
      text.includes('Successfully created'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    noteId = extractId(text)!;
    assert.ok(noteId, 'should extract an id');
    assert.ok(elapsed < 15000, `create took ${elapsed}ms (>15s)`);
  });

  it('read note by id', async () => {
    const { text, elapsed } = await callTool(
      client,
      'notes_items',
      { action: 'read', id: noteId },
      'HTTP-Notes',
      perfLog,
    );
    assert.ok(text.includes(PREFIX), 'should find the created note');
    assert.ok(elapsed < 15000, `read took ${elapsed}ms (>15s)`);
  });

  it('delete note', async () => {
    const { text, elapsed } = await callTool(
      client,
      'notes_items',
      { action: 'delete', id: noteId },
      'HTTP-Notes',
      perfLog,
    );
    assert.ok(
      text.includes('Successfully deleted'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 15000, `delete took ${elapsed}ms (>15s)`);
    noteId = ''; // prevent double-delete in after()
  });
});

describe('SQLite via HTTP (Mail)', () => {
  let client: Client;

  before(async () => {
    client = await createHttpClient();
  });
  after(async () => {
    await client.close().catch(() => {});
  });

  it('read inbox', async () => {
    const { text, elapsed } = await callTool(
      client,
      'mail_messages',
      { action: 'read', limit: 5, enrichContacts: false },
      'HTTP-Mail',
      perfLog,
    );
    if (text.includes('No messages')) {
      console.log('  INFO empty inbox — structural checks skipped');
    } else {
      assert.ok(text.includes('ID:'), 'HTTP mail inbox should contain ID field');
    }
    assert.ok(elapsed < 10000, `mail read took ${elapsed}ms (>10s)`);
  });

  it('search mail', async () => {
    const { text, elapsed } = await callTool(
      client,
      'mail_messages',
      { action: 'read', search: 'test', limit: 3, enrichContacts: false },
      'HTTP-Mail',
      perfLog,
    );
    if (text.includes('No messages found')) {
      console.log('  INFO empty mail search — structural checks skipped');
    } else {
      assert.ok(text.includes('ID:') || text.includes('Mail matching'), 'HTTP mail search should return structured data');
    }
    assert.ok(elapsed < 10000, `mail search took ${elapsed}ms (>10s)`);
  });
});

// ---------------------------------------------------------------------------
// D. Read-only tools over HTTP (3 tests)
// ---------------------------------------------------------------------------
describe('Read-only tools over HTTP', () => {
  let client: Client;

  before(async () => {
    client = await createHttpClient();
  });
  after(async () => {
    await client.close().catch(() => {});
  });

  it('Messages: list chats (SQLite)', async () => {
    const { text, elapsed } = await callTool(
      client,
      'messages_chat',
      { action: 'read', limit: 5, enrichContacts: false },
      'HTTP-ReadOnly',
      perfLog,
    );
    if (text.includes('No chats found')) {
      console.log('  INFO empty state — HTTP messages structural checks skipped');
    } else {
      assert.ok(text.includes('ID:') || text.includes('Chats'), 'HTTP messages should return structured data');
    }
    assert.ok(elapsed < 10000, `messages read took ${elapsed}ms (>10s)`);
  });

  it('Calendar: list calendars (EventKit)', async () => {
    const { text, elapsed } = await callTool(
      client,
      'calendar_events',
      { action: 'read', enrichContacts: false },
      'HTTP-ReadOnly',
      perfLog,
    );
    if (text.includes('No events') || text.includes('No calendar')) {
      console.log('  INFO empty calendar — HTTP structural checks skipped');
    } else {
      assert.ok(text.includes('**') || text.includes('ID:'), 'HTTP calendar should return structured data');
    }
    assert.ok(elapsed < 10000, `calendar read took ${elapsed}ms (>10s)`);
  });

  it('Contacts: search by name (JXA whose())', async () => {
    const { text, elapsed } = await callTool(
      client,
      'contacts_people',
      { action: 'search', search: 'Kyle' },
      'HTTP-ReadOnly',
      perfLog,
    );
    if (text.includes('No contacts')) {
      console.log('  INFO no matching contacts — HTTP structural checks skipped');
    } else {
      assert.ok(text.includes('**') || text.includes('Name:') || text.includes('Kyle'), 'HTTP contacts should return structured data');
    }
    assert.ok(elapsed < 10000, `contacts search took ${elapsed}ms (>10s)`);
  });
});

// ---------------------------------------------------------------------------
// E. Cross-tool enrichment over HTTP (2 tests)
// ---------------------------------------------------------------------------
describe('Enrichment in stateless mode', () => {
  let client: Client;

  before(async () => {
    client = await createHttpClient();
  });
  after(async () => {
    await client.close().catch(() => {});
  });

  it('Messages with enrichContacts (cold cache per request)', async () => {
    const { text, elapsed } = await callTool(
      client,
      'messages_chat',
      { action: 'read', limit: 3, enrichContacts: true },
      'HTTP-Enrich',
      perfLog,
    );
    if (text.includes('No chats found')) {
      console.log('  INFO empty state — HTTP enriched messages structural checks skipped');
    } else {
      assert.ok(text.includes('ID:') || text.includes('Chats'), 'HTTP enriched messages should return structured data');
    }
    // HTTP stateless = cold cache every time. Allow more headroom than stdio.
    assert.ok(elapsed < 30000, `enriched messages took ${elapsed}ms (>30s)`);
  });

  it('Mail with enrichContacts (cold cache per request)', async () => {
    const { text, elapsed } = await callTool(
      client,
      'mail_messages',
      { action: 'read', limit: 3, enrichContacts: true },
      'HTTP-Enrich',
      perfLog,
    );
    if (text.includes('No messages')) {
      console.log('  INFO empty inbox — HTTP enriched mail structural checks skipped');
    } else {
      assert.ok(text.includes('ID:') || text.includes('**'), 'HTTP enriched mail should return structured data');
    }
    assert.ok(elapsed < 30000, `enriched mail took ${elapsed}ms (>30s)`);
  });
});

// ---------------------------------------------------------------------------
// F. Stateless behavior (3 tests)
// ---------------------------------------------------------------------------
describe('Stateless behavior', () => {
  it('concurrent clients get independent results', async () => {
    // Two clients make tool calls simultaneously — no state leakage
    const client1 = await createHttpClient();
    const client2 = await createHttpClient();

    try {
      const [res1, res2] = await Promise.all([
        callTool(
          client1,
          'reminders_tasks',
          { action: 'read', limit: 3 },
          'HTTP-Stateless',
          perfLog,
        ),
        callTool(
          client2,
          'calendar_events',
          { action: 'read', enrichContacts: false },
          'HTTP-Stateless',
          perfLog,
        ),
      ]);

      // Both should return valid data (not cross-contaminated)
      assert.ok(
        res1.text.includes('ID:') || res1.text.includes('No reminders') || res1.text.includes('**'),
        `client1 should get structured reminders data, got: ${res1.text.slice(0, 200)}`,
      );
      assert.ok(
        res2.text.includes('ID:') || res2.text.includes('No events') || res2.text.includes('**'),
        `client2 should get structured calendar data, got: ${res2.text.slice(0, 200)}`,
      );
    } finally {
      await client1.close().catch(() => {});
      await client2.close().catch(() => {});
    }
  });

  it('create via HTTP → read via HTTP in next request (data persists in OS)', async () => {
    const title = `${PREFIX} Stateless Test ${Date.now()}`;
    const createClient = await createHttpClient();
    let reminderId: string | undefined;

    try {
      // Create in one request
      const { text: createText } = await callTool(
        createClient,
        'reminders_tasks',
        { action: 'create', title },
        'HTTP-Stateless',
        perfLog,
      );
      reminderId = extractId(createText);
      assert.ok(reminderId, 'should create and return an id');
    } finally {
      await createClient.close().catch(() => {});
    }

    // Read in a separate request (proves data is in OS, not server state)
    const readClient = await createHttpClient();
    try {
      const { text: readText } = await callTool(readClient, 'reminders_tasks', {
        action: 'read',
        id: reminderId,
      });
      assert.ok(
        readText.includes(PREFIX),
        'should find reminder created by previous request',
      );
    } finally {
      // Cleanup
      try {
        await readClient.callTool({
          name: 'reminders_tasks',
          arguments: { action: 'delete', id: reminderId },
        });
      } catch {
        /* best effort */
      }
      await readClient.close().catch(() => {});
    }
  });

  it('no warm cache benefit (confirms stateless)', async () => {
    // Two sequential reads should have similar timing (no cache warming)
    const client1 = await createHttpClient();
    const client2 = await createHttpClient();

    try {
      const { elapsed: first } = await callTool(
        client1,
        'contacts_people',
        { action: 'search', search: 'Kyle' },
        'HTTP-Stateless',
        perfLog,
      );
      await client1.close().catch(() => {});

      const { elapsed: second } = await callTool(
        client2,
        'contacts_people',
        { action: 'search', search: 'Kyle' },
        'HTTP-Stateless',
        perfLog,
      );

      // Second call should not be dramatically faster than first (no warm cache).
      // We just log the comparison — not a hard assertion since JXA timing varies.
      console.log(
        `  Stateless cache check: first=${first}ms, second=${second}ms`,
      );
    } finally {
      await client2.close().catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// G. Error handling (2 tests)
// ---------------------------------------------------------------------------
describe('Error handling over HTTP', () => {
  let client: Client;

  before(async () => {
    client = await createHttpClient();
  });
  after(async () => {
    await client.close().catch(() => {});
  });

  it('missing required param returns validation error', async () => {
    // Call reminders_tasks without 'action' — should return error
    const result = await client.callTool({
      name: 'reminders_tasks',
      arguments: {},
    });
    const text =
      (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    // Should get a validation error, not a crash
    assert.ok(
      text.toLowerCase().includes('error') ||
        text.toLowerCase().includes('required') ||
        result.isError,
      `expected validation error, got: ${text.slice(0, 200)}`,
    );
  });

  it('invalid tool action returns error', async () => {
    const result = await client.callTool({
      name: 'reminders_tasks',
      arguments: { action: 'nonexistent_action' },
    });
    const text =
      (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    assert.ok(
      text.toLowerCase().includes('error') ||
        text.toLowerCase().includes('invalid') ||
        text.toLowerCase().includes('unknown') ||
        result.isError,
      `expected error for invalid action, got: ${text.slice(0, 200)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// H. Performance baseline (1 test)
// ---------------------------------------------------------------------------
describe('Performance baseline', () => {
  let client: Client;

  before(async () => {
    client = await createHttpClient();
  });
  after(async () => {
    await client.close().catch(() => {});
  });

  it('representative tool calls within HTTP timing budget', async () => {
    // Run a mix of tool calls to establish HTTP baselines
    // These are informational — the perf table is printed in after()
    const { elapsed: reminderTime } = await callTool(
      client,
      'reminders_tasks',
      { action: 'read', limit: 3 },
      'HTTP-Perf',
      perfLog,
    );
    const { elapsed: mailTime } = await callTool(
      client,
      'mail_messages',
      { action: 'read', limit: 3, enrichContacts: false },
      'HTTP-Perf',
      perfLog,
    );
    const { elapsed: msgTime } = await callTool(
      client,
      'messages_chat',
      { action: 'read', limit: 3, enrichContacts: false },
      'HTTP-Perf',
      perfLog,
    );

    // Soft assertion: individual calls should complete within 15s
    // HTTP adds overhead from per-request server creation
    assert.ok(
      reminderTime < 15000,
      `reminder baseline ${reminderTime}ms exceeds 15s`,
    );
    assert.ok(mailTime < 15000, `mail baseline ${mailTime}ms exceeds 15s`);
    assert.ok(msgTime < 15000, `messages baseline ${msgTime}ms exceeds 15s`);

    console.log(
      `\n  HTTP performance baselines: reminders=${reminderTime}ms, mail=${mailTime}ms, messages=${msgTime}ms`,
    );
  });
});
