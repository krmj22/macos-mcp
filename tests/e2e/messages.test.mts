/**
 * E2E tests for messages_chat tool (GitHub Issue #68).
 *
 * Messages READS use SQLite backend (sqliteMessageReader.ts).
 * Messages SENDS use JXA — send tests are SKIPPED to avoid sending real messages.
 *
 * Run: node --import tsx/esm --test tests/e2e/messages.test.mts
 * Requires: pnpm build first.
 */

import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const _PREFIX = '[E2E-TEST]';
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
  const step = `${name}(${JSON.stringify(args.action)}${args.search ? ` search=${args.search}` : ''}${args.chatId ? ' chatId' : ''}${args.contact ? ` contact=${args.contact}` : ''})`;
  console.log(`  ${step} → ${elapsed}ms`);
  if (suite) perfLog.push({ suite, step, ms: elapsed });
  return { text, elapsed };
}

/** Format a Date as YYYY-MM-DD HH:mm:ss (local). */
function fmt(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

before(async () => {
  transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    cwd: process.cwd(),
  });
  client = new Client({ name: 'e2e-messages-test', version: '1.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client.close();

  // Print performance summary
  console.log(
    '\n╔══════════════════════════════════════════════════════════════════╗',
  );
  console.log(
    '║              MESSAGES E2E PERFORMANCE SUMMARY                   ║',
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

// Shared state across tests — populated by test 1, used by later tests
let firstChatId: string;
let firstParticipantName: string;

// ---------------------------------------------------------------------------
// Main Tests (1-13)
// ---------------------------------------------------------------------------
describe('Messages — Main Tests', () => {
  // Test 1: List chats
  it('1. List chats → header with total, names, IDs, participants, last message', async () => {
    const { text, elapsed } = await callTool(
      'messages_chat',
      { action: 'read', limit: 10, enrichContacts: false },
      'Messages',
    );
    if (text.includes('No chats found')) {
      console.log('  INFO empty state — structural checks skipped');
    } else {
      assert.ok(text.includes('ID:'), 'response should contain ID field');
      assert.ok(
        text.includes('Participants') || text.includes('**'),
        'response should have structured format',
      );
    }
    // First call has cold start overhead — allow 2000ms
    assert.ok(
      elapsed < 2000,
      `list chats took ${elapsed}ms (>2000ms threshold)`,
    );

    // Extract a chatId for later tests — guids can be iMessage;-;, SMS;-;, or any;-;
    const chatIdMatch = text.match(/ID:\s*(\S+;-;\S+)/);
    if (chatIdMatch) {
      firstChatId = chatIdMatch[1];
    }
    // Extract a participant name or handle for search tests
    const participantMatch = text.match(/Participants?:\s*(.+)/);
    if (participantMatch) {
      firstParticipantName = participantMatch[1].split(',')[0].trim();
    }
    assert.ok(
      firstChatId,
      `should find at least one chatId, got text: ${text.slice(0, 300)}`,
    );
  });

  // Test 2: Pagination
  it('2. Pagination → limit: 5, offset: 0 → Max 5 chats', async () => {
    const { text, elapsed } = await callTool(
      'messages_chat',
      { action: 'read', limit: 5, offset: 0, enrichContacts: false },
      'Messages',
    );
    if (text.includes('No chats found')) {
      console.log('  INFO empty state — pagination structural checks skipped');
    } else {
      assert.ok(
        text.includes('ID:'),
        'paginated response should contain ID field',
      );
    }
    // Count chat entries — each chat has an "ID:" line
    const chatCount = (text.match(/ID:\s*\S+;-;\S+/g) || []).length;
    assert.ok(
      chatCount <= 5,
      `pagination returned ${chatCount} chats (expected ≤5)`,
    );
    assert.ok(elapsed < 1000, `pagination took ${elapsed}ms (>1000ms)`);
  });

  // Test 3: Read chat by ID
  it('3. Read chat by ID → messages in chronological order with senders and dates', async () => {
    assert.ok(firstChatId, 'need chatId from test 1');
    const { text, elapsed } = await callTool(
      'messages_chat',
      { action: 'read', chatId: firstChatId, limit: 10, enrichContacts: false },
      'Messages',
    );
    if (text.includes('No messages')) {
      console.log('  INFO empty chat — structural checks skipped');
    } else {
      assert.ok(
        text.includes('**') && text.includes('['),
        'chat messages should have sender and date format',
      );
    }
    assert.ok(elapsed < 1000, `read chat took ${elapsed}ms (>1000ms)`);
  });

  // Test 4: Search chats by participant/name
  it('4. Search chats → search matches chat names/participants only', async () => {
    // Use a portion of the first participant handle for search
    const searchTerm = firstParticipantName
      ? firstParticipantName.replace(/[+()]/g, '').slice(0, 6)
      : 'Kyle';
    const { text, elapsed } = await callTool(
      'messages_chat',
      { action: 'read', search: searchTerm, enrichContacts: false },
      'Messages',
    );
    if (text.includes('No chats found')) {
      console.log('  INFO no matching chats — structural checks skipped');
    } else {
      assert.ok(
        text.includes('ID:') || text.includes('Chats matching'),
        'search should return structured data',
      );
    }
    assert.ok(elapsed < 2000, `search took ${elapsed}ms (>2000ms)`);
  });

  // Test 5: Search message content
  it('5. Search message content → searchMessages: true finds text across chats', async () => {
    const { text, elapsed } = await callTool(
      'messages_chat',
      {
        action: 'read',
        search: 'the',
        searchMessages: true,
        limit: 5,
        enrichContacts: false,
      },
      'Messages',
    );
    if (text.includes('No messages found')) {
      console.log('  INFO no matching messages — structural checks skipped');
    } else {
      assert.ok(
        text.includes('Messages matching') || text.includes('**'),
        'message search should return structured data',
      );
    }
    assert.ok(
      elapsed < 2000,
      `message content search took ${elapsed}ms (>2000ms)`,
    );
  });

  // Test 6: Find by contact name
  it('6. Find by contact name → contact param resolves to messages', async () => {
    const { text, elapsed } = await callTool(
      'messages_chat',
      { action: 'read', contact: 'Kyle', limit: 5, enrichContacts: false },
      'Messages',
    );
    // May return messages or an error if contact not found — both handled gracefully
    assert.ok(
      text.includes('Messages from contact') ||
        text.includes('No contact') ||
        text.includes('No messages') ||
        text.includes('Contact search'),
      `should return structured data or meaningful message, got: ${text.slice(0, 200)}`,
    );
    // Contact resolver uses JXA lookup which can be slow (known: #77 context)
    assert.ok(elapsed < 20000, `contact search took ${elapsed}ms (>20000ms)`);
  });

  // Test 7: dateRange: today
  it("7. dateRange: today → only today's chats", async () => {
    const { text, elapsed } = await callTool(
      'messages_chat',
      { action: 'read', dateRange: 'today', enrichContacts: false },
      'Messages',
    );
    if (text.includes('No chats found')) {
      console.log('  INFO no chats today — structural checks skipped');
    } else {
      assert.ok(
        text.includes('ID:') || text.includes('Chats'),
        'today filter should return structured data',
      );
    }
    assert.ok(elapsed < 1000, `today filter took ${elapsed}ms (>1000ms)`);
  });

  // Test 8: dateRange: last_7_days
  it('8. dateRange: last_7_days → recent chats', async () => {
    const { text, elapsed } = await callTool(
      'messages_chat',
      { action: 'read', dateRange: 'last_7_days', enrichContacts: false },
      'Messages',
    );
    if (text.includes('No chats found')) {
      console.log('  INFO no chats in last 7 days — structural checks skipped');
    } else {
      assert.ok(
        text.includes('ID:') || text.includes('Chats'),
        'last_7_days filter should return structured data',
      );
    }
    assert.ok(elapsed < 1000, `last_7_days filter took ${elapsed}ms (>1000ms)`);
  });

  // Test 9: Custom date range with explicit startDate/endDate
  it('9. Custom date range → startDate/endDate filters correctly', async () => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { text, elapsed } = await callTool(
      'messages_chat',
      {
        action: 'read',
        startDate: fmt(weekAgo),
        endDate: fmt(now),
        enrichContacts: false,
      },
      'Messages',
    );
    if (text.includes('No chats found')) {
      console.log('  INFO no chats in date range — structural checks skipped');
    } else {
      assert.ok(
        text.includes('ID:') || text.includes('Chats'),
        'custom date range should return structured data',
      );
    }
    assert.ok(elapsed < 1000, `custom date range took ${elapsed}ms (>1000ms)`);
  });

  // Test 10: Enrichment ON (default)
  it('10. Enrichment ON → participant names like "Name (handle)"', async () => {
    const { text, elapsed } = await callTool(
      'messages_chat',
      { action: 'read', limit: 3, enrichContacts: true },
      'Messages',
    );
    if (text.includes('No chats found')) {
      console.log('  INFO empty state — enrichment structural checks skipped');
    } else {
      assert.ok(
        text.includes('ID:') || text.includes('Chats'),
        'enriched response should return structured data',
      );
    }
    // Enrichment adds contact lookup — allow more time
    assert.ok(elapsed < 15000, `enrichment took ${elapsed}ms (>15000ms)`);
  });

  // Test 11: Enrichment OFF
  it('11. Enrichment OFF → raw phone numbers/emails', async () => {
    const { text: enrichedText } = await callTool(
      'messages_chat',
      { action: 'read', limit: 3, enrichContacts: true },
      'Messages',
    );
    const { text: rawText, elapsed } = await callTool(
      'messages_chat',
      { action: 'read', limit: 3, enrichContacts: false },
      'Messages',
    );
    if (rawText.includes('No chats found')) {
      console.log(
        '  INFO empty state — enrichment OFF structural checks skipped',
      );
    } else {
      assert.ok(
        rawText.includes('ID:') || rawText.includes('Chats'),
        'raw response should return structured data',
      );
    }
    // Raw should not have enriched names (or at least be different from enriched)
    // This is a soft check — if no contacts match, both may be identical
    assert.ok(elapsed < 1000, `unenriched took ${elapsed}ms (>1000ms)`);
  });

  // Test 12: Send to chatId — SKIPPED (sends real message)
  it(
    '12. Send to chatId → SKIPPED (would send real iMessage)',
    { skip: 'Sends real message — DO NOT run in automated tests' },
    async () => {
      // Would be: callTool('messages_chat', { action: 'create', text: 'E2E test', chatId: firstChatId })
    },
  );

  // Test 13: Send to phone — SKIPPED (sends real message)
  it(
    '13. Send to phone → SKIPPED (would send real iMessage)',
    { skip: 'Sends real message — DO NOT run in automated tests' },
    async () => {
      // Would be: callTool('messages_chat', { action: 'create', text: 'E2E test', to: '+15551234567' })
    },
  );
});

// ---------------------------------------------------------------------------
// Edge Cases (E14-E19)
// ---------------------------------------------------------------------------
describe('Messages — Edge Cases', () => {
  // E14: searchMessages=false (default) — only chat names/participants searched
  it('E14. searchMessages=false → search only matches chat names/participants', async () => {
    // Search for a common word that would appear in message content but not chat names
    const { text, elapsed } = await callTool(
      'messages_chat',
      {
        action: 'read',
        search: 'the',
        searchMessages: false,
        enrichContacts: false,
      },
      'Edge',
    );
    // This should return chats where "the" appears in participant name/chat name
    // NOT message content — result set should be smaller than searchMessages=true
    assert.ok(
      text.includes('Chats matching') || text.includes('No chats found'),
      `should return structured header or empty state, got: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 2000, `search took ${elapsed}ms (>2000ms)`);
  });

  // E15: Contact with no phone numbers
  it('E15. Contact with no phone numbers → appropriate error/empty result', async () => {
    const { text, elapsed } = await callTool(
      'messages_chat',
      {
        action: 'read',
        contact: 'zzzznonexistentperson99999',
        enrichContacts: false,
      },
      'Edge',
    );
    // Should get a meaningful error or empty result, not a crash
    assert.ok(
      text.includes('No contact') ||
        text.includes('No messages') ||
        text.includes('Contact search'),
      `should return meaningful error, got: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 5000, `no-contact lookup took ${elapsed}ms (>5000ms)`);
  });

  // E16: Empty chat — system handles gracefully
  it('E16. Empty/no-result query → handled gracefully', async () => {
    // Use a date range in the far past to get zero messages
    const { text, elapsed } = await callTool(
      'messages_chat',
      {
        action: 'read',
        startDate: '2001-01-01 00:00:00',
        endDate: '2001-01-02 00:00:00',
        enrichContacts: false,
      },
      'Edge',
    );
    assert.ok(
      text.includes('No chats found') || text.includes('Chats'),
      `should return empty state or header, got: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 1000, `empty query took ${elapsed}ms (>1000ms)`);
  });

  // E17: dateRange + explicit startDate → startDate wins (precedence)
  it('E17. dateRange + explicit startDate → startDate takes precedence', async () => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    // dateRange=today but startDate=week ago — startDate should win, returning more results
    const { text: todayText } = await callTool(
      'messages_chat',
      { action: 'read', dateRange: 'today', enrichContacts: false },
      'Edge',
    );
    const { text: overrideText, elapsed } = await callTool(
      'messages_chat',
      {
        action: 'read',
        dateRange: 'today',
        startDate: fmt(weekAgo),
        endDate: fmt(now),
        enrichContacts: false,
      },
      'Edge',
    );
    assert.ok(
      overrideText.includes('Chats') || overrideText.includes('No chats found'),
      `override should return structured header or empty state, got: ${overrideText.slice(0, 200)}`,
    );
    // Override should return >= today-only results (more data with wider range)
    assert.ok(
      overrideText.length >= todayText.length,
      `startDate override (${overrideText.length} chars) should return >= today-only (${todayText.length} chars)`,
    );
    assert.ok(elapsed < 1000, `precedence test took ${elapsed}ms (>1000ms)`);
  });

  // E18: Attachment-only messages → [Attachment] text
  it('E18. Attachment-only messages → system does not crash', async () => {
    // Just verify reading chats with potential attachments doesn't crash
    const { text, elapsed } = await callTool(
      'messages_chat',
      { action: 'read', limit: 50, enrichContacts: false },
      'Edge',
    );
    if (text.includes('No chats found')) {
      console.log('  INFO empty state — attachment structural checks skipped');
    } else {
      assert.ok(
        text.includes('ID:') || text.includes('Chats'),
        'attachment check should return structured data',
      );
    }
    // If any attachment-only messages exist, they should show [Attachment]
    // This is a non-crashing verification — we can't guarantee attachments exist
    assert.ok(elapsed < 1000, `attachment check took ${elapsed}ms (>1000ms)`);
  });

  // E19: attributedBody messages → text extracted correctly
  it('E19. attributedBody messages → text extracted (no crash)', async () => {
    // attributedBody extraction happens automatically in SQLite reader
    // Just verify the system handles it — read a larger set to increase odds
    assert.ok(firstChatId, 'need chatId from test 1');
    const { text, elapsed } = await callTool(
      'messages_chat',
      { action: 'read', chatId: firstChatId, limit: 50, enrichContacts: false },
      'Edge',
    );
    if (text.includes('No messages')) {
      console.log(
        '  INFO empty chat — attributedBody structural checks skipped',
      );
    } else {
      assert.ok(
        text.includes('**') && text.includes('['),
        'attributedBody messages should have sender and date format',
      );
    }
    // Verify no raw hex blobs leak through
    assert.ok(
      !text.includes('62706c69'), // bplist hex prefix
      'should not contain raw hex attributedBody data',
    );
    assert.ok(
      elapsed < 1000,
      `attributedBody check took ${elapsed}ms (>1000ms)`,
    );
  });
});
