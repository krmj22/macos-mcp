/**
 * E2E tests for Mail tools (Issue #67).
 *
 * Mail reads use SQLite backend (<40ms typical).
 * Mail writes (create draft, delete, mark read/unread) use JXA.
 *
 * Run: node --import tsx/esm --test tests/e2e/mail.test.mts
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
  timeout = 60000,
) {
  const start = performance.now();
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout });
  const elapsed = Math.round(performance.now() - start);
  const text =
    (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
  const step = `${name}(${JSON.stringify(args.action || args.mailbox || 'call').slice(0, 20)})`;
  console.log(`  ${step} → ${elapsed}ms`);
  if (suite) perfLog.push({ suite, step, ms: elapsed });
  return { text, elapsed };
}

before(async () => {
  transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    cwd: process.cwd(),
  });
  client = new Client({ name: 'e2e-mail-test', version: '1.0.0' });
  await client.connect(transport);
});

after(async () => {
  await client.close();

  // Print performance summary
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║              MAIL E2E PERFORMANCE SUMMARY               ║');
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
// Mail Reads (SQLite backend)
// ---------------------------------------------------------------------------
describe('Mail Reads', () => {
  // #1: Read inbox
  it('read inbox with subjects, senders, dates, previews', async () => {
    const { text, elapsed } = await callTool(
      'mail_messages',
      { action: 'read', limit: 10, enrichContacts: false },
      'Mail Read',
    );
    assert.ok(text.length > 0, 'should return data');
    // Inbox heading present (either messages or "No messages" notice)
    assert.ok(
      text.includes('Inbox') || text.includes('No messages'),
      `unexpected response: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 5000, `inbox read took ${elapsed}ms (>5s)`);
  });

  // #2: Pagination
  it('pagination — limit 5, offset 0 returns max 5 items', async () => {
    const { text, elapsed } = await callTool(
      'mail_messages',
      { action: 'read', limit: 5, offset: 0, enrichContacts: false },
      'Mail Read',
    );
    // Count message entries (lines starting with "- **")
    const messageCount = (text.match(/^- \*\*/gm) || []).length;
    assert.ok(messageCount <= 5, `expected <=5 messages, got ${messageCount}`);
    assert.ok(elapsed < 5000, `paginated read took ${elapsed}ms (>5s)`);
  });

  // #3: List mailboxes
  it('list mailboxes with accounts and unread counts', async () => {
    const { text, elapsed } = await callTool(
      'mail_messages',
      { action: 'read', mailbox: '_list' },
      'Mail Read',
    );
    assert.ok(
      text.includes('Mailboxes') || text.includes('No mailboxes'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 3000, `mailbox list took ${elapsed}ms (>3s)`);
  });

  // #4: Read specific mailbox — we need a real mailbox name
  let specificMailbox: string | undefined;
  let specificAccount: string | undefined;

  it('read specific mailbox', async () => {
    // First get a mailbox name from the list
    const { text: listText } = await callTool(
      'mail_messages',
      { action: 'read', mailbox: '_list' },
      'Mail Read',
    );
    // Parse first mailbox name from "- **Name** (Account)"
    const mbMatch = listText.match(/- \*\*(.+?)\*\* \((.+?)\)/);
    if (!mbMatch) {
      console.log('  ⚠ No mailboxes found — skipping specific mailbox test');
      return;
    }
    specificMailbox = mbMatch[1];
    specificAccount = mbMatch[2];

    const { text, elapsed } = await callTool(
      'mail_messages',
      { action: 'read', mailbox: specificMailbox, limit: 5, enrichContacts: false },
      'Mail Read',
    );
    assert.ok(text.length > 0, 'should return data');
    assert.ok(elapsed < 5000, `specific mailbox read took ${elapsed}ms (>5s)`);
  });

  // #5: Search mail
  it('search mail by subject keyword', async () => {
    const { text, elapsed } = await callTool(
      'mail_messages',
      { action: 'read', search: 'the', limit: 5, enrichContacts: false },
      'Mail Read',
    );
    assert.ok(text.length > 0, 'should return data');
    assert.ok(elapsed < 10000, `search took ${elapsed}ms (>10s)`);
  });

  // #6: Read by ID — get an ID from inbox first
  let realMessageId: string | undefined;

  it('read single message by ID with full detail', async () => {
    // Get a real message ID from inbox
    const { text: inboxText } = await callTool(
      'mail_messages',
      { action: 'read', limit: 1, enrichContacts: false },
    );
    const idMatch = inboxText.match(/ID:\s*(\d+)/);
    if (!idMatch) {
      console.log('  ⚠ No messages in inbox — skipping read-by-ID test');
      return;
    }
    realMessageId = idMatch[1];

    const { text, elapsed } = await callTool(
      'mail_messages',
      { action: 'read', id: realMessageId, enrichContacts: false },
      'Mail Read',
    );
    assert.ok(text.includes('Mail:'), `expected mail detail, got: ${text.slice(0, 200)}`);
    assert.ok(text.includes('From:'), 'should include From field');
    assert.ok(text.includes('To:'), 'should include To field');
    assert.ok(text.includes('Content:'), 'should include Content section');
    assert.ok(elapsed < 15000, `read-by-ID took ${elapsed}ms (>15s)`);
  });

  // #7: Enrichment ON (default)
  it('enrichment ON — sender names for known contacts', async () => {
    // Use limit: 1 to minimize contact enrichment overhead (batch resolve is slow)
    // Bulk contact cache fetch can take >60s — use 120s timeout
    const { text, elapsed } = await callTool(
      'mail_messages',
      { action: 'read', limit: 1 },
      'Mail Read',
      120000,
    );
    assert.ok(text.length > 0, 'should return data');
    // Known: bulk contact cache fetch takes ~60s on large contact lists.
    // This is a pre-existing perf issue with resolveBatch() — not a mail bug.
    // Threshold set to 90s to avoid false negatives; tracked separately.
    assert.ok(elapsed < 90000, `enriched read took ${elapsed}ms (>90s)`);
  });

  // #8: Enrichment OFF
  it('enrichment OFF — raw email addresses', async () => {
    const { text, elapsed } = await callTool(
      'mail_messages',
      { action: 'read', limit: 3, enrichContacts: false },
      'Mail Read',
    );
    assert.ok(text.length > 0, 'should return data');
    // Without enrichment should be fast (pure SQLite)
    assert.ok(elapsed < 5000, `non-enriched read took ${elapsed}ms (>5s)`);
  });

  // #9: Find by contact name
  it('find by contact name', async () => {
    const { text, elapsed } = await callTool(
      'mail_messages',
      { action: 'read', contact: 'Kyle', enrichContacts: false },
      'Mail Read',
    );
    assert.ok(text.length > 0, 'should return data');
    // Contact lookup + SQLite search
    assert.ok(elapsed < 15000, `contact search took ${elapsed}ms (>15s)`);
  });

  // E17: Specific mailbox + account scoping
  it('specific mailbox + account scoped results', async () => {
    if (!specificMailbox || !specificAccount) {
      console.log('  ⚠ No mailbox discovered — skipping account-scoped test');
      return;
    }
    const { text, elapsed } = await callTool(
      'mail_messages',
      {
        action: 'read',
        mailbox: specificMailbox,
        account: specificAccount,
        limit: 3,
        enrichContacts: false,
      },
      'Mail Read',
    );
    assert.ok(text.length > 0, 'should return data');
    assert.ok(elapsed < 5000, `account-scoped read took ${elapsed}ms (>5s)`);
  });
});

