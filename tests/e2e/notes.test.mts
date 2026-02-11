/**
 * E2E tests for Notes tools (notes_items + notes_folders).
 *
 * Tests all 21 cases from Issue #66:
 * - 15 main CRUD/search/folder tests
 * - 6 edge cases (long title, append overflow, empty search, bad ID, markdown, offset beyond)
 *
 * Run: node --import tsx/esm --test tests/e2e/notes.test.mts
 * Requires: pnpm build first.
 *
 * NOTE: Notes JXA operations are inherently slow (property access per item).
 * Thresholds are set generously. #78 tracks search optimization.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

const PREFIX = '[E2E-TEST]';
let client: Client;
let transport: StdioClientTransport;

// Notes JXA is slow — generous thresholds
const TIMEOUT_CREATE = 15000;
const TIMEOUT_READ = 10000;
const TIMEOUT_SEARCH = 30000;
const TIMEOUT_LIST = 35000;
const TIMEOUT_FOLDER_LIST = 30000;

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
  const step = `${name}(${JSON.stringify(args.action)})`;
  console.log(`  ${step} → ${elapsed}ms`);
  if (suite) perfLog.push({ suite, step, ms: elapsed });
  return { text, elapsed };
}

/** Extract ID from success message like: Successfully created note "title".\n- ID: xxx */
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
  client = new Client({ name: 'e2e-notes-test', version: '1.0.0' });
  await client.connect(transport);

  // Warm up Notes.app by doing a simple folder list (triggers app launch)
  console.log('  Warming up Notes.app...');
  const warmStart = performance.now();
  await client.callTool({ name: 'notes_folders', arguments: { action: 'read' } });
  console.log(`  Warmup complete: ${Math.round(performance.now() - warmStart)}ms`);
});

// Track IDs for cleanup
const createdNoteIds: string[] = [];

after(async () => {
  // Clean up all created notes
  for (const id of createdNoteIds) {
    try {
      await client.callTool({
        name: 'notes_items',
        arguments: { action: 'delete', id },
      });
      console.log(`  cleanup: deleted note ${id}`);
    } catch {
      console.log(`  cleanup: failed to delete note ${id} (may already be deleted)`);
    }
  }
  // Note: folders can't be deleted via API — that's OK per CLAUDE.md

  await client.close();

  // Print performance summary
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║              NOTES E2E — PERFORMANCE SUMMARY                    ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
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
  console.log('╚══════════════════════════════════════════════════════════════════╝');
});

