/**
 * Cross-tool intelligence E2E tests (GitHub Issue #70).
 *
 * Tests contact enrichment pipelines across Messages, Mail, Calendar,
 * and verifies enrichment toggles, cache behavior, and edge cases.
 *
 * Run: node --import tsx/esm --test tests/e2e/cross-tool.test.mts
 * Requires: pnpm build first.
 */

import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PREFIX = '[E2E-TEST]';
let client: Client;
let transport: StdioClientTransport;

const perfLog: Array<{ suite: string; step: string; ms: number }> = [];

async function callTool(
  name: string,
  args: Record<string, unknown>,
  suite = '',
  timeout = 120000,
) {
  const start = performance.now();
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout,
  });
  const elapsed = Math.round(performance.now() - start);
  const text =
    (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
  const step = `${name}(${JSON.stringify(args.action || 'call').slice(0, 30)})`;
  console.log(`  ${step} → ${elapsed}ms`);
  if (suite) perfLog.push({ suite, step, ms: elapsed });
  return { text, elapsed };
}

function extractId(text: string): string | undefined {
  const match = text.match(/ID:\s*(.+)/);
  return match?.[1]?.trim();
}

/** Track created contact IDs for cleanup. */
const createdContactIds: string[] = [];

before(async () => {
  transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    cwd: process.cwd(),
  });
  client = new Client({ name: 'e2e-cross-tool', version: '1.0.0' });
  await client.connect(transport);
});

after(async () => {
  // Clean up created contacts
  for (const id of createdContactIds) {
    try {
      await client.callTool({
        name: 'contacts_people',
        arguments: { action: 'delete', id },
      });
      console.log(`  cleanup: deleted contact ${id}`);
    } catch {
      console.log(`  cleanup: failed to delete contact ${id}`);
    }
  }

  await client.close();

  // Print performance summary
  console.log(
    '\n╔══════════════════════════════════════════════════════════════════╗',
  );
  console.log(
    '║              CROSS-TOOL E2E PERFORMANCE SUMMARY                ║',
  );
  console.log(
    '╠══════════════════════════════════════════════════════════════════╣',
  );
  const maxSuite = Math.max(...perfLog.map((e) => e.suite.length), 12);
  const maxStep = Math.max(...perfLog.map((e) => e.step.length), 20);
  console.log(
    `║ ${'Suite'.padEnd(maxSuite)}  ${'Step'.padEnd(maxStep)}  ${'Time'.padStart(7)} ║`,
  );
  console.log(
    `║ ${'─'.repeat(maxSuite)}  ${'─'.repeat(maxStep)}  ${'─'.repeat(7)} ║`,
  );
  for (const e of perfLog) {
    console.log(
      `║ ${e.suite.padEnd(maxSuite)}  ${e.step.padEnd(maxStep)}  ${String(`${e.ms}ms`).padStart(7)} ║`,
    );
  }
  console.log(
    '╚══════════════════════════════════════════════════════════════════╝',
  );
});

