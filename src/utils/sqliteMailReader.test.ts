/**
 * sqliteMailReader.test.ts
 * Tests for the Mail SQLite reader: pure utility functions + async query functions.
 *
 * Pure exports (mailDateToISO, parseMailboxUrl) are tested directly.
 * Async functions (listInboxMessages, searchMessages, etc.) mock node:child_process
 * to simulate sqlite3 CLI responses without touching the real database.
 */

jest.mock('node:child_process');

import { execFile } from 'node:child_process';
import {
  mailDateToISO,
  parseMailboxUrl,
  listInboxMessages,
  searchMessages,
  searchBySenderEmails,
  getMessageById,
  listMailboxMessages,
  listMailboxes,
  SqliteMailAccessError,
} from './sqliteMailReader.js';

const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;

// --- Mock helpers ---

/** Simulate a successful sqlite3 -json call returning the given rows. */
function mockSqliteSuccess(jsonOutput: unknown[]) {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[3] as (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    cb(null, JSON.stringify(jsonOutput), '');
    return { on: jest.fn() } as any;
  });
}

/** Simulate an empty sqlite3 result (no rows). */
function mockSqliteEmpty() {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[3] as (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    cb(null, '', '');
    return { on: jest.fn() } as any;
  });
}

/** Simulate a sqlite3 error with optional stderr content. */
function mockSqliteError(message: string, stderr = '') {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[3] as (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    const error = new Error(message);
    cb(error, '', stderr || message);
    return { on: jest.fn() } as any;
  });
}

/** Simulate a sqlite3 call that returns malformed (non-JSON) output. */
function mockSqliteMalformed(output: string) {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[3] as (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    cb(null, output, '');
    return { on: jest.fn() } as any;
  });
}

// --- Reusable raw row fixtures ---

function makeRawMailRow(overrides: Partial<{
  ROWID: number;
  subject: string | null;
  address: string | null;
  comment: string | null;
  date_received: number | null;
  read: number;
  mailbox_url: string | null;
  summary: string | null;
}> = {}) {
  return {
    ROWID: 42,
    subject: 'Test Subject',
    address: 'sender@test.com',
    comment: 'Sender Name',
    date_received: 1735689600, // 2025-01-01T00:00:00Z
    read: 1,
    mailbox_url: 'imap://UUID-123/INBOX',
    summary: 'Message preview text',
    ...overrides,
  };
}

function makeRawMailFullRow(overrides: Partial<{
  ROWID: number;
  subject: string | null;
  address: string | null;
  comment: string | null;
  date_received: number | null;
  read: number;
  mailbox_url: string | null;
  summary: string | null;
  to_addresses: string | null;
  cc_addresses: string | null;
}> = {}) {
  return {
    ...makeRawMailRow(overrides),
    to_addresses: 'alice@test.com, bob@test.com',
    cc_addresses: 'charlie@test.com',
    ...overrides,
  };
}

// --- Tests ---

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sqliteMailReader utilities', () => {
  describe('mailDateToISO', () => {
    it('converts Unix seconds timestamp to ISO string', () => {
      const timestamp = 1770825209; // 2026-02-11T15:53:29Z
      const result = mailDateToISO(timestamp);
      expect(result).toBe(new Date(timestamp * 1000).toISOString());
    });

    it('returns empty string for null timestamp', () => {
      expect(mailDateToISO(null)).toBe('');
    });

    it('returns empty string for zero timestamp', () => {
      expect(mailDateToISO(0)).toBe('');
    });

    it('handles a known date correctly', () => {
      // 2025-01-01T00:00:00Z = Unix 1735689600
      const result = mailDateToISO(1735689600);
      expect(result).toBe('2025-01-01T00:00:00.000Z');
    });
  });

  describe('parseMailboxUrl', () => {
    it('parses imap Gmail INBOX URL', () => {
      const result = parseMailboxUrl(
        'imap://B94DE041-CC10-4E67-8B90-44B639F867AF/INBOX',
      );
      expect(result.account).toBe('B94DE041-CC10-4E67-8B90-44B639F867AF');
      expect(result.mailbox).toBe('INBOX');
    });

    it('parses imap Gmail label with URL encoding', () => {
      const result = parseMailboxUrl(
        'imap://B94DE041-CC10-4E67-8B90-44B639F867AF/%5BGmail%5D/All%20Mail',
      );
      expect(result.account).toBe('B94DE041-CC10-4E67-8B90-44B639F867AF');
      expect(result.mailbox).toBe('All Mail');
    });

    it('parses imap Gmail Trash URL', () => {
      const result = parseMailboxUrl(
        'imap://B94DE041-CC10-4E67-8B90-44B639F867AF/%5BGmail%5D/Trash',
      );
      expect(result.mailbox).toBe('Trash');
    });

    it('parses ews Archive URL', () => {
      const result = parseMailboxUrl(
        'ews://F176471C-FDB6-4F65-BEB7-811245ECC68E/Archive',
      );
      expect(result.account).toBe('F176471C-FDB6-4F65-BEB7-811245ECC68E');
      expect(result.mailbox).toBe('Archive');
    });

    it('parses custom folder URL', () => {
      const result = parseMailboxUrl(
        'imap://B94DE041-CC10-4E67-8B90-44B639F867AF/Real%20Estate',
      );
      expect(result.mailbox).toBe('Real Estate');
    });

    it('handles malformed URL gracefully', () => {
      const result = parseMailboxUrl('not-a-url');
      expect(result.mailbox).toBe('not-a-url');
    });

    it('parses Sent Mail URL', () => {
      const result = parseMailboxUrl(
        'imap://B94DE041-CC10-4E67-8B90-44B639F867AF/%5BGmail%5D/Sent%20Mail',
      );
      expect(result.mailbox).toBe('Sent Mail');
    });

    it('parses Deleted Messages URL with spaces', () => {
      const result = parseMailboxUrl(
        'imap://F8971B5F-9A92-4AE9-A3AE-AF49FF6BF74F/Deleted%20Messages',
      );
      expect(result.mailbox).toBe('Deleted Messages');
    });
  });
});

