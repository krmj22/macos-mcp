/**
 * sqliteContactReader.test.ts
 * Tests for the Contacts SQLite reader: database discovery, fetching, merging, name building.
 *
 * Mocks node:child_process for sqlite3 CLI and node:fs for directory scanning.
 * Follows sqliteMailReader.test.ts patterns.
 */

jest.mock('node:child_process');
jest.mock('node:fs');

import { execFile } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import {
  buildFullName,
  fetchAllContacts,
  findContactDatabases,
  resetDbPathCache,
  SqliteContactAccessError,
} from './sqliteContactReader.js';

const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;
const mockReaddirSync = readdirSync as jest.MockedFunction<typeof readdirSync>;
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

// --- Mock helpers ---

/** Simulate successful sqlite3 -json calls. Takes an array of [emailRows, phoneRows] per call. */
function mockSqliteResponses(responses: [unknown[], unknown[]][]) {
  let callIndex = 0;
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[3] as (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    const pairIndex = Math.floor(callIndex / 2);
    const isPhoneQuery = callIndex % 2 === 1;
    const pair = responses[pairIndex] || [[], []];
    const data = isPhoneQuery ? pair[1] : pair[0];
    callIndex++;
    cb(null, JSON.stringify(data), '');
    return { on: jest.fn() } as any;
  });
}

/** Simulate a sqlite3 error on ALL calls. */
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

/** Mock filesystem to return N source directories, each containing the .abcddb file. */
function mockSourceDirs(dirNames: string[]) {
  mockExistsSync.mockImplementation((p: unknown) => {
    const path = String(p);
    if (path.endsWith('Sources')) return true;
    if (path.endsWith('.abcddb')) return dirNames.some((d) => path.includes(d));
    return false;
  });
  mockReaddirSync.mockReturnValue(
    dirNames.map((name) => ({
      name,
      isDirectory: () => true,
      isFile: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      isSymbolicLink: () => false,
      path: '',
      parentPath: '',
    })) as any,
  );
}

// --- Fixtures ---

function makeEmailRow(overrides: Partial<{
  Z_PK: number;
  ZFIRSTNAME: string | null;
  ZLASTNAME: string | null;
  ZORGANIZATION: string | null;
  ZUNIQUEID: string;
  email: string;
}> = {}) {
  return {
    Z_PK: 1,
    ZFIRSTNAME: 'John',
    ZLASTNAME: 'Doe',
    ZORGANIZATION: null,
    ZUNIQUEID: 'ABC-123',
    email: 'john@example.com',
    ...overrides,
  };
}

function makePhoneRow(overrides: Partial<{
  Z_PK: number;
  ZFIRSTNAME: string | null;
  ZLASTNAME: string | null;
  ZORGANIZATION: string | null;
  ZUNIQUEID: string;
  phone: string;
}> = {}) {
  return {
    Z_PK: 1,
    ZFIRSTNAME: 'John',
    ZLASTNAME: 'Doe',
    ZORGANIZATION: null,
    ZUNIQUEID: 'ABC-123',
    phone: '+15551234567',
    ...overrides,
  };
}

// --- Tests ---

beforeEach(() => {
  jest.clearAllMocks();
  resetDbPathCache();
});

describe('buildFullName', () => {
  it('returns "first last" when both present', () => {
    expect(buildFullName('John', 'Doe', null)).toBe('John Doe');
  });

  it('returns first name only when last is null', () => {
    expect(buildFullName('John', null, null)).toBe('John');
  });

  it('returns last name only when first is null', () => {
    expect(buildFullName(null, 'Doe', null)).toBe('Doe');
  });

  it('falls back to organization when no first/last', () => {
    expect(buildFullName(null, null, 'Acme Corp')).toBe('Acme Corp');
  });

  it('prefers first+last over organization', () => {
    expect(buildFullName('John', 'Doe', 'Acme Corp')).toBe('John Doe');
  });

  it('returns empty string when all null', () => {
    expect(buildFullName(null, null, null)).toBe('');
  });

  it('handles empty strings same as null', () => {
    expect(buildFullName('', '', '')).toBe('');
  });
});