// ---------------------------------------------------------------------------
// Main Tests 1-12: Notes CRUD
// ---------------------------------------------------------------------------
describe('Notes CRUD', () => {
  let noteId: string | undefined;
  let noteWithBodyId: string | undefined;
  const uniqueTag = Date.now();
  const title = `${PREFIX} Note ${uniqueTag}`;
  const body = 'E2E test body content for golden path';

  // Test 5: Create minimal (title only)
  it('T5: create minimal (title only)', async () => {
    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'create', title },
      'CRUD',
    );
    assert.ok(text.includes('Successfully created'), `unexpected: ${text.slice(0, 200)}`);
    noteId = extractId(text)!;
    assert.ok(noteId, 'should extract an id');
    createdNoteIds.push(noteId);
    assert.ok(elapsed < TIMEOUT_CREATE, `create took ${elapsed}ms (>${TIMEOUT_CREATE}ms)`);
  });

  // Test 6: Create with body + folder
  it('T6: create with body + folder', async () => {
    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'create', title: `${PREFIX} WithBody ${uniqueTag}`, body, folder: 'Notes' },
      'CRUD',
    );
    assert.ok(text.includes('Successfully created'), `unexpected: ${text.slice(0, 200)}`);
    noteWithBodyId = extractId(text)!;
    assert.ok(noteWithBodyId, 'should extract an id');
    createdNoteIds.push(noteWithBodyId);
    assert.ok(elapsed < TIMEOUT_CREATE, `create took ${elapsed}ms (>${TIMEOUT_CREATE}ms)`);
  });

  // Test 7: Read by ID (full detail with body)
  it('T7: read by ID', async () => {
    assert.ok(noteWithBodyId, 'T6 must pass first (need noteWithBodyId)');
    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'read', id: noteWithBodyId },
      'CRUD',
    );
    assert.ok(text.includes('WithBody'), 'should contain note title');
    assert.ok(text.includes('Content:'), 'should contain body section');
    assert.ok(text.includes(body), 'should contain body text');
    assert.ok(elapsed < TIMEOUT_READ, `read took ${elapsed}ms (>${TIMEOUT_READ}ms)`);
  });

  // Test 8: Update title
  it('T8: update title', async () => {
    assert.ok(noteId, 'T5 must pass first (need noteId)');
    const newTitle = `${PREFIX} Renamed ${uniqueTag}`;
    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'update', id: noteId, title: newTitle },
      'CRUD',
    );
    assert.ok(text.includes('Successfully updated'), `unexpected: ${text.slice(0, 200)}`);
    assert.ok(text.includes('Renamed'), 'response should reflect new title');
    assert.ok(elapsed < TIMEOUT_READ, `update took ${elapsed}ms (>${TIMEOUT_READ}ms)`);
  });

  // Test 9: Replace body
  it('T9: replace body', async () => {
    assert.ok(noteWithBodyId, 'T6 must pass first (need noteWithBodyId)');
    const replacedBody = 'Replaced content for E2E test';
    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'update', id: noteWithBodyId, body: replacedBody },
      'CRUD',
    );
    assert.ok(text.includes('Successfully updated'), `unexpected: ${text.slice(0, 200)}`);
    assert.ok(elapsed < TIMEOUT_READ, `update took ${elapsed}ms (>${TIMEOUT_READ}ms)`);

    // Verify by re-reading
    const { text: readText } = await callTool(
      'notes_items',
      { action: 'read', id: noteWithBodyId },
      'CRUD',
    );
    assert.ok(readText.includes(replacedBody), 'body should be replaced');
  });

  // Test 10: Append to note
  it('T10: append to note', async () => {
    assert.ok(noteWithBodyId, 'T6 must pass first (need noteWithBodyId)');
    const appendText = 'Appended content';
    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'update', id: noteWithBodyId, body: appendText, append: true },
      'CRUD',
    );
    assert.ok(text.includes('Successfully updated'), `unexpected: ${text.slice(0, 200)}`);
    assert.ok(text.includes('appended'), 'should indicate append mode');
    assert.ok(elapsed < TIMEOUT_READ, `append took ${elapsed}ms (>${TIMEOUT_READ}ms)`);

    // Verify combined content
    const { text: readText } = await callTool(
      'notes_items',
      { action: 'read', id: noteWithBodyId },
      'CRUD',
    );
    assert.ok(readText.includes('Appended content'), 'should contain appended text');
  });

  // Test 11: Move to folder
  it('T11: move to folder', async () => {
    assert.ok(noteId, 'T5 must pass first (need noteId)');
    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'update', id: noteId, targetFolder: 'Notes' },
      'CRUD',
    );
    assert.ok(text.includes('Successfully updated'), `unexpected: ${text.slice(0, 200)}`);
    assert.ok(elapsed < TIMEOUT_READ, `move took ${elapsed}ms (>${TIMEOUT_READ}ms)`);

    // Verify folder on re-read
    const { text: readText } = await callTool(
      'notes_items',
      { action: 'read', id: noteId },
      'CRUD',
    );
    assert.ok(readText.includes('Notes'), 'should show target folder');
  });

  // Test 12: Delete note
  it('T12: delete note', async () => {
    assert.ok(noteId, 'T5 must pass first (need noteId)');
    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'delete', id: noteId },
      'CRUD',
    );
    assert.ok(text.includes('Successfully deleted'), `unexpected: ${text.slice(0, 200)}`);
    assert.ok(text.includes('Recently Deleted'), 'should mention Recently Deleted');
    assert.ok(elapsed < TIMEOUT_READ, `delete took ${elapsed}ms (>${TIMEOUT_READ}ms)`);
    // Remove from cleanup list since already deleted
    const idx = createdNoteIds.indexOf(noteId);
    if (idx >= 0) createdNoteIds.splice(idx, 1);
  });
});