describe('listInboxMessages', () => {
  it('returns mapped messages from SQLite', async () => {
    const row = makeRawMailRow();
    mockSqliteSuccess([row]);

    const results = await listInboxMessages(10, 0);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      id: '42',
      subject: 'Test Subject',
      sender: 'sender@test.com',
      senderName: 'Sender Name',
      dateReceived: '2025-01-01T00:00:00.000Z',
      read: true,
      mailbox: 'INBOX',
      account: 'UUID-123',
      preview: 'Message preview text',
    });
  });

  it('returns empty array when sqlite returns empty string', async () => {
    mockSqliteEmpty();

    const results = await listInboxMessages(10, 0);

    expect(results).toEqual([]);
  });

  it('maps null fields gracefully', async () => {
    const row = makeRawMailRow({
      subject: null,
      address: null,
      comment: null,
      summary: null,
      mailbox_url: null,
    });
    mockSqliteSuccess([row]);

    const results = await listInboxMessages(10, 0);

    expect(results).toHaveLength(1);
    expect(results[0].subject).toBe('(no subject)');
    expect(results[0].sender).toBe('');
    expect(results[0].senderName).toBe('');
    expect(results[0].preview).toBe('');
    expect(results[0].mailbox).toBe('');
    expect(results[0].account).toBe('');
  });

  it('passes limit and offset to the query', async () => {
    mockSqliteSuccess([]);

    await listInboxMessages(25, 50);

    // execFile(binary, ['-json', '-readonly', db, query], opts, cb)
    const sqlQuery = (mockExecFile.mock.calls[0] as unknown[])[1] as string[];
    expect(sqlQuery[3]).toContain('LIMIT 25 OFFSET 50');
  });
});

describe('searchMessages', () => {
  it('returns search results matching term', async () => {
    const row = makeRawMailRow({ subject: 'Invoice #1234' });
    mockSqliteSuccess([row]);

    const results = await searchMessages('Invoice', 10, 0);

    expect(results).toHaveLength(1);
    expect(results[0].subject).toBe('Invoice #1234');
  });

  it('escapes single quotes in search term', async () => {
    mockSqliteSuccess([]);

    await searchMessages("O'Brien", 10, 0);

    const sqlQuery = (mockExecFile.mock.calls[0] as unknown[])[1] as string[];
    // escapeSql turns ' into '' — the query should contain O''Brien
    expect(sqlQuery[3]).toContain("O''Brien");
  });

  it('returns empty array when no matches', async () => {
    mockSqliteEmpty();

    const results = await searchMessages('nonexistent', 10, 0);

    expect(results).toEqual([]);
  });
});