describe('findContactDatabases', () => {
  it('returns paths for valid source directories', () => {
    mockSourceDirs(['source-1', 'source-2']);

    const result = findContactDatabases();

    expect(result).toHaveLength(2);
    expect(result[0]).toContain('source-1');
    expect(result[1]).toContain('source-2');
  });

  it('returns empty array when Sources directory does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = findContactDatabases();

    expect(result).toEqual([]);
  });

  it('skips directories without .abcddb file', () => {
    mockExistsSync.mockImplementation((p: unknown) => {
      const path = String(p);
      if (path.endsWith('Sources')) return true;
      // Only source-1 has the database
      if (path.endsWith('.abcddb')) return path.includes('source-1');
      return false;
    });
    mockReaddirSync.mockReturnValue([
      { name: 'source-1', isDirectory: () => true, isFile: () => false, isBlockDevice: () => false, isCharacterDevice: () => false, isFIFO: () => false, isSocket: () => false, isSymbolicLink: () => false, path: '', parentPath: '' },
      { name: 'source-2', isDirectory: () => true, isFile: () => false, isBlockDevice: () => false, isCharacterDevice: () => false, isFIFO: () => false, isSocket: () => false, isSymbolicLink: () => false, path: '', parentPath: '' },
    ] as any);

    const result = findContactDatabases();

    expect(result).toHaveLength(1);
    expect(result[0]).toContain('source-1');
  });

  it('caches results across calls', () => {
    mockSourceDirs(['source-1']);

    findContactDatabases();
    findContactDatabases();
    findContactDatabases();

    // readdirSync should only be called once
    expect(mockReaddirSync).toHaveBeenCalledTimes(1);
  });

  it('returns fresh results after resetDbPathCache', () => {
    mockSourceDirs(['source-1']);

    findContactDatabases();
    expect(mockReaddirSync).toHaveBeenCalledTimes(1);

    resetDbPathCache();
    mockSourceDirs(['source-1', 'source-2']);

    const result = findContactDatabases();
    expect(result).toHaveLength(2);
    expect(mockReaddirSync).toHaveBeenCalledTimes(2);
  });
});