// ---------------------------------------------------------------------------
// Main Tests 1-4: Notes Read/Search
// ---------------------------------------------------------------------------
describe('Notes Read + Search', () => {
  // Test 1: Read all notes
  it('T1: read all notes', async () => {
    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'read', limit: 10 },
      'Read',
    );
    assert.ok(text.includes('### Notes'), `should have Notes header, got: ${text.slice(0, 200)}`);
    assert.ok(text.includes('Total:') || text.includes('Showing'), 'should have count');
    assert.ok(elapsed < TIMEOUT_LIST, `read all took ${elapsed}ms (>${TIMEOUT_LIST}ms)`);
  });

  // Test 2: Read with pagination
  it('T2: read with pagination (limit 5)', async () => {
    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'read', limit: 5, offset: 0 },
      'Read',
    );
    // Count items by "- **" pattern
    const itemCount = (text.match(/- \*\*/g) || []).length;
    assert.ok(itemCount <= 5, `expected max 5 items, got ${itemCount}`);
    assert.ok(elapsed < TIMEOUT_LIST, `paginated read took ${elapsed}ms (>${TIMEOUT_LIST}ms)`);
  });

  // Test 3: Filter by folder
  it('T3: filter by folder', async () => {
    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'read', folder: 'Notes', limit: 5 },
      'Read',
    );
    assert.ok(text.includes('Notes'), 'should reference folder');
    if (text.includes('- **')) {
      assert.ok(text.includes('Folder: Notes'), 'items should be in Notes folder');
    }
    assert.ok(elapsed < TIMEOUT_FOLDER_LIST, `folder filter took ${elapsed}ms (>${TIMEOUT_FOLDER_LIST}ms)`);
  });

  // Test 4: Search notes
  it('T4: search notes', async () => {
    // First create a note to search for
    const searchTag = Date.now();
    const { text: createText } = await callTool(
      'notes_items',
      { action: 'create', title: `${PREFIX} Searchable ${searchTag}`, body: 'Unique searchable body' },
      'Read',
    );
    const searchNoteId = extractId(createText)!;
    createdNoteIds.push(searchNoteId);

    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'read', search: `Searchable ${searchTag}` },
      'Read',
    );
    assert.ok(text.includes('Searchable'), 'search should find matching note');
    assert.ok(elapsed < TIMEOUT_SEARCH, `search took ${elapsed}ms (>${TIMEOUT_SEARCH}ms)`);
  });
});

// ---------------------------------------------------------------------------
// Main Tests 13-15: Folders
// ---------------------------------------------------------------------------
describe('Notes Folders', () => {
  // Test 13: Read all folders
  it('T13: read all folders', async () => {
    const { text, elapsed } = await callTool(
      'notes_folders',
      { action: 'read' },
      'Folders',
    );
    assert.ok(text.includes('### Note Folders'), 'should have folders header');
    assert.ok(text.includes('Notes:'), 'should show note counts');
    assert.ok(elapsed < TIMEOUT_FOLDER_LIST, `folder read took ${elapsed}ms (>${TIMEOUT_FOLDER_LIST}ms)`);
  });

  // Test 14: Create folder
  const folderName = `${PREFIX} Folder ${Date.now()}`;
  it('T14: create folder', async () => {
    const { text, elapsed } = await callTool(
      'notes_folders',
      { action: 'create', name: folderName },
      'Folders',
    );
    assert.ok(text.includes('Successfully created folder'), `unexpected: ${text.slice(0, 200)}`);
    assert.ok(elapsed < TIMEOUT_CREATE, `folder create took ${elapsed}ms (>${TIMEOUT_CREATE}ms)`);
  });

  // Test 15: Create note in new folder
  it('T15: create note in new folder', async () => {
    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'create', title: `${PREFIX} In New Folder ${Date.now()}`, folder: folderName },
      'Folders',
    );
    assert.ok(text.includes('Successfully created'), `unexpected: ${text.slice(0, 200)}`);
    const id = extractId(text)!;
    createdNoteIds.push(id);
    assert.ok(elapsed < TIMEOUT_CREATE, `create in folder took ${elapsed}ms (>${TIMEOUT_CREATE}ms)`);

    // Verify it's in the correct folder
    const { text: readText } = await callTool(
      'notes_items',
      { action: 'read', id },
      'Folders',
    );
    assert.ok(readText.includes(folderName), 'note should be in the new folder');
  });
});