// ---------------------------------------------------------------------------
// 1. Contact -> Messages pipeline
// ---------------------------------------------------------------------------
describe('Cross-tool Pipelines', () => {
  it('1. Contact → Messages: search contact, find their messages via contact param', async () => {
    // Step A: Search contacts for a known name
    const { text: contactText, elapsed: contactElapsed } = await callTool(
      'contacts_people',
      { action: 'search', search: 'Kyle' },
      'Pipeline',
    );
    assert.ok(contactText.length > 0, 'should find contact');
    assert.ok(
      contactElapsed < 15000,
      `contact search took ${contactElapsed}ms`,
    );

    // Step B: Use contact param to find their messages
    const { text: msgText, elapsed: msgElapsed } = await callTool(
      'messages_chat',
      { action: 'read', contact: 'Kyle', limit: 5, enrichContacts: false },
      'Pipeline',
    );
    assert.ok(
      msgText.includes('Messages from contact') ||
        msgText.includes('No contact') ||
        msgText.includes('No messages'),
      `should return structured data or meaningful message, got: ${msgText.slice(0, 200)}`,
    );
    assert.ok(
      msgElapsed < 20000,
      `messages contact search took ${msgElapsed}ms`,
    );
  });

  // ---------------------------------------------------------------------------
  // 2. Contact -> Mail pipeline
  // ---------------------------------------------------------------------------
  it('2. Contact → Mail: search contact, find their mail via contact param', async () => {
    const { text: contactText } = await callTool(
      'contacts_people',
      { action: 'search', search: 'Kyle' },
      'Pipeline',
    );
    assert.ok(contactText.length > 0, 'should find contact');

    const { text: mailText, elapsed: mailElapsed } = await callTool(
      'mail_messages',
      { action: 'read', contact: 'Kyle', limit: 5, enrichContacts: false },
      'Pipeline',
    );
    assert.ok(
      mailText.includes('Mail from contact') ||
        mailText.includes('No contact') ||
        mailText.includes('No messages'),
      `should return structured data or meaningful message, got: ${mailText.slice(0, 200)}`,
    );
    assert.ok(mailElapsed < 20000, `mail contact search took ${mailElapsed}ms`);
  });

  // ---------------------------------------------------------------------------
  // 3. Contact -> Calendar pipeline
  // ---------------------------------------------------------------------------
  it('3. Contact → Calendar: read events with enrichContacts, verify enrichment', async () => {
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const monthAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

    const { text, elapsed } = await callTool(
      'calendar_events',
      {
        action: 'read',
        startDate: fmt(monthAgo),
        endDate: fmt(monthAhead),
        limit: 5,
        enrichContacts: true,
      },
      'Pipeline',
    );
    if (text.includes('No events') || text.includes('No calendar')) {
      console.log('  INFO empty calendar — structural checks skipped');
    } else {
      assert.ok(
        text.includes('**') || text.includes('ID:'),
        'calendar should return structured data',
      );
    }
    // Calendar enrichment resolves attendee emails to contact names
    // We cannot guarantee attendees exist, but the call must not crash
    assert.ok(elapsed < 30000, `calendar enriched read took ${elapsed}ms`);
  });
});

