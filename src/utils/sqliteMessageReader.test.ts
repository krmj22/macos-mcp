/**
 * sqliteMessageReader.test.ts
 * Tests for date filtering and reader functions in SQLite message queries
 */

import { execFile } from 'node:child_process';
import {
  buildDateFilter,
  type DateRange,
  dateToAppleTimestamp,
  listChats,
  readChatMessages,
  readMessagesByHandles,
  searchMessages,
  SqliteAccessError,
} from './sqliteMessageReader.js';

jest.mock('node:child_process');

// biome-ignore lint: simplified mock type for test helpers
const mockExecFile = execFile as any as jest.Mock;

// Apple epoch: 2001-01-01T00:00:00Z
const APPLE_EPOCH_MS = new Date('2001-01-01T00:00:00Z').getTime();

describe('sqliteMessageReader date utilities', () => {
  describe('dateToAppleTimestamp', () => {
    it('converts ISO 8601 date string to Apple timestamp', () => {
      const result = dateToAppleTimestamp('2025-01-15T00:00:00Z');
      expect(result).not.toBeNull();
      // Verify: (unix ms - apple epoch ms) * 1_000_000
      const expectedMs = new Date('2025-01-15T00:00:00Z').getTime();
      const expected = (expectedMs - APPLE_EPOCH_MS) * 1_000_000;
      expect(result).toBe(expected);
    });

    it('converts YYYY-MM-DD format', () => {
      const result = dateToAppleTimestamp('2025-06-01');
      expect(result).not.toBeNull();
      // YYYY-MM-DD is treated as UTC midnight by Date constructor
      const expectedMs = new Date('2025-06-01').getTime();
      const expected = (expectedMs - APPLE_EPOCH_MS) * 1_000_000;
      expect(result).toBe(expected);
    });

    it('converts YYYY-MM-DD HH:mm:ss format', () => {
      const result = dateToAppleTimestamp('2025-03-15 14:30:00');
      expect(result).not.toBeNull();
      // Space-separated format is handled by replacing space with T
      const expectedMs = new Date('2025-03-15T14:30:00').getTime();
      const expected = (expectedMs - APPLE_EPOCH_MS) * 1_000_000;
      expect(result).toBe(expected);
    });

    it('converts ISO 8601 with timezone offset', () => {
      const result = dateToAppleTimestamp('2025-01-15T10:00:00-05:00');
      expect(result).not.toBeNull();
      const expectedMs = new Date('2025-01-15T10:00:00-05:00').getTime();
      const expected = (expectedMs - APPLE_EPOCH_MS) * 1_000_000;
      expect(result).toBe(expected);
    });

    it('returns null for invalid date string', () => {
      expect(dateToAppleTimestamp('not-a-date')).toBeNull();
    });

    it('returns null for completely garbage input', () => {
      expect(dateToAppleTimestamp('hello world')).toBeNull();
    });

    it('produces positive timestamps for dates after 2001', () => {
      const result = dateToAppleTimestamp('2025-01-01T00:00:00Z');
      expect(result).not.toBeNull();
      // biome-ignore lint/style/noNonNullAssertion: test assertion after null check
      expect(result!).toBeGreaterThan(0);
    });

    it('produces zero for Apple epoch itself', () => {
      const result = dateToAppleTimestamp('2001-01-01T00:00:00Z');
      expect(result).toBe(0);
    });
  });

  describe('buildDateFilter', () => {
    it('returns empty string when no date range provided', () => {
      expect(buildDateFilter(undefined)).toBe('');
    });

    it('returns empty string for empty date range', () => {
      const dateRange: DateRange = {};
      expect(buildDateFilter(dateRange)).toBe('');
    });

    it('builds startDate-only filter', () => {
      const dateRange: DateRange = { startDate: '2025-01-01T00:00:00Z' };
      const result = buildDateFilter(dateRange);
      expect(result).toContain('AND m.date >=');
      expect(result).not.toContain('AND m.date <=');
      // Verify it contains a numeric timestamp (not a string)
      const match = result.match(/m\.date >= (\d+)/);
      expect(match).not.toBeNull();
      expect(Number(match?.[1])).toBeGreaterThan(0);
    });

    it('builds endDate-only filter', () => {
      const dateRange: DateRange = { endDate: '2025-12-31T23:59:59Z' };
      const result = buildDateFilter(dateRange);
      expect(result).not.toContain('AND m.date >=');
      expect(result).toContain('AND m.date <=');
    });

    it('builds filter with both startDate and endDate', () => {
      const dateRange: DateRange = {
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-01-31T23:59:59Z',
      };
      const result = buildDateFilter(dateRange);
      expect(result).toContain('AND m.date >=');
      expect(result).toContain('AND m.date <=');

      // Extract both timestamps
      const startMatch = result.match(/m\.date >= (\d+)/);
      const endMatch = result.match(/m\.date <= (\d+)/);
      expect(startMatch).not.toBeNull();
      expect(endMatch).not.toBeNull();
      // End timestamp should be greater than start
      expect(Number(endMatch?.[1])).toBeGreaterThan(Number(startMatch?.[1]));
    });

    it('uses custom message alias', () => {
      const dateRange: DateRange = { startDate: '2025-01-01T00:00:00Z' };
      const result = buildDateFilter(dateRange, 'msg');
      expect(result).toContain('msg.date >=');
    });

    it('ignores invalid startDate', () => {
      const dateRange: DateRange = { startDate: 'garbage' };
      expect(buildDateFilter(dateRange)).toBe('');
    });

    it('ignores invalid endDate', () => {
      const dateRange: DateRange = { endDate: 'not-valid' };
      expect(buildDateFilter(dateRange)).toBe('');
    });

    it('builds only valid portion when one date is invalid', () => {
      const dateRange: DateRange = {
        startDate: '2025-01-01T00:00:00Z',
        endDate: 'invalid',
      };
      const result = buildDateFilter(dateRange);
      expect(result).toContain('AND m.date >=');
      expect(result).not.toContain('AND m.date <=');
    });

    it('produces SQL-safe output (no injection via numeric timestamps)', () => {
      const dateRange: DateRange = {
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      };
      const result = buildDateFilter(dateRange);
      // Should only contain "AND m.date >= <number>" and "AND m.date <= <number>"
      // No quotes, no string interpolation
      expect(result).not.toContain("'");
      expect(result).not.toContain('"');
      expect(result).toMatch(/AND m\.date >= \d+ AND m\.date <= \d+/);
    });
  });

  describe('dateToAppleTimestamp boundary conditions', () => {
    it('handles far-future dates (year 3000)', () => {
      const result = dateToAppleTimestamp('3000-01-01T00:00:00Z');
      expect(result).not.toBeNull();
      // biome-ignore lint/style/noNonNullAssertion: test assertion after null check
      expect(result!).toBeGreaterThan(0);
    });

    it('handles dates near Unix epoch (1970)', () => {
      const result = dateToAppleTimestamp('1970-01-01T00:00:00Z');
      expect(result).not.toBeNull();
      // Before Apple epoch (2001), so should be negative
      // biome-ignore lint/style/noNonNullAssertion: test assertion after null check
      expect(result!).toBeLessThan(0);
    });
  });

  describe('dateToAppleTimestamp edge cases', () => {
    it('produces negative timestamp for dates before 2001', () => {
      const result = dateToAppleTimestamp('2000-01-01T00:00:00Z');
      expect(result).not.toBeNull();
      // biome-ignore lint/style/noNonNullAssertion: test assertion after null check
      expect(result!).toBeLessThan(0);
    });

    it('returns null for empty string', () => {
      expect(dateToAppleTimestamp('')).toBeNull();
    });

    it('handles date-only format (no time) correctly', () => {
      const result = dateToAppleTimestamp('2025-06-15');
      expect(result).not.toBeNull();
      // Should produce same result as explicit midnight UTC
      const explicit = dateToAppleTimestamp('2025-06-15T00:00:00Z');
      // Note: YYYY-MM-DD is treated as UTC by JS Date, so these should match
      expect(result).toBe(explicit);
    });

    it('handles timestamps at millisecond precision', () => {
      const result = dateToAppleTimestamp('2025-01-15T12:30:45.123Z');
      expect(result).not.toBeNull();
      const expectedMs = new Date('2025-01-15T12:30:45.123Z').getTime();
      const expected = (expectedMs - APPLE_EPOCH_MS) * 1_000_000;
      expect(result).toBe(expected);
    });
  });

  describe('buildDateFilter edge cases', () => {
    it('handles dateRange with only undefined values', () => {
      const dateRange: DateRange = {
        startDate: undefined,
        endDate: undefined,
      };
      expect(buildDateFilter(dateRange)).toBe('');
    });

    it('returns correct SQL for very old dates', () => {
      const dateRange: DateRange = { startDate: '1990-01-01T00:00:00Z' };
      const result = buildDateFilter(dateRange);
      expect(result).toContain('AND m.date >=');
      // Should contain a negative timestamp
      expect(result).toMatch(/m\.date >= -\d+/);
    });

    it('handles default alias (m) explicitly', () => {
      const dateRange: DateRange = { startDate: '2025-01-01T00:00:00Z' };
      const result = buildDateFilter(dateRange, 'm');
      expect(result).toContain('m.date >=');
    });
  });
});

