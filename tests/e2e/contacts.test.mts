/**
 * E2E tests for contacts_people tool — full CRUD + edge cases.
 *
 * Run: node --import tsx/esm --test tests/e2e/contacts.test.mts
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

function extractId(text: string): string | undefined {
  const match = text.match(/ID:\s*(.+)/);
  return match?.[1]?.trim();
}

/** Track created contact IDs for cleanup. */
const createdIds: string[] = [];

before(async () => {
  transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    cwd: process.cwd(),
  });
  client = new Client({ name: 'e2e-contacts', version: '1.0.0' });
  await client.connect(transport);
});

after(async () => {
  // Clean up all created contacts
  for (const id of createdIds) {
    try {
      await client.callTool({
        name: 'contacts_people',
        arguments: { action: 'delete', id },
      });
      console.log(`  cleanup: deleted ${id}`);
    } catch {
      console.log(`  cleanup: failed to delete ${id} (may already be gone)`);
    }
  }

  await client.close();

  // Print performance summary
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║              CONTACTS PERFORMANCE SUMMARY               ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
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
  console.log('╚══════════════════════════════════════════════════════════╝');
});

// ---------------------------------------------------------------------------
// Main tests (1-10)
// ---------------------------------------------------------------------------
describe('Contacts CRUD', () => {
  let minimalId: string;
  let fullId: string;
  const ts = Date.now();

  // 1. Read paginated
  it('1. read paginated (limit: 10)', async () => {
    const { text, elapsed } = await callTool(
      'contacts_people',
      { action: 'read', limit: 10 },
      'Main',
    );
    assert.ok(text.length > 0, 'should return contact data');
    // First read is slow due to JXA cache warmup (known — see MEMORY.md)
    assert.ok(elapsed < 35000, `read took ${elapsed}ms (>35s)`);
  });

  // 2. Read by ID — we'll use a created contact for this (tested after #6)

  // 3. Search by name
  it('3. search by name', async () => {
    const { text, elapsed } = await callTool(
      'contacts_people',
      { action: 'search', search: 'Kyle' },
      'Main',
    );
    assert.ok(text.length > 0, 'should return search results');
    // JXA whose() search can be slow on large contact DBs (known)
    assert.ok(elapsed < 15000, `search took ${elapsed}ms (>15s)`);
  });

  // 4. Search partial name
  it('4. search partial name', async () => {
    const { text, elapsed } = await callTool(
      'contacts_people',
      { action: 'search', search: 'Ky' },
      'Main',
    );
    assert.ok(text.length > 0, 'partial search should return results');
    assert.ok(elapsed < 15000, `search took ${elapsed}ms (>15s)`);
  });

  // 5. Create minimal
  it('5. create minimal contact', async () => {
    const { text, elapsed } = await callTool(
      'contacts_people',
      {
        action: 'create',
        firstName: `${PREFIX} E2ETestMin`,
        lastName: `Contact${ts}`,
      },
      'Main',
    );
    assert.ok(
      text.includes('Successfully created') || text.includes('created'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    minimalId = extractId(text)!;
    assert.ok(minimalId, 'should extract ID');
    createdIds.push(minimalId);
    assert.ok(elapsed < 3000, `create took ${elapsed}ms (>3s)`);
  });

  // 6. Create full contact
  it('6. create full contact', async () => {
    const { text, elapsed } = await callTool(
      'contacts_people',
      {
        action: 'create',
        firstName: `${PREFIX} E2ETestFull`,
        lastName: `Person${ts}`,
        email: `e2etest${ts}@example.com`,
        phone: '555-0199',
        organization: 'E2ETestCorp',
        jobTitle: 'QA Engineer',
        street: '123 Test St',
        city: 'Testville',
        state: 'CA',
        zip: '90210',
        country: 'US',
        note: 'E2E test contact — safe to delete',
      },
      'Main',
    );
    assert.ok(
      text.includes('Successfully created') || text.includes('created'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    fullId = extractId(text)!;
    assert.ok(fullId, 'should extract ID');
    createdIds.push(fullId);
    assert.ok(elapsed < 3000, `create took ${elapsed}ms (>3s)`);
  });

  // 2 & 7. Read created contact by ID — verifies all fields persisted
  it('2/7. read by ID (full contact)', async () => {
    const { text, elapsed } = await callTool(
      'contacts_people',
      { action: 'read', id: fullId },
      'Main',
    );
    assert.ok(text.includes('E2ETestFull'), 'should contain first name');
    assert.ok(text.includes(`Person${ts}`), 'should contain last name');
    assert.ok(text.includes('E2ETestCorp'), 'should contain organization');
    assert.ok(text.includes('QA Engineer'), 'should contain job title');
    assert.ok(
      text.includes('e2etest') && text.includes('@example.com'),
      'should contain email',
    );
    assert.ok(text.includes('555-0199'), 'should contain phone');
    assert.ok(text.includes('123 Test St'), 'should contain street');
    assert.ok(text.includes('E2E test contact'), 'should contain note');
    assert.ok(elapsed < 3000, `read took ${elapsed}ms (>3s)`);
  });

  // 8. Update contact
  it('8. update contact', async () => {
    const { text, elapsed } = await callTool(
      'contacts_people',
      {
        action: 'update',
        id: fullId,
        firstName: `${PREFIX} E2ETestUpdated`,
        organization: 'UpdatedCorp',
      },
      'Main',
    );
    assert.ok(
      text.includes('Successfully updated') || text.includes('updated'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 3000, `update took ${elapsed}ms (>3s)`);

    // Verify update persisted
    const { text: readText } = await callTool(
      'contacts_people',
      { action: 'read', id: fullId },
      'Main',
    );
    assert.ok(
      readText.includes('E2ETestUpdated'),
      'updated name should persist',
    );
    assert.ok(readText.includes('UpdatedCorp'), 'updated org should persist');
  });

  // 10. Search finds created contact
  it('10. search finds created contact', async () => {
    const { text, elapsed } = await callTool(
      'contacts_people',
      { action: 'search', search: 'E2ETest' },
      'Main',
    );
    assert.ok(text.includes('E2ETest'), 'search should find created contacts');
    assert.ok(elapsed < 5000, `search took ${elapsed}ms (>5s)`);
  });

  // 9. Delete contact
  it('9. delete contact (minimal)', async () => {
    const { text, elapsed } = await callTool(
      'contacts_people',
      { action: 'delete', id: minimalId },
      'Main',
    );
    assert.ok(
      text.includes('Successfully deleted') || text.includes('deleted'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 3000, `delete took ${elapsed}ms (>3s)`);
    // Remove from cleanup list
    const idx = createdIds.indexOf(minimalId);
    if (idx !== -1) createdIds.splice(idx, 1);

    // Verify not found on re-read
    const { text: readText } = await callTool(
      'contacts_people',
      { action: 'read', id: minimalId },
      'Main',
    );
    assert.ok(
      readText.includes('not found') ||
        readText.includes('No contact') ||
        !readText.includes('E2ETestMin'),
      'deleted contact should not be found',
    );
  });
});

// ---------------------------------------------------------------------------
// Edge cases (E11-E15)
// ---------------------------------------------------------------------------
describe('Contacts Edge Cases', () => {
  const ts = Date.now();

  // E11. Name-only contact (no email/phone)
  it('E11. name-only contact (no email/phone)', async () => {
    const { text, elapsed } = await callTool(
      'contacts_people',
      {
        action: 'create',
        firstName: `${PREFIX} E2ETestNameOnly`,
        lastName: `Solo${ts}`,
      },
      'Edge',
    );
    assert.ok(
      text.includes('Successfully created') || text.includes('created'),
      `unexpected: ${text.slice(0, 200)}`,
    );
    const id = extractId(text)!;
    assert.ok(id, 'should get ID for name-only contact');
    createdIds.push(id);
    assert.ok(elapsed < 3000, `create took ${elapsed}ms (>3s)`);
  });

  // E12. Search no results
  it('E12. search no results', async () => {
    const { text, elapsed } = await callTool(
      'contacts_people',
      { action: 'search', search: `zzzNoMatchXYZ${ts}` },
      'Edge',
    );
    assert.ok(
      text.toLowerCase().includes('no contacts found') ||
        text.toLowerCase().includes('no results') ||
        text.toLowerCase().includes('no matching'),
      `expected no-results message, got: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 5000, `search took ${elapsed}ms (>5s)`);
  });

  // E13. Offset beyond total
  it('E13. offset beyond total', async () => {
    const { text, elapsed } = await callTool(
      'contacts_people',
      { action: 'read', limit: 10, offset: 999999 },
      'Edge',
    );
    // Should return empty or "no contacts" — not an error
    assert.ok(
      text.length > 0,
      'should return a response (even if empty results)',
    );
    assert.ok(elapsed < 3000, `read took ${elapsed}ms (>3s)`);
  });

  // E14. Special characters in name
  it('E14. special characters in name', async () => {
    const { text: createText, elapsed: createElapsed } = await callTool(
      'contacts_people',
      {
        action: 'create',
        firstName: `${PREFIX} E2ETest O'Brien`,
        lastName: `Müller-${ts}`,
      },
      'Edge',
    );
    assert.ok(
      createText.includes('Successfully created') ||
        createText.includes('created'),
      `unexpected: ${createText.slice(0, 200)}`,
    );
    const id = extractId(createText)!;
    assert.ok(id, 'should get ID for special-char contact');
    createdIds.push(id);
    assert.ok(createElapsed < 3000, `create took ${createElapsed}ms (>3s)`);

    // Read back and verify
    const { text: readText } = await callTool(
      'contacts_people',
      { action: 'read', id },
      'Edge',
    );
    assert.ok(
      readText.includes("O'Brien") ||
        readText.includes('O&#39;Brien') ||
        readText.includes("O\\'Brien"),
      `should contain apostrophe name, got: ${readText.slice(0, 300)}`,
    );
    assert.ok(
      readText.includes('Müller') || readText.includes('M\\u00fcller'),
      `should contain umlaut name, got: ${readText.slice(0, 300)}`,
    );
  });

  // E15. Nonexistent contact ID
  it('E15. nonexistent contact ID', async () => {
    const { text, elapsed } = await callTool(
      'contacts_people',
      { action: 'read', id: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE' },
      'Edge',
    );
    assert.ok(
      text.toLowerCase().includes('not found') ||
        text.toLowerCase().includes('no contact') ||
        text.toLowerCase().includes('error'),
      `expected not-found message, got: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < 3000, `read took ${elapsed}ms (>3s)`);
  });
});
