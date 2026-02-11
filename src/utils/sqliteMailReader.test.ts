/**
 * sqliteMailReader.test.ts
 * Tests for pure utility functions in the Mail SQLite reader.
 */

import { mailDateToISO, parseMailboxUrl } from './sqliteMailReader.js';

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