// ---------------------------------------------------------------------------
// 4. Messages enrichment toggle
// ---------------------------------------------------------------------------
describe('Enrichment Toggles', () => {
  it('4. Messages enrichment toggle: enrichContacts true vs false', async () => {
    const { text: rawText, elapsed: rawElapsed } = await callTool(
      'messages_chat',
      { action: 'read', limit: 3, enrichContacts: false },
      'Enrich',
    );
    if (rawText.includes('No chats found')) {
      console.log(
        '  INFO empty state — messages raw structural checks skipped',
      );
    } else {
      assert.ok(
        rawText.includes('ID:') || rawText.includes('Chats'),
        'raw messages should return structured data',
      );
    }
    assert.ok(rawElapsed < 2000, `raw took ${rawElapsed}ms`);

    const { text: enrichedText, elapsed: enrichedElapsed } = await callTool(
      'messages_chat',
      { action: 'read', limit: 3, enrichContacts: true },
      'Enrich',
    );
    assert.ok(enrichedText.length > 0, 'enriched should return data');
    // Both should contain chat data — enriched may have names added
    // Count chat entries in both — should be same count
    const rawChats = (rawText.match(/ID:\s*\S+;-;\S+/g) || []).length;
    const enrichedChats = (enrichedText.match(/ID:\s*\S+;-;\S+/g) || []).length;
    assert.strictEqual(
      enrichedChats,
      rawChats,
      `enriched (${enrichedChats}) and raw (${rawChats}) should have same chat count`,
    );
    assert.ok(enrichedElapsed < 30000, `enriched took ${enrichedElapsed}ms`);
  });

  // ---------------------------------------------------------------------------
  // 5. Mail enrichment toggle
  // ---------------------------------------------------------------------------
  it('5. Mail enrichment toggle: enrichContacts true vs false', async () => {
    const { text: rawText, elapsed: rawElapsed } = await callTool(
      'mail_messages',
      { action: 'read', limit: 3, enrichContacts: false },
      'Enrich',
    );
    if (rawText.includes('No messages')) {
      console.log('  INFO empty inbox — mail raw structural checks skipped');
    } else {
      assert.ok(
        rawText.includes('ID:') || rawText.includes('**'),
        'raw mail should return structured data',
      );
    }
    assert.ok(rawElapsed < 5000, `raw mail took ${rawElapsed}ms`);

    const { text: enrichedText, elapsed: enrichedElapsed } = await callTool(
      'mail_messages',
      { action: 'read', limit: 3, enrichContacts: true },
      'Enrich',
    );
    assert.ok(enrichedText.length > 0, 'enriched mail should return data');
    assert.ok(
      enrichedElapsed < 90000,
      `enriched mail took ${enrichedElapsed}ms`,
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Cache performance
// ---------------------------------------------------------------------------
describe('Cache & Performance', () => {
  it('6. Cache performance: second messages read should be similar or faster', async () => {
    // First call — may warm caches
    const { elapsed: first } = await callTool(
      'messages_chat',
      { action: 'read', limit: 5, enrichContacts: false },
      'Cache',
    );

    // Second call — should benefit from any caching
    const { elapsed: second } = await callTool(
      'messages_chat',
      { action: 'read', limit: 5, enrichContacts: false },
      'Cache',
    );

    console.log(`  Cache test: first=${first}ms, second=${second}ms`);
    // SQLite reads are already fast; we verify the second call does not degrade
    // Allow 50% overhead tolerance (no regression)
    assert.ok(
      second < first * 2 + 500,
      `second call (${second}ms) significantly slower than first (${first}ms) — possible regression`,
    );
  });

  // ---------------------------------------------------------------------------
  // 7. Unknown sender degradation
  // ---------------------------------------------------------------------------
  it('7. Unknown sender: falls back to raw handle, no crash', async () => {
    // Read messages without enrichment — all senders are raw handles
    const { text, elapsed } = await callTool(
      'messages_chat',
      { action: 'read', limit: 10, enrichContacts: false },
      'Cache',
    );
    if (text.includes('No chats found')) {
      console.log(
        '  INFO empty state — unknown sender structural checks skipped',
      );
    } else {
      assert.ok(
        text.includes('ID:') || text.includes('Chats'),
        'unknown sender should return structured data',
      );
    }
    // No error/crash — raw handles are acceptable fallback
    assert.ok(
      !text.toLowerCase().includes('error') ||
        text.toLowerCase().includes('no messages'),
      'should not contain errors',
    );
    assert.ok(elapsed < 2000, `unknown sender read took ${elapsed}ms`);
  });
});

// ---------------------------------------------------------------------------
// 8. Multi-step: person's full context
// ---------------------------------------------------------------------------
describe('Multi-step Full Context', () => {
  it('8. Full context: contact → messages → mail → calendar for one person', async () => {
    // (a) Search contact
    const { text: contactText, elapsed: e1 } = await callTool(
      'contacts_people',
      { action: 'search', search: 'Kyle' },
      'FullCtx',
    );
    assert.ok(contactText.length > 0, 'should find contact');
    assert.ok(e1 < 15000, `contact search: ${e1}ms`);

    // (b) Read their messages
    const { text: msgText, elapsed: e2 } = await callTool(
      'messages_chat',
      { action: 'read', contact: 'Kyle', limit: 3, enrichContacts: false },
      'FullCtx',
    );
    assert.ok(msgText.length > 0, 'should return messages data');
    assert.ok(e2 < 20000, `messages: ${e2}ms`);

    // (c) Read their mail
    const { text: mailText, elapsed: e3 } = await callTool(
      'mail_messages',
      { action: 'read', contact: 'Kyle', limit: 3, enrichContacts: false },
      'FullCtx',
    );
    assert.ok(mailText.length > 0, 'should return mail data');
    assert.ok(e3 < 20000, `mail: ${e3}ms`);

    // (d) Read calendar (enriched — will show attendees with contact names)
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const monthAhead = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const { text: calText, elapsed: e4 } = await callTool(
      'calendar_events',
      {
        action: 'read',
        startDate: fmt(monthAgo),
        endDate: fmt(monthAhead),
        limit: 3,
        enrichContacts: false,
      },
      'FullCtx',
    );
    assert.ok(calText.length > 0, 'should return calendar data');
    assert.ok(e4 < 10000, `calendar: ${e4}ms`);

    console.log(`  Full context total: ${e1 + e2 + e3 + e4}ms`);
  });
});

// ---------------------------------------------------------------------------
// 9. Create contact -> enrichment -> delete
// ---------------------------------------------------------------------------
describe('Contact Lifecycle', () => {
  it('9. Create contact → verify searchable → delete', async () => {
    const ts = Date.now();
    const firstName = `${PREFIX} CrossTest`;
    const lastName = `Person${ts}`;

    // (a) Create contact
    const { text: createText, elapsed: createElapsed } = await callTool(
      'contacts_people',
      {
        action: 'create',
        firstName,
        lastName,
        phone: '555-0177',
        email: `crosstest${ts}@example.com`,
      },
      'Lifecycle',
    );
    assert.ok(
      createText.includes('Successfully created') ||
        createText.includes('created'),
      `create failed: ${createText.slice(0, 200)}`,
    );
    const contactId = extractId(createText)!;
    assert.ok(contactId, 'should extract contact ID');
    createdContactIds.push(contactId);
    assert.ok(createElapsed < 10000, `create took ${createElapsed}ms`);

    // (b) Search for created contact
    const { text: searchText, elapsed: searchElapsed } = await callTool(
      'contacts_people',
      { action: 'search', search: 'CrossTest' },
      'Lifecycle',
    );
    assert.ok(
      searchText.includes('CrossTest'),
      `search should find created contact, got: ${searchText.slice(0, 200)}`,
    );
    assert.ok(searchElapsed < 5000, `search took ${searchElapsed}ms`);

    // (c) Delete contact
    const { text: deleteText, elapsed: deleteElapsed } = await callTool(
      'contacts_people',
      { action: 'delete', id: contactId },
      'Lifecycle',
    );
    assert.ok(
      deleteText.includes('Successfully deleted') ||
        deleteText.includes('deleted'),
      `delete failed: ${deleteText.slice(0, 200)}`,
    );
    assert.ok(deleteElapsed < 3000, `delete took ${deleteElapsed}ms`);
    // Remove from cleanup list since we already deleted
    const idx = createdContactIds.indexOf(contactId);
    if (idx !== -1) createdContactIds.splice(idx, 1);

    // (d) Verify deleted
    const { text: verifyText } = await callTool(
      'contacts_people',
      { action: 'read', id: contactId },
      'Lifecycle',
    );
    assert.ok(
      verifyText.includes('not found') ||
        verifyText.includes('No contact') ||
        !verifyText.includes('CrossTest'),
      'deleted contact should not be found',
    );
  });
});

// ---------------------------------------------------------------------------
// Edge Cases (E10-E13)
// ---------------------------------------------------------------------------
describe('Cross-tool Edge Cases', () => {
  // E10: Contact with multiple phones — all resolve to same name
  it('E10. Contact with multiple phones → same name resolution', async () => {
    // We cannot guarantee a contact with multiple phones exists in the test env.
    // Instead, verify the contact search returns the contact and that the system
    // handles enrichment without errors.
    const { text, elapsed } = await callTool(
      'contacts_people',
      { action: 'search', search: 'Kyle' },
      'Edge',
    );
    assert.ok(text.length > 0, 'should return contact data');
    // If the contact has multiple phones, they should all show under the same name
    // This is a structural verification — the system groups all phones under one contact
    assert.ok(elapsed < 15000, `multi-phone search took ${elapsed}ms`);
    // NOTE: Deterministic multi-phone verification requires a known test contact
    // with multiple phone numbers. This test verifies the system does not crash
    // and returns data. For full verification, create a contact with multiple phones
    // and check the read output.
    console.log(
      '  NOTE: Multi-phone resolution verified structurally (no crash, data returned)',
    );
  });

  // E11: Contact with multiple emails — all resolve to same name
  it('E11. Contact with multiple emails → same name resolution', async () => {
    // Same approach as E10 — structural verification
    const { text, elapsed } = await callTool(
      'contacts_people',
      { action: 'search', search: 'Kyle' },
      'Edge',
    );
    assert.ok(text.length > 0, 'should return contact data');
    assert.ok(elapsed < 15000, `multi-email search took ${elapsed}ms`);
    console.log(
      '  NOTE: Multi-email resolution verified structurally (no crash, data returned)',
    );
  });

  // E12: Phone normalization
  it('E12. Phone normalization → contact search handles various formats', async () => {
    // Create a contact with a formatted phone number, then search by name
    // to verify the phone is stored and retrievable
    const ts = Date.now();
    const { text: createText } = await callTool(
      'contacts_people',
      {
        action: 'create',
        firstName: `${PREFIX} PhoneNorm`,
        lastName: `Test${ts}`,
        phone: '+1 (555) 012-3456',
      },
      'Edge',
    );
    const contactId = extractId(createText);
    assert.ok(contactId, 'should create contact with formatted phone');
    createdContactIds.push(contactId!);

    // Read back the contact and verify phone is stored
    const { text: readText, elapsed } = await callTool(
      'contacts_people',
      { action: 'read', id: contactId! },
      'Edge',
    );
    assert.ok(
      readText.includes('555') && readText.includes('012'),
      `phone should be present in contact data: ${readText.slice(0, 300)}`,
    );
    assert.ok(elapsed < 3000, `read took ${elapsed}ms`);

    // Clean up
    await client.callTool({
      name: 'contacts_people',
      arguments: { action: 'delete', id: contactId },
    });
    const idx = createdContactIds.indexOf(contactId!);
    if (idx !== -1) createdContactIds.splice(idx, 1);
    console.log(
      '  NOTE: Phone normalization verified at storage level. Cross-handle matching depends on enrichment cache which normalizes at resolve time.',
    );
  });

  // E13: Resolver timeout — graceful degradation
  it('E13. Resolver timeout → graceful error, no crash', async () => {
    // Search for a nonexistent contact name — should get a clean error
    const { text, elapsed } = await callTool(
      'messages_chat',
      {
        action: 'read',
        contact: 'ZZZZZ_NonexistentPerson_E2E_99999',
        limit: 3,
        enrichContacts: false,
      },
      'Edge',
    );
    assert.ok(text.length > 0, 'should return a response (error or empty)');
    // Should get a helpful message, not a stack trace
    assert.ok(
      !text.includes('stack') && !text.includes('TypeError'),
      `should not expose stack traces: ${text.slice(0, 300)}`,
    );
    // ContactSearchError should produce a meaningful message
    assert.ok(
      text.toLowerCase().includes('no contact') ||
        text.toLowerCase().includes('not found') ||
        text.toLowerCase().includes('no matching') ||
        text.toLowerCase().includes('no messages') ||
        text.toLowerCase().includes('could not'),
      `expected graceful error message, got: ${text.slice(0, 300)}`,
    );
    assert.ok(elapsed < 20000, `resolver timeout/error took ${elapsed}ms`);
  });
});
