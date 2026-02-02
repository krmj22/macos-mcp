/**
 * reminderDateParser.test.ts
 * Unit tests for reminder dueDate parsing helper.
 */

import { parseReminderDueDate } from './reminderDateParser.js';

const ORIGINAL_TZ = process.env.TZ;

describe('parseReminderDueDate', () => {
  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });

  afterAll(() => {
    if (ORIGINAL_TZ) {
      process.env.TZ = ORIGINAL_TZ;
    } else {
      delete process.env.TZ;
    }
  });

  it('returns undefined for empty values', () => {
    expect(parseReminderDueDate(undefined)).toBeUndefined();
    expect(parseReminderDueDate('')).toBeUndefined();
  });

  it('parses date-only strings as local midnight', () => {
    const parsed = parseReminderDueDate('2024-01-15');
    const expected = new Date(2024, 0, 15);
    expect(parsed?.getTime()).toBe(expected.getTime());
  });

  it('parses local datetime strings without timezone as local time', () => {
    const parsed = parseReminderDueDate('2024-01-15 09:30:00');
    const expected = new Date(2024, 0, 15, 9, 30, 0);
    expect(parsed?.getTime()).toBe(expected.getTime());
  });

  it('parses ISO timestamps with timezone offsets', () => {
    const parsed = parseReminderDueDate('2024-01-15T10:00:00Z');
    expect(parsed?.toISOString()).toBe('2024-01-15T10:00:00.000Z');
  });

  it('normalizes date-only strings that include timezone offsets', () => {
    const parsed = parseReminderDueDate('2024-01-15+08:00');
    expect(parsed?.toISOString()).toBe('2024-01-14T16:00:00.000Z');
  });

  it('handles timezone offsets without a colon', () => {
    const parsed = parseReminderDueDate('2024-01-15 10:00:00+0800');
    expect(parsed?.toISOString()).toBe('2024-01-15T02:00:00.000Z');
  });
});
