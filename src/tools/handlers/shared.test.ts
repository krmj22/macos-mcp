/**
 * shared.test.ts
 * Tests for shared handler utilities: formatListMarkdown, formatSuccessMessage, formatDeleteMessage
 */

jest.mock('../../utils/timezone.js', () => ({
  getSystemTimezone: jest.fn().mockReturnValue({ name: 'America/New_York', offset: '-05:00' }),
  formatTimezoneInfo: jest.fn().mockReturnValue('America/New_York (UTC-05:00)'),
}));

import { formatDeleteMessage, formatListMarkdown, formatSuccessMessage } from './shared.js';

describe('formatListMarkdown', () => {
  const formatItem = (item: string) => [`- ${item}`];

  it('uses FormatListOptions with pagination + includeTimezone', () => {
    const result = formatListMarkdown(
      'Events',
      ['Meeting', 'Lunch'],
      formatItem,
      'No events',
      { pagination: { offset: 5, limit: 2 }, includeTimezone: true },
    );
    expect(result).toContain('Showing 6\u20137');
    expect(result).toContain('- Meeting');
    expect(result).toContain('- Lunch');
    expect(result).toContain('*User timezone: America/New_York (UTC-05:00)*');
  });

  it('uses FormatListOptions with only includeTimezone (no pagination)', () => {
    const result = formatListMarkdown(
      'Reminders',
      ['Buy milk'],
      formatItem,
      'No reminders',
      { includeTimezone: true },
    );
    expect(result).toContain('Total: 1');
    expect(result).toContain('- Buy milk');
    expect(result).toContain('*User timezone: America/New_York (UTC-05:00)*');
  });

  it('uses legacy pagination-only signature (backward compat)', () => {
    const result = formatListMarkdown(
      'Notes',
      ['Note A', 'Note B', 'Note C'],
      formatItem,
      'No notes',
      { offset: 10, limit: 3 },
    );
    expect(result).toContain('Showing 11\u201313');
    expect(result).not.toContain('timezone');
  });
});

describe('formatSuccessMessage', () => {
  it('formats created action for a note', () => {
    const result = formatSuccessMessage('created', 'note', 'Title', 'id1');
    expect(result).toBe('Successfully created note "Title".\n- ID: id1');
  });

  it('formats updated action for a list (special prefix)', () => {
    const result = formatSuccessMessage('updated', 'list', 'New Name', 'id1');
    expect(result).toBe('Successfully updated list to "New Name".\n- ID: id1');
  });

  it('formats updated action for a reminder (standard prefix)', () => {
    const result = formatSuccessMessage('updated', 'reminder', 'Title', 'id1');
    expect(result).toBe('Successfully updated reminder "Title".\n- ID: id1');
  });
});

describe('formatDeleteMessage', () => {
  it('uses all defaults (quotes, ID prefix, colon, period)', () => {
    const result = formatDeleteMessage('note', 'n1');
    expect(result).toBe('Successfully deleted note with ID: "n1".');
  });

  it('omits quotes when useQuotes=false', () => {
    const result = formatDeleteMessage('note', 'n1', { useQuotes: false });
    expect(result).toBe('Successfully deleted note with ID: n1.');
  });

  it('omits ID prefix when useIdPrefix=false', () => {
    const result = formatDeleteMessage('note', 'n1', { useIdPrefix: false });
    expect(result).toBe('Successfully deleted note "n1".');
  });

  it('omits trailing period when usePeriod=false', () => {
    const result = formatDeleteMessage('note', 'n1', { usePeriod: false });
    expect(result).toBe('Successfully deleted note with ID: "n1"');
  });

  it('omits colon when useColon=false', () => {
    const result = formatDeleteMessage('note', 'n1', { useColon: false });
    expect(result).toBe('Successfully deleted note with ID "n1".');
  });
});