describe('searchBySenderEmails', () => {
  it('returns messages from multiple sender emails', async () => {
    const row1 = makeRawMailRow({ ROWID: 1, address: 'alice@test.com' });
    const row2 = makeRawMailRow({ ROWID: 2, address: 'bob@test.com' });
    mockSqliteSuccess([row1, row2]);

    const results = await searchBySenderEmails(
      ['alice@test.com', 'bob@test.com'],
      10,
    );

    expect(results).toHaveLength(2);
    expect(results[0].sender).toBe('alice@test.com');
    expect(results[1].sender).toBe('bob@test.com');
  });

  it('returns empty array for empty emails array without calling sqlite', async () => {
    const results = await searchBySenderEmails([], 10);

    expect(results).toEqual([]);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('builds OR conditions for each email in the query', async () => {
    mockSqliteSuccess([]);

    await searchBySenderEmails(['a@test.com', 'b@test.com'], 10);

    const sqlQuery = (mockExecFile.mock.calls[0] as unknown[])[1] as string[];
    expect(sqlQuery[3]).toContain("a.address LIKE '%a@test.com%'");
    expect(sqlQuery[3]).toContain("a.address LIKE '%b@test.com%'");
    expect(sqlQuery[3]).toContain(' OR ');
  });
});

describe('getMessageById', () => {
  it('returns full message with to/cc recipients', async () => {
    const row = makeRawMailFullRow();
    mockSqliteSuccess([row]);

    const result = await getMessageById('42');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('42');
    expect(result!.subject).toBe('Test Subject');
    expect(result!.sender).toBe('sender@test.com');
    expect(result!.toRecipients).toEqual(['alice@test.com', 'bob@test.com']);
    expect(result!.ccRecipients).toEqual(['charlie@test.com']);
  });

  it('returns null when no rows found', async () => {
    mockSqliteEmpty();

    const result = await getMessageById('999');

    expect(result).toBeNull();
  });

  it('splits comma-separated recipients correctly', async () => {
    const row = makeRawMailFullRow({
      to_addresses: 'one@test.com, two@test.com, three@test.com',
      cc_addresses: null,
    });
    mockSqliteSuccess([row]);

    const result = await getMessageById('42');

    expect(result!.toRecipients).toEqual([
      'one@test.com',
      'two@test.com',
      'three@test.com',
    ]);
    expect(result!.ccRecipients).toEqual([]);
  });

  it('handles null to_addresses and cc_addresses', async () => {
    const row = makeRawMailFullRow({
      to_addresses: null,
      cc_addresses: null,
    });
    mockSqliteSuccess([row]);

    const result = await getMessageById('42');

    expect(result!.toRecipients).toEqual([]);
    expect(result!.ccRecipients).toEqual([]);
  });
});

describe('listMailboxMessages', () => {
  it('returns messages from specific mailbox URL', async () => {
    const row = makeRawMailRow({
      mailbox_url: 'imap://UUID-123/%5BGmail%5D/All%20Mail',
    });
    mockSqliteSuccess([row]);

    const results = await listMailboxMessages(
      'imap://UUID-123/%5BGmail%5D/All%20Mail',
      10,
      0,
    );

    expect(results).toHaveLength(1);
    expect(results[0].mailbox).toBe('All Mail');
  });

  it('escapes single quotes in mailbox URL', async () => {
    mockSqliteSuccess([]);

    await listMailboxMessages("imap://UUID/Folder'Name", 10, 0);

    const sqlQuery = (mockExecFile.mock.calls[0] as unknown[])[1] as string[];
    expect(sqlQuery[3]).toContain("Folder''Name");
  });

  it('passes limit and offset to the query', async () => {
    mockSqliteSuccess([]);

    await listMailboxMessages('imap://UUID/INBOX', 15, 30);

    const sqlQuery = (mockExecFile.mock.calls[0] as unknown[])[1] as string[];
    expect(sqlQuery[3]).toContain('LIMIT 15 OFFSET 30');
  });
});

describe('listMailboxes', () => {
  it('returns mailbox info with parsed names', async () => {
    mockSqliteSuccess([
      {
        url: 'imap://UUID-ABC/%5BGmail%5D/All%20Mail',
        total_count: 500,
        unread_count: 12,
      },
      {
        url: 'imap://UUID-ABC/INBOX',
        total_count: 200,
        unread_count: 5,
      },
    ]);

    const results = await listMailboxes();

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      name: 'All Mail',
      account: 'UUID-ABC',
      url: 'imap://UUID-ABC/%5BGmail%5D/All%20Mail',
      totalCount: 500,
      unreadCount: 12,
    });
    expect(results[1]).toEqual({
      name: 'INBOX',
      account: 'UUID-ABC',
      url: 'imap://UUID-ABC/INBOX',
      totalCount: 200,
      unreadCount: 5,
    });
  });

  it('returns empty array when no mailboxes have messages', async () => {
    mockSqliteEmpty();

    const results = await listMailboxes();

    expect(results).toEqual([]);
  });
});

describe('error handling (runSqlite)', () => {
  it('throws SqliteMailAccessError with isPermissionError=true for "authorization denied"', async () => {
    mockSqliteError('authorization denied', 'authorization denied');

    await expect(listInboxMessages(10, 0)).rejects.toThrow(
      SqliteMailAccessError,
    );
    await expect(listInboxMessages(10, 0)).rejects.toMatchObject({
      isPermissionError: true,
    });
  });

  it('throws SqliteMailAccessError with isPermissionError=true for "unable to open"', async () => {
    mockSqliteError('unable to open database', 'unable to open database');

    await expect(searchMessages('test', 10, 0)).rejects.toThrow(
      SqliteMailAccessError,
    );
    await expect(searchMessages('test', 10, 0)).rejects.toMatchObject({
      isPermissionError: true,
    });
  });

  it('throws SqliteMailAccessError with isPermissionError=false for generic errors', async () => {
    mockSqliteError('no such table: messages', 'no such table: messages');

    await expect(getMessageById('1')).rejects.toThrow(SqliteMailAccessError);
    await expect(getMessageById('1')).rejects.toMatchObject({
      isPermissionError: false,
    });
  });

  it('uses stderr content for error message when available', async () => {
    mockSqliteError('generic', 'detailed stderr output');

    await expect(listMailboxes()).rejects.toThrow(
      'SQLite error: detailed stderr output',
    );
  });

  it('parseSqliteJson returns empty array for malformed JSON (via public function)', async () => {
    mockSqliteMalformed('not valid json {{{');

    const results = await listInboxMessages(10, 0);

    expect(results).toEqual([]);
  });
});