describe('sqliteMessageReader reader functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockSqliteSuccess(output: string) {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, output, '');
      },
    );
  }

  function mockSqliteError(message: string, stderr = '') {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(new Error(message), '', stderr);
      },
    );
  }

  describe('listChats', () => {
    it('returns parsed chat list', async () => {
      mockSqliteSuccess(
        JSON.stringify([
          {
            chat_guid: 'iMessage;-;+1234',
            display_name: 'John',
            participants: '+1234',
            last_message: 'Hi',
            last_message_attr_hex: null,
            last_message_attach_count: 0,
            last_date: 757382400000000000, // some Apple timestamp
          },
        ]),
      );

      const result = await listChats(10, 0);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('iMessage;-;+1234');
      expect(result[0].name).toBe('John');
      expect(result[0].lastMessage).toBe('Hi');
    });

    it('returns empty array for empty output', async () => {
      mockSqliteSuccess('');
      const result = await listChats(10, 0);
      expect(result).toEqual([]);
    });

    it('throws SqliteAccessError on permission error', async () => {
      mockSqliteError('unable to open database', 'unable to open database file');
      await expect(listChats(10, 0)).rejects.toThrow(SqliteAccessError);
      try {
        await listChats(10, 0);
      } catch (err) {
        expect((err as InstanceType<typeof SqliteAccessError>).isPermissionError).toBe(true);
      }
    });

    it('throws SqliteAccessError on non-permission error', async () => {
      mockSqliteError('database is locked', 'database is locked');
      await expect(listChats(10, 0)).rejects.toThrow(SqliteAccessError);
      try {
        await listChats(10, 0);
      } catch (err) {
        expect((err as InstanceType<typeof SqliteAccessError>).isPermissionError).toBe(false);
      }
    });

    it('handles chat with no display name (uses participants)', async () => {
      mockSqliteSuccess(
        JSON.stringify([
          {
            chat_guid: 'iMessage;-;+5551234567',
            display_name: '',
            participants: '+5551234567',
            last_message: 'Hello',
            last_message_attr_hex: null,
            last_message_attach_count: 0,
            last_date: 757382400000000000,
          },
        ]),
      );

      const result = await listChats(10, 0);
      expect(result[0].name).toBe('+5551234567');
    });

    it('handles chat with no participants and no display name', async () => {
      mockSqliteSuccess(
        JSON.stringify([
          {
            chat_guid: 'iMessage;-;+999',
            display_name: '',
            participants: null,
            last_message: null,
            last_message_attr_hex: null,
            last_message_attach_count: null,
            last_date: 757382400000000000,
          },
        ]),
      );

      const result = await listChats(10, 0);
      expect(result[0].name).toBe('iMessage;-;+999');
      expect(result[0].participants).toEqual([]);
    });
  });

  describe('SqliteAccessError', () => {
    it('distinguishes permission vs non-permission errors', () => {
      const permErr = new SqliteAccessError('unable to open database', true);
      expect(permErr.isPermissionError).toBe(true);
      expect(permErr.name).toBe('SqliteAccessError');

      const otherErr = new SqliteAccessError('database is locked', false);
      expect(otherErr.isPermissionError).toBe(false);
    });

    it('is instanceof Error', () => {
      const err = new SqliteAccessError('test', false);
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('readChatMessages', () => {
    it('returns parsed messages', async () => {
      mockSqliteSuccess(
        JSON.stringify([
          {
            ROWID: 1,
            text: 'Hello',
            is_from_me: 0,
            handle_id: '+1234',
            date: 757382400000000000,
            attributedBody_hex: null,
            attachment_count: 0,
          },
        ]),
      );

      const result = await readChatMessages('chat1', 10, 0);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('Hello');
      expect(result[0].sender).toBe('+1234');
      expect(result[0].isFromMe).toBe(false);
    });

    it('returns empty array for empty result', async () => {
      mockSqliteSuccess('');
      const result = await readChatMessages('chat1', 10, 0);
      expect(result).toEqual([]);
    });

    it('handles malformed JSON output gracefully', async () => {
      mockSqliteSuccess('not valid json');
      const result = await readChatMessages('chat1', 10, 0);
      expect(result).toEqual([]);
    });

    it('marks sender as "me" for outgoing messages', async () => {
      mockSqliteSuccess(
        JSON.stringify([
          {
            ROWID: 1,
            text: 'Sent',
            is_from_me: 1,
            handle_id: '',
            date: 757382400000000000,
            attributedBody_hex: null,
            attachment_count: 0,
          },
        ]),
      );

      const result = await readChatMessages('chat1', 10, 0);
      expect(result[0].sender).toBe('me');
      expect(result[0].isFromMe).toBe(true);
    });

    it('shows [Attachment] for attachment-only messages', async () => {
      mockSqliteSuccess(
        JSON.stringify([
          {
            ROWID: 1,
            text: null,
            is_from_me: 0,
            handle_id: '+1234',
            date: 757382400000000000,
            attributedBody_hex: null,
            attachment_count: 1,
          },
        ]),
      );

      const result = await readChatMessages('chat1', 10, 0);
      expect(result[0].text).toBe('[Attachment]');
    });
  });

  describe('searchMessages', () => {
    it('returns search results', async () => {
      mockSqliteSuccess(
        JSON.stringify([
          {
            ROWID: 1,
            text: 'meeting at 5',
            is_from_me: 0,
            handle_id: '+1234',
            date: 757382400000000000,
            attributedBody_hex: null,
            attachment_count: 0,
            chat_guid: 'chat1',
            chat_name: 'Work',
          },
        ]),
      );

      const result = await searchMessages('meeting', 10);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('meeting at 5');
      expect(result[0].chatId).toBe('chat1');
      expect(result[0].chatName).toBe('Work');
    });

    it('returns empty array for no matches', async () => {
      mockSqliteSuccess('');
      const result = await searchMessages('nonexistent', 10);
      expect(result).toEqual([]);
    });

    it('uses chat_guid as chatName fallback when chat_name is empty', async () => {
      mockSqliteSuccess(
        JSON.stringify([
          {
            ROWID: 1,
            text: 'hi',
            is_from_me: 0,
            handle_id: '+1234',
            date: 757382400000000000,
            attributedBody_hex: null,
            attachment_count: 0,
            chat_guid: 'iMessage;-;+1234',
            chat_name: '',
          },
        ]),
      );

      const result = await searchMessages('hi', 10);
      expect(result[0].chatName).toBe('iMessage;-;+1234');
    });
  });

  describe('readMessagesByHandles', () => {
    it('returns messages for given handles', async () => {
      mockSqliteSuccess(
        JSON.stringify([
          {
            ROWID: 1,
            text: 'From handle',
            is_from_me: 0,
            handle_id: '+5551234567',
            date: 757382400000000000,
            attributedBody_hex: null,
            attachment_count: 0,
            chat_guid: 'chat1',
            chat_name: 'Someone',
          },
        ]),
      );

      const result = await readMessagesByHandles(['+5551234567'], 10);
      expect(result).toHaveLength(1);
      expect(result[0].sender).toBe('+5551234567');
    });

    it('returns empty array for empty handles', async () => {
      const result = await readMessagesByHandles([], 10);
      expect(result).toEqual([]);
      // Should not even call sqlite
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('handles email handles with exact match', async () => {
      mockSqliteSuccess(JSON.stringify([]));
      await readMessagesByHandles(['user@example.com'], 10);
      expect(mockExecFile).toHaveBeenCalledTimes(1);
      const queryArg = mockExecFile.mock.calls[0][1][2] as string;
      expect(queryArg).toContain("h.id = 'user@example.com'");
    });

    it('handles phone numbers with LIKE suffix match', async () => {
      mockSqliteSuccess(JSON.stringify([]));
      await readMessagesByHandles(['+15551234567'], 10);
      const queryArg = mockExecFile.mock.calls[0][1][2] as string;
      expect(queryArg).toContain("h.id LIKE '%5551234567'");
    });
  });
});
