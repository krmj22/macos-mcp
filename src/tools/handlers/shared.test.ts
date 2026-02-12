/**
 * shared.test.ts
 * Tests for shared handler utilities: formatListMarkdown, formatSuccessMessage, formatDeleteMessage
 */

jest.mock('../../utils/timezone.js', () => ({
  getSystemTimezone: jest
    .fn()
    .mockReturnValue({ name: 'America/New_York', offset: '-05:00' }),
  formatTimezoneInfo: jest.fn().mockReturnValue('America/New_York (UTC-05:00)'),
}));

import {
  formatDeleteMessage,
  formatListMarkdown,
  formatSuccessMessage,
  withTimeout,
} from './shared.js';

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

describe('withTimeout', () => {
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('returns the promise result when it resolves before timeout', async () => {
    const result = await withTimeout(
      Promise.resolve('hello'),
      1000,
      'fallback',
    );
    expect(result).toBe('hello');
  });

  it('returns fallback when promise exceeds timeout', async () => {
    const slow = new Promise<string>((resolve) =>
      setTimeout(() => resolve('slow'), 500),
    );
    const result = await withTimeout(slow, 10, 'fallback');
    expect(result).toBe('fallback');
  });

  it('does not log to stderr when no label is provided and timeout fires', async () => {
    const slow = new Promise<string>((resolve) =>
      setTimeout(() => resolve('slow'), 500),
    );
    await withTimeout(slow, 10, 'fallback');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('logs structured warning to stderr when label is provided and timeout fires', async () => {
    const slow = new Promise<Map<string, string>>((resolve) =>
      setTimeout(() => resolve(new Map([['k', 'v']])), 500),
    );
    const fallback = new Map<string, string>();
    await withTimeout(slow, 10, fallback, 'test_enrichment');

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(logged.event).toBe('enrichment_timeout');
    expect(logged.label).toBe('test_enrichment');
    expect(logged.timeoutMs).toBe(10);
    expect(logged.level).toBe('warn');
  });

  it('does not log when promise resolves before timeout even with label', async () => {
    const result = await withTimeout(
      Promise.resolve('fast'),
      1000,
      'fallback',
      'test_label',
    );
    expect(result).toBe('fast');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('clears timer after promise resolves to avoid memory leaks', async () => {
    const clearSpy = jest.spyOn(global, 'clearTimeout');
    await withTimeout(Promise.resolve('done'), 1000, 'fallback');
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
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
