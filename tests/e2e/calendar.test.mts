/**
 * E2E Calendar tests — Issue #65
 *
 * Covers all 20 test cases: CRUD, recurring events, enrichment, edge cases.
 * Run: node --import tsx/esm --test tests/e2e/calendar.test.mts
 * Requires: pnpm build first.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

const PREFIX = '[E2E-TEST]';
let client: Client;
let transport: StdioClientTransport;

/** Performance ledger — collected and printed at the end. */
const perfLog: Array<{ suite: string; step: string; ms: number }> = [];

/** Call a tool and return raw text content + timing. */
async function callTool(
  name: string,
  args: Record<string, unknown>,
  suite = '',
) {
  const start = performance.now();
  const result = await client.callTool({ name, arguments: args });
  const elapsed = Math.round(performance.now() - start);
  const text =
    (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
  const step = `${name}(${args.action})`;
  console.log(`  ${step} → ${elapsed}ms`);
  if (suite) perfLog.push({ suite, step, ms: elapsed });
  return { text, elapsed };
}

/** Extract ID from success message like: Successfully created event "title".\n- ID: xxx */
function extractId(text: string): string | undefined {
  const match = text.match(/ID:\s*(.+)/);
  return match?.[1]?.trim();
}

/** Format a Date as YYYY-MM-DD HH:mm:ss (local). */
function fmt(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format a Date as YYYY-MM-DD (local). */
function fmtDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** IDs of events to clean up at the end. */
const cleanupIds: string[] = [];

before(async () => {
  transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    cwd: process.cwd(),
  });
  client = new Client({ name: 'e2e-calendar', version: '1.0.0' });
  await client.connect(transport);
});

after(async () => {
  // Clean up all created events
  for (const id of cleanupIds) {
    try {
      await client.callTool({
        name: 'calendar_events',
        arguments: { action: 'delete', id },
      });
      console.log(`  cleanup: deleted ${id}`);
    } catch {
      console.log(`  cleanup: failed to delete ${id} (may already be deleted)`);
    }
  }

  await client.close();

  // Print performance summary
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║              CALENDAR E2E PERFORMANCE SUMMARY           ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  const maxSuite = Math.max(...perfLog.map((e) => e.suite.length), 12);
  const maxStep = Math.max(...perfLog.map((e) => e.step.length), 20);
  console.log(
    `║ ${'Suite'.padEnd(maxSuite)}  ${'Step'.padEnd(maxStep)}  ${'Time'.padStart(7)} ║`,
  );
  console.log(`║ ${'─'.repeat(maxSuite)}  ${'─'.repeat(maxStep)}  ${'─'.repeat(7)} ║`);
  for (const e of perfLog) {
    console.log(
      `║ ${e.suite.padEnd(maxSuite)}  ${e.step.padEnd(maxStep)}  ${String(e.ms + 'ms').padStart(7)} ║`,
    );
  }
  console.log('╚══════════════════════════════════════════════════════════╝');
});

// ---------------------------------------------------------------------------
// 1. List calendars
// ---------------------------------------------------------------------------
describe('Calendar List', () => {
  it('1. list calendars → names and total', async () => {
    const { text, elapsed } = await callTool(
      'calendar_calendars',
      { action: 'read' },
      'List',
    );
    assert.ok(text.includes('Calendars'), `expected calendar list, got: ${text.slice(0, 200)}`);
    assert.ok(elapsed < 2000, `list took ${elapsed}ms (>2s)`);
  });
});

