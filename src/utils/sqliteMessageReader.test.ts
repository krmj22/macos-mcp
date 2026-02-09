/**
 * sqliteMessageReader.test.ts
 * Tests for date filtering in SQLite message queries
 */

import {
  buildDateFilter,
  type DateRange,
  dateToAppleTimestamp,
} from './sqliteMessageReader.js';

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
});