// ---------------------------------------------------------------------------
// Edge Cases E16-E21
// ---------------------------------------------------------------------------
describe('Notes Edge Cases', () => {
  // E16: 200-char title
  it('E16: 200-char title', async () => {
    const longTitle = `${PREFIX} ${'A'.repeat(200 - PREFIX.length - 1)}`;
    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'create', title: longTitle },
      'Edge',
    );
    assert.ok(text.includes('Successfully created'), `unexpected: ${text.slice(0, 200)}`);
    const id = extractId(text)!;
    createdNoteIds.push(id);
    assert.ok(elapsed < TIMEOUT_CREATE, `long title create took ${elapsed}ms (>${TIMEOUT_CREATE}ms)`);
  });

  // E17: Append exceeding 2000-char limit
  it('E17: append exceeding 2000-char limit', async () => {
    // Create a note with substantial body
    const { text: createText } = await callTool(
      'notes_items',
      { action: 'create', title: `${PREFIX} Overflow ${Date.now()}`, body: 'X'.repeat(1900) },
      'Edge',
    );
    const id = extractId(createText)!;
    createdNoteIds.push(id);

    // Try to append enough to exceed 2000 chars
    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'update', id, body: 'Y'.repeat(200), append: true },
      'Edge',
    );
    // Should get an error about exceeding char limit
    assert.ok(
      text.includes('exceeds') || text.includes('2000') || text.includes('Error'),
      `expected overflow error, got: ${text.slice(0, 300)}`,
    );
    assert.ok(elapsed < TIMEOUT_READ, `append overflow took ${elapsed}ms (>${TIMEOUT_READ}ms)`);
  });

  // E18: Search no results
  it('E18: search with no results', async () => {
    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'read', search: `nonexistent_${Date.now()}_zzz` },
      'Edge',
    );
    assert.ok(
      text.includes('No notes found') || text.includes('Total: 0'),
      `expected empty state, got: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < TIMEOUT_SEARCH, `empty search took ${elapsed}ms (>${TIMEOUT_SEARCH}ms)`);
  });

  // E19: Nonexistent note ID
  it('E19: nonexistent note ID', async () => {
    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'read', id: 'x-coredata://FAKE-ID-DOES-NOT-EXIST/ICNote/p999999' },
      'Edge',
    );
    assert.ok(
      text.toLowerCase().includes('not found'),
      `expected not found, got: ${text.slice(0, 200)}`,
    );
    assert.ok(elapsed < TIMEOUT_READ, `bad ID read took ${elapsed}ms (>${TIMEOUT_READ}ms)`);
  });

  // E20: Markdown-like content stored as plain text
  it('E20: markdown-like content', async () => {
    const mdBody = '# Heading\n\n- bullet 1\n- bullet 2\n\n**bold** and *italic*';
    const { text: createText } = await callTool(
      'notes_items',
      { action: 'create', title: `${PREFIX} Markdown ${Date.now()}`, body: mdBody },
      'Edge',
    );
    const id = extractId(createText)!;
    createdNoteIds.push(id);

    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'read', id },
      'Edge',
    );
    // Content should be stored (Notes may strip some markdown, but key text should survive)
    assert.ok(text.includes('bullet 1'), 'markdown content should be stored');
    assert.ok(elapsed < TIMEOUT_READ, `markdown read took ${elapsed}ms (>${TIMEOUT_READ}ms)`);
  });

  // E21: Offset beyond total count
  it('E21: offset beyond total count', async () => {
    const { text, elapsed } = await callTool(
      'notes_items',
      { action: 'read', offset: 999999, limit: 10 },
      'Edge',
    );
    // Should return empty results (no items at offset 999999)
    const itemCount = (text.match(/- \*\*/g) || []).length;
    assert.strictEqual(itemCount, 0, `expected 0 items at large offset, got ${itemCount}`);
    assert.ok(elapsed < TIMEOUT_LIST, `large offset read took ${elapsed}ms (>${TIMEOUT_LIST}ms)`);
  });
});