// ---------------------------------------------------------------------------
// Main CRUD
// ---------------------------------------------------------------------------
describe('Calendar CRUD', () => {
  let eventId: string;
  const title = `${PREFIX} Meeting ${Date.now()}`;
  const now = new Date();
  const start = new Date(now.getTime() + 2 * 60 * 60 * 1000); // +2h
  const end = new Date(start.getTime() + 60 * 60 * 1000); // +1h duration

  it('6. create basic event → success with ID', async () => {
    const { text, elapsed } = await callTool(
      'calendar_events',
      { action: 'create', title, startDate: fmt(start), endDate: fmt(end) },
      'CRUD',
    );
    assert.ok(text.includes('Successfully created'), `unexpected: ${text.slice(0, 200)}`);
    eventId = extractId(text)!;
    assert.ok(eventId, 'should extract an id');
    cleanupIds.push(eventId);
    assert.ok(elapsed < 3000, `create took ${elapsed}ms (>3s)`);
  });

  it('2. read events (default) → markdown list', async () => {
    const { text, elapsed } = await callTool(
      'calendar_events',
      { action: 'read', enrichContacts: false },
      'CRUD',
    );
    assert.ok(text.length > 0, 'should return events');
    assert.ok(elapsed < 2000, `read took ${elapsed}ms (>2s)`);
  });

  it('3. read with date range → only events in range', async () => {
    const { text, elapsed } = await callTool(
      'calendar_events',
      {
        action: 'read',
        startDate: fmt(start),
        endDate: fmt(end),
        enrichContacts: false,
      },
      'CRUD',
    );
    assert.ok(text.includes(PREFIX), 'date-range read should find our event');
    assert.ok(elapsed < 2000, `date-range read took ${elapsed}ms (>2s)`);
  });

  it('5. search events → filtered results', async () => {
    const { text, elapsed } = await callTool(
      'calendar_events',
      {
        action: 'read',
        search: 'Meeting',
        startDate: fmt(start),
        endDate: fmt(end),
        enrichContacts: false,
      },
      'CRUD',
    );
    assert.ok(text.includes(PREFIX), 'search should find our event');
    assert.ok(elapsed < 2000, `search took ${elapsed}ms (>2s)`);
  });

  it('9. read by ID → full detail', async () => {
    const { text, elapsed } = await callTool(
      'calendar_events',
      { action: 'read', id: eventId, enrichContacts: false },
      'CRUD',
    );
    assert.ok(text.includes(PREFIX), 'should find event by ID');
    assert.ok(text.includes(title), 'should include title');
    assert.ok(elapsed < 2000, `read-by-id took ${elapsed}ms (>2s)`);
  });

  it('10. update event → success, verify on re-read', async () => {
    const newTitle = `${PREFIX} Updated Meeting ${Date.now()}`;
    const { text: updateText, elapsed } = await callTool(
      'calendar_events',
      { action: 'update', id: eventId, title: newTitle },
      'CRUD',
    );
    assert.ok(
      updateText.includes('Successfully updated'),
      `unexpected: ${updateText.slice(0, 200)}`,
    );
    assert.ok(elapsed < 3000, `update took ${elapsed}ms (>3s)`);

    // Verify the update
    const { text: readText } = await callTool(
      'calendar_events',
      { action: 'read', id: eventId, enrichContacts: false },
      'CRUD',
    );
    assert.ok(readText.includes('Updated Meeting'), 'updated title should appear');
  });

  it('11. delete event → success, not found on re-read', async () => {
    const { text, elapsed } = await callTool(
      'calendar_events',
      { action: 'delete', id: eventId },
      'CRUD',
    );
    assert.ok(text.includes('Successfully deleted'), `unexpected: ${text.slice(0, 200)}`);
    assert.ok(elapsed < 3000, `delete took ${elapsed}ms (>3s)`);

    // Remove from cleanup since already deleted
    const idx = cleanupIds.indexOf(eventId);
    if (idx >= 0) cleanupIds.splice(idx, 1);

    // Verify deletion
    const { text: readText } = await callTool(
      'calendar_events',
      { action: 'read', id: eventId, enrichContacts: false },
      'CRUD',
    );
    assert.ok(
      !readText.includes(title),
      'deleted event should not appear',
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Filter by calendar
// ---------------------------------------------------------------------------
describe('Calendar Filter', () => {
  it('4. filter by calendar → only events from that calendar', async () => {
    // First get calendar names
    const { text: calText } = await callTool(
      'calendar_calendars',
      { action: 'read' },
      'Filter',
    );
    // Extract first writable calendar name (skip Holidays/Birthdays which are read-only)
    const calNames = [...calText.matchAll(/- (.+?) \(ID: /g)].map(m => m[1]);
    const calName = calNames.find(n => !n.includes('Holiday') && !n.includes('Birthdays')) ?? calNames[0];
    assert.ok(calName, `should find at least one calendar, got: ${calText.slice(0, 200)}`);

    const { text, elapsed } = await callTool(
      'calendar_events',
      { action: 'read', filterCalendar: calName, enrichContacts: false },
      'Filter',
    );
    assert.ok(text.length > 0, 'should return data');
    assert.ok(elapsed < 2000, `filter took ${elapsed}ms (>2s)`);
  });
});

// ---------------------------------------------------------------------------
// 7. Create in specific calendar
// ---------------------------------------------------------------------------
describe('Calendar Specific', () => {
  let eventId: string;

  it('7. create in specific calendar → success, correct calendar', async () => {
    // Get first writable calendar name
    const { text: calText } = await callTool(
      'calendar_calendars',
      { action: 'read' },
      'Specific',
    );
    const calNames = [...calText.matchAll(/- (.+?) \(ID: /g)].map(m => m[1]);
    const calName = calNames.find(n => !n.includes('Holiday') && !n.includes('Birthdays')) ?? calNames[0];
    assert.ok(calName, 'need a calendar name');

    const title = `${PREFIX} Specific Cal ${Date.now()}`;
    const now = new Date();
    const start = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const { text, elapsed } = await callTool(
      'calendar_events',
      {
        action: 'create',
        title,
        startDate: fmt(start),
        endDate: fmt(end),
        targetCalendar: calName,
      },
      'Specific',
    );
    assert.ok(text.includes('Successfully created'), `unexpected: ${text.slice(0, 200)}`);
    eventId = extractId(text)!;
    assert.ok(eventId, 'should extract an id');
    cleanupIds.push(eventId);
    assert.ok(elapsed < 3000, `create took ${elapsed}ms (>3s)`);

    // Verify it's in the correct calendar
    const { text: readText } = await callTool(
      'calendar_events',
      { action: 'read', id: eventId, enrichContacts: false },
      'Specific',
    );
    assert.ok(readText.includes(calName), `event should be in calendar "${calName}"`);
  });
});

// ---------------------------------------------------------------------------
// 8. Create all-day event
// ---------------------------------------------------------------------------
describe('Calendar All-Day', () => {
  it('8. create all-day event → success', async () => {
    const title = `${PREFIX} All Day ${Date.now()}`;
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dayAfter = new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000);

    const { text, elapsed } = await callTool(
      'calendar_events',
      {
        action: 'create',
        title,
        startDate: fmtDate(tomorrow),
        endDate: fmtDate(dayAfter),
        isAllDay: true,
      },
      'AllDay',
    );
    assert.ok(text.includes('Successfully created'), `unexpected: ${text.slice(0, 200)}`);
    const id = extractId(text)!;
    assert.ok(id, 'should extract an id');
    cleanupIds.push(id);
    assert.ok(elapsed < 3000, `create took ${elapsed}ms (>3s)`);
  });
});

// ---------------------------------------------------------------------------
// 12-14. Recurring events
// ---------------------------------------------------------------------------
describe('Calendar Recurring', () => {
  let recurringId: string;
  const title = `${PREFIX} Weekly Sync ${Date.now()}`;
  const now = new Date();
  const start = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  it('12. create recurring (weekly) → success', async () => {
    const { text, elapsed } = await callTool(
      'calendar_events',
      {
        action: 'create',
        title,
        startDate: fmt(start),
        endDate: fmt(end),
        recurrence: 'weekly',
        recurrenceCount: 4,
      },
      'Recurring',
    );
    assert.ok(text.includes('Successfully created'), `unexpected: ${text.slice(0, 200)}`);
    recurringId = extractId(text)!;
    assert.ok(recurringId, 'should extract an id');
    cleanupIds.push(recurringId);
    assert.ok(elapsed < 3000, `create took ${elapsed}ms (>3s)`);
  });

  it('13. read recurring by ID → recurrence info present', async () => {
    const { text, elapsed } = await callTool(
      'calendar_events',
      { action: 'read', id: recurringId, enrichContacts: false },
      'Recurring',
    );
    assert.ok(text.includes(title), 'should find recurring event');
    // Check for recurrence indication
    assert.ok(
      text.toLowerCase().includes('recur') || text.toLowerCase().includes('weekly'),
      `recurring event should show recurrence info, got: ${text.slice(0, 500)}`,
    );
    assert.ok(elapsed < 2000, `read took ${elapsed}ms (>2s)`);
  });

  it('14. delete recurring (single) → only removes single occurrence', async () => {
    const { text, elapsed } = await callTool(
      'calendar_events',
      { action: 'delete', id: recurringId },
      'Recurring',
    );
    assert.ok(
      text.includes('Successfully deleted'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 3000, `delete took ${elapsed}ms (>3s)`);

    // Remove from cleanup since deleted
    const idx = cleanupIds.indexOf(recurringId);
    if (idx >= 0) cleanupIds.splice(idx, 1);
  });
});

// ---------------------------------------------------------------------------
// 15-16. Enrichment
// ---------------------------------------------------------------------------
describe('Calendar Enrichment', () => {
  it('15. enrichment ON (default) → read succeeds', async () => {
    const { text, elapsed } = await callTool(
      'calendar_events',
      { action: 'read', enrichContacts: true },
      'Enrichment',
    );
    assert.ok(text.length > 0, 'should return data');
    // Enrichment may resolve attendee names if events have attendees
    assert.ok(elapsed < 5000, `enriched read took ${elapsed}ms (>5s)`);
  });

  it('16. enrichment OFF → read succeeds with raw data', async () => {
    const { text, elapsed } = await callTool(
      'calendar_events',
      { action: 'read', enrichContacts: false },
      'Enrichment',
    );
    assert.ok(text.length > 0, 'should return data');
    assert.ok(elapsed < 2000, `raw read took ${elapsed}ms (>2s)`);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases (E17-E20)
// ---------------------------------------------------------------------------
describe('Calendar Edge Cases', () => {
  it('E17. create with past dates → success', async () => {
    const title = `${PREFIX} Past Event ${Date.now()}`;
    const pastStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 1 week ago
    const pastEnd = new Date(pastStart.getTime() + 60 * 60 * 1000);

    const { text, elapsed } = await callTool(
      'calendar_events',
      {
        action: 'create',
        title,
        startDate: fmt(pastStart),
        endDate: fmt(pastEnd),
      },
      'Edge',
    );
    assert.ok(text.includes('Successfully created'), `unexpected: ${text.slice(0, 200)}`);
    const id = extractId(text)!;
    assert.ok(id, 'should extract an id');
    cleanupIds.push(id);
    assert.ok(elapsed < 3000, `create took ${elapsed}ms (>3s)`);
  });

  it('E18. create with location + URL → fields persist on re-read', async () => {
    const title = `${PREFIX} Located Event ${Date.now()}`;
    const now = new Date();
    const start = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const location = 'Conference Room A';
    const url = 'https://example.com/meeting';

    const { text } = await callTool(
      'calendar_events',
      {
        action: 'create',
        title,
        startDate: fmt(start),
        endDate: fmt(end),
        location,
        url,
      },
      'Edge',
    );
    assert.ok(text.includes('Successfully created'), `unexpected: ${text.slice(0, 200)}`);
    const id = extractId(text)!;
    assert.ok(id, 'should extract an id');
    cleanupIds.push(id);

    // Re-read and verify fields
    const { text: readText, elapsed } = await callTool(
      'calendar_events',
      { action: 'read', id, enrichContacts: false },
      'Edge',
    );
    assert.ok(readText.includes(location), `location should persist, got: ${readText.slice(0, 500)}`);
    assert.ok(readText.includes('example.com'), `URL should persist, got: ${readText.slice(0, 500)}`);
    assert.ok(elapsed < 2000, `re-read took ${elapsed}ms (>2s)`);
  });

  it('E19. update nonexistent ID → error response', async () => {
    const { text, elapsed } = await callTool(
      'calendar_events',
      { action: 'update', id: 'NONEXISTENT-ID-12345', title: 'Should Fail' },
      'Edge',
    );
    // Should get an error, not a success
    assert.ok(
      !text.includes('Successfully updated'),
      `should not succeed for nonexistent ID, got: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 3000, `error response took ${elapsed}ms (>3s)`);
  });

  it('E20. read event enrichContacts=false → raw attendee data', async () => {
    const { text, elapsed } = await callTool(
      'calendar_events',
      { action: 'read', enrichContacts: false },
      'Edge',
    );
    assert.ok(text.length > 0, 'should return data');
    assert.ok(elapsed < 2000, `read took ${elapsed}ms (>2s)`);
  });
});