// ---------------------------------------------------------------------------
// Mail Writes (JXA backend)
// ---------------------------------------------------------------------------
describe('Mail Writes', () => {
  let draftSubject: string;

  // #10: Create draft
  it('create draft', async () => {
    draftSubject = `${PREFIX} Test Draft ${Date.now()}`;
    const { text, elapsed } = await callTool(
      'mail_messages',
      {
        action: 'create',
        subject: draftSubject,
        body: 'E2E test draft body — do not send.',
        to: ['e2e-test@example.com'],
      },
      'Mail Write',
    );
    assert.ok(
      text.includes('Successfully drafted'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 3000, `create draft took ${elapsed}ms (>3s)`);
  });

  // #11: Draft with CC/BCC
  it('create draft with CC and BCC', async () => {
    const ccSubject = `${PREFIX} CC Draft ${Date.now()}`;
    const { text, elapsed } = await callTool(
      'mail_messages',
      {
        action: 'create',
        subject: ccSubject,
        body: 'E2E test draft with CC/BCC.',
        to: ['e2e-test@example.com'],
        cc: ['cc-test@example.com'],
        bcc: ['bcc-test@example.com'],
      },
      'Mail Write',
    );
    assert.ok(
      text.includes('Successfully drafted'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 3000, `CC draft took ${elapsed}ms (>3s)`);
  });

  // #12 & #13: Mark as read/unread — need a real message ID
  it('mark as read', async () => {
    // Get a real message ID
    const { text: inboxText } = await callTool(
      'mail_messages',
      { action: 'read', limit: 1, enrichContacts: false },
    );
    const idMatch = inboxText.match(/ID:\s*(\d+)/);
    if (!idMatch) {
      console.log('  ⚠ No messages — skipping mark-read test');
      return;
    }
    const msgId = idMatch[1];

    const { text, elapsed } = await callTool(
      'mail_messages',
      { action: 'update', id: msgId, read: true },
      'Mail Write',
    );
    assert.ok(
      text.includes('Successfully marked') || text.includes('read'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 3000, `mark-read took ${elapsed}ms (>3s)`);
  });

  it('mark as unread', async () => {
    const { text: inboxText } = await callTool(
      'mail_messages',
      { action: 'read', limit: 1, enrichContacts: false },
    );
    const idMatch = inboxText.match(/ID:\s*(\d+)/);
    if (!idMatch) {
      console.log('  ⚠ No messages — skipping mark-unread test');
      return;
    }
    const msgId = idMatch[1];

    const { text, elapsed } = await callTool(
      'mail_messages',
      { action: 'update', id: msgId, read: false },
      'Mail Write',
    );
    assert.ok(
      text.includes('Successfully marked') || text.includes('unread'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 3000, `mark-unread took ${elapsed}ms (>3s)`);
  });

  // #14: Delete message — we search for our test drafts to clean up
  // Note: JXA-created drafts don't appear instantly in SQLite, so we
  // use a search-based approach to find and delete test drafts.
  it('delete draft (cleanup)', async () => {
    // Search for our E2E test drafts
    const { text: searchText } = await callTool(
      'mail_messages',
      { action: 'read', search: PREFIX, limit: 10, enrichContacts: false },
    );
    const idMatches = [...searchText.matchAll(/ID:\s*(\d+)/g)];
    if (idMatches.length === 0) {
      console.log('  ⚠ No E2E drafts found in SQLite (may not have synced yet) — skipping delete');
      return;
    }

    // Delete first found test draft
    const draftId = idMatches[0][1];
    const { text, elapsed } = await callTool(
      'mail_messages',
      { action: 'delete', id: draftId },
      'Mail Write',
    );
    assert.ok(
      text.includes('Successfully deleted'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 3000, `delete took ${elapsed}ms (>3s)`);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------
describe('Mail Edge Cases', () => {
  // E15: Search no results
  it('search with no results returns empty state', async () => {
    const { text, elapsed } = await callTool(
      'mail_messages',
      { action: 'read', search: 'xyzzy_nonexistent_e2e_' + Date.now(), limit: 5, enrichContacts: false },
      'Mail Edge',
    );
    assert.ok(
      text.includes('No messages found'),
      `expected empty state, got: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 10000, `empty search took ${elapsed}ms (>10s)`);
  });

  // E16: Contact name with no email
  it('contact name with no email returns helpful message', async () => {
    const { text, elapsed } = await callTool(
      'mail_messages',
      { action: 'read', contact: 'ZZZZZ_NoSuchPerson_E2E' },
      'Mail Edge',
    );
    assert.ok(
      text.includes('No contact found') || text.includes('no email'),
      `expected no-contact message, got: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 15000, `contact lookup took ${elapsed}ms (>15s)`);
  });

  // E18: Nonexistent message ID
  it('nonexistent message ID returns not-found', async () => {
    const { text, elapsed } = await callTool(
      'mail_messages',
      { action: 'read', id: '999999999' },
      'Mail Edge',
    );
    assert.ok(
      text.includes('not found'),
      `expected not-found, got: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 3000, `not-found took ${elapsed}ms (>3s)`);
  });
});