describe('fetchAllContacts', () => {
  beforeEach(() => {
    mockSourceDirs(['source-1']);
  });

  it('returns contacts with emails and phones merged (no cartesian product)', async () => {
    const emailRows = [
      makeEmailRow({ ZUNIQUEID: 'U1', email: 'john@example.com' }),
      makeEmailRow({ ZUNIQUEID: 'U1', email: 'john@work.com' }),
    ];
    const phoneRows = [
      makePhoneRow({ ZUNIQUEID: 'U1', phone: '+15551111111' }),
      makePhoneRow({ ZUNIQUEID: 'U1', phone: '+15552222222' }),
      makePhoneRow({ ZUNIQUEID: 'U1', phone: '+15553333333' }),
    ];
    mockSqliteResponses([[emailRows, phoneRows]]);

    const contacts = await fetchAllContacts();

    expect(contacts).toHaveLength(1);
    expect(contacts[0].emails).toHaveLength(2);
    expect(contacts[0].phones).toHaveLength(3);
    // NOT 2*3=6 rows — that's the cartesian product we're avoiding
  });

  it('returns contacts with only emails', async () => {
    const emailRows = [makeEmailRow({ ZUNIQUEID: 'U1' })];
    mockSqliteResponses([[emailRows, []]]);

    const contacts = await fetchAllContacts();

    expect(contacts).toHaveLength(1);
    expect(contacts[0].emails).toHaveLength(1);
    expect(contacts[0].phones).toHaveLength(0);
  });

  it('returns contacts with only phones', async () => {
    const phoneRows = [makePhoneRow({ ZUNIQUEID: 'U1' })];
    mockSqliteResponses([[[], phoneRows]]);

    const contacts = await fetchAllContacts();

    expect(contacts).toHaveLength(1);
    expect(contacts[0].phones).toHaveLength(1);
    expect(contacts[0].emails).toHaveLength(0);
  });

  it('merges contacts from multiple source databases', async () => {
    mockSourceDirs(['source-1', 'source-2']);

    const source1Emails = [makeEmailRow({ ZUNIQUEID: 'U1', ZFIRSTNAME: 'Alice', email: 'alice@example.com' })];
    const source1Phones = [makePhoneRow({ ZUNIQUEID: 'U1', ZFIRSTNAME: 'Alice', phone: '+15551111111' })];
    const source2Emails = [makeEmailRow({ ZUNIQUEID: 'U2', ZFIRSTNAME: 'Bob', email: 'bob@example.com' })];
    const source2Phones = [makePhoneRow({ ZUNIQUEID: 'U2', ZFIRSTNAME: 'Bob', phone: '+15552222222' })];

    mockSqliteResponses([
      [source1Emails, source1Phones],
      [source2Emails, source2Phones],
    ]);

    const contacts = await fetchAllContacts();

    expect(contacts).toHaveLength(2);
    const names = contacts.map((c) => c.firstName);
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
  });

  it('deduplicates contacts by ZUNIQUEID across sources', async () => {
    mockSourceDirs(['source-1', 'source-2']);

    // Same contact in both sources
    const emailRows = [makeEmailRow({ ZUNIQUEID: 'U1' })];
    const phoneRows = [makePhoneRow({ ZUNIQUEID: 'U1' })];

    mockSqliteResponses([
      [emailRows, phoneRows],
      [emailRows, phoneRows],
    ]);

    const contacts = await fetchAllContacts();

    expect(contacts).toHaveLength(1);
  });

  it('returns empty array when no source databases exist', async () => {
    mockExistsSync.mockReturnValue(false);
    resetDbPathCache();

    const contacts = await fetchAllContacts();

    expect(contacts).toEqual([]);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('returns empty array when databases return no rows', async () => {
    mockSqliteResponses([[[], []]]);

    const contacts = await fetchAllContacts();

    expect(contacts).toEqual([]);
  });

  it('uses org-only name when no first/last', async () => {
    const emailRows = [
      makeEmailRow({
        ZUNIQUEID: 'U1',
        ZFIRSTNAME: null,
        ZLASTNAME: null,
        ZORGANIZATION: 'Acme Corp',
      }),
    ];
    mockSqliteResponses([[emailRows, []]]);

    const contacts = await fetchAllContacts();

    expect(contacts).toHaveLength(1);
    expect(contacts[0].fullName).toBe('Acme Corp');
    expect(contacts[0].firstName).toBe('');
    expect(contacts[0].lastName).toBe('');
  });

  it('handles partial source failure — returns contacts from successful sources', async () => {
    mockSourceDirs(['source-1', 'source-2']);
    const stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    // source-1 succeeds, source-2 fails
    let callIndex = 0;
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[3] as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      const dbPathArg = (args[1] as string[])[2];
      if (dbPathArg.includes('source-2')) {
        cb(new Error('database disk image is malformed'), '', 'database disk image is malformed');
      } else {
        const isPhone = callIndex % 2 === 1;
        const data = isPhone
          ? [makePhoneRow({ ZUNIQUEID: 'U1' })]
          : [makeEmailRow({ ZUNIQUEID: 'U1' })];
        cb(null, JSON.stringify(data), '');
      }
      callIndex++;
      return { on: jest.fn() } as any;
    });

    const contacts = await fetchAllContacts();

    expect(contacts).toHaveLength(1);
    expect(stderrSpy).toHaveBeenCalled();
    const logged = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(logged.event).toBe('contact_source_failed');
    stderrSpy.mockRestore();
  });

  it('throws SqliteContactAccessError when ALL sources fail', async () => {
    mockSqliteError('authorization denied', 'authorization denied');

    await expect(fetchAllContacts()).rejects.toThrow(SqliteContactAccessError);
    await expect(fetchAllContacts()).rejects.toMatchObject({
      isPermissionError: true,
    });
  });

  it('throws SqliteContactAccessError for generic errors when all fail', async () => {
    resetDbPathCache();
    mockSourceDirs(['source-1']);
    mockSqliteError('database disk image is malformed');

    await expect(fetchAllContacts()).rejects.toThrow(SqliteContactAccessError);
    await expect(fetchAllContacts()).rejects.toMatchObject({
      isPermissionError: false,
    });
  });

  it('handles malformed JSON output gracefully', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[3] as (
        error: Error | null,
        stdout: string,
        stderr: string,
      ) => void;
      cb(null, 'not valid json {{{', '');
      return { on: jest.fn() } as any;
    });

    const contacts = await fetchAllContacts();

    expect(contacts).toEqual([]);
  });

  it('runs email and phone queries in parallel per source', async () => {
    const emailRows = [makeEmailRow()];
    const phoneRows = [makePhoneRow()];
    mockSqliteResponses([[emailRows, phoneRows]]);

    await fetchAllContacts();

    // Two sqlite3 calls for one source (email + phone)
    expect(mockExecFile).toHaveBeenCalledTimes(2);
    // Both should target the same database
    const calls = mockExecFile.mock.calls as unknown[][];
    const db1 = (calls[0][1] as string[])[2];
    const db2 = (calls[1][1] as string[])[2];
    expect(db1).toBe(db2);
  });

  it('queries all sources in parallel', async () => {
    mockSourceDirs(['source-1', 'source-2', 'source-3']);
    mockSqliteResponses([
      [[makeEmailRow({ ZUNIQUEID: 'U1' })], [makePhoneRow({ ZUNIQUEID: 'U1' })]],
      [[makeEmailRow({ ZUNIQUEID: 'U2' })], [makePhoneRow({ ZUNIQUEID: 'U2' })]],
      [[makeEmailRow({ ZUNIQUEID: 'U3' })], [makePhoneRow({ ZUNIQUEID: 'U3' })]],
    ]);

    const contacts = await fetchAllContacts();

    expect(contacts).toHaveLength(3);
    // 3 sources × 2 queries each = 6 sqlite3 calls
    expect(mockExecFile).toHaveBeenCalledTimes(6);
  });

  it('does not include null email values', async () => {
    const emailRows = [makeEmailRow({ ZUNIQUEID: 'U1', email: '' })];
    mockSqliteResponses([[emailRows, []]]);

    const contacts = await fetchAllContacts();

    expect(contacts).toHaveLength(1);
    expect(contacts[0].emails).toHaveLength(0);
  });

  it('does not include null phone values', async () => {
    const phoneRows = [makePhoneRow({ ZUNIQUEID: 'U1', phone: '' })];
    mockSqliteResponses([[[], phoneRows]]);

    const contacts = await fetchAllContacts();

    expect(contacts).toHaveLength(1);
    expect(contacts[0].phones).toHaveLength(0);
  });
});

describe('SqliteContactAccessError', () => {
  it('has correct name', () => {
    const error = new SqliteContactAccessError('test', false);
    expect(error.name).toBe('SqliteContactAccessError');
  });

  it('preserves isPermissionError flag', () => {
    const permError = new SqliteContactAccessError('perm', true);
    expect(permError.isPermissionError).toBe(true);

    const otherError = new SqliteContactAccessError('other', false);
    expect(otherError.isPermissionError).toBe(false);
  });

  it('is an instance of Error', () => {
    const error = new SqliteContactAccessError('test', false);
    expect(error).toBeInstanceOf(Error);
  });
});
