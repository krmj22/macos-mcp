/**
 * contactResolver.test.ts
 * Tests for ContactResolverService
 */

import {
  ContactResolverService,
  ContactSearchError,
} from './contactResolver.js';

// Mock the jxaExecutor module
jest.mock('./jxaExecutor.js', () => ({
  executeJxaWithRetry: jest.fn(),
  sanitizeForJxa: jest.fn((input: string) => input),
  JxaError: class JxaError extends Error {
    constructor(
      message: string,
      public readonly app: string,
      public readonly isPermissionError: boolean,
      public readonly stderr?: string,
    ) {
      super(message);
      this.name = 'JxaError';
    }
  },
}));

import { executeJxaWithRetry } from './jxaExecutor.js';

const mockExecuteJxa = executeJxaWithRetry as jest.MockedFunction<
  typeof executeJxaWithRetry
>;

describe('ContactResolverService', () => {
  let service: ContactResolverService;

  const mockContacts = [
    {
      id: 'contact-1',
      fullName: 'John Doe',
      firstName: 'John',
      lastName: 'Doe',
      phones: ['+1 (555) 123-4567', '555-987-6543'],
      emails: ['john.doe@example.com', 'john@work.com'],
    },
    {
      id: 'contact-2',
      fullName: 'Jane Smith',
      firstName: 'Jane',
      lastName: 'Smith',
      phones: ['+44 20 7946 0958'],
      emails: ['JANE.SMITH@Example.COM'],
    },
    {
      id: 'contact-3',
      fullName: 'Bob Wilson',
      firstName: 'Bob',
      lastName: 'Wilson',
      phones: ['5551234567'],
      emails: [],
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    // Use a short TTL for testing
    service = new ContactResolverService(100);
    mockExecuteJxa.mockResolvedValue(mockContacts);
  });

  describe('normalizePhone', () => {
    it.each([
      ['+15551234567', '15551234567', 'E.164 format'],
      ['(555) 123-4567', '5551234567', 'parentheses and spaces'],
      ['555-123-4567', '5551234567', 'dashes'],
      ['5551234567', '5551234567', 'already normalized'],
      ['+44 20 7946 0958', '442079460958', 'international'],
      ['555.123.4567', '5551234567', 'dots'],
      ['+1 (555) 123-4567', '15551234567', 'mixed formatting'],
      ['', '', 'empty string'],
      ['555-123-4567 ext. 123', '5551234567123', 'extensions'],
    ])('normalizes %s → %s (%s)', (input, expected) => {
      expect(service.normalizePhone(input)).toBe(expected);
    });
  });

  describe('normalizeEmail', () => {
    it.each([
      ['John.Doe@Example.COM', 'john.doe@example.com', 'lowercase'],
      ['  john@example.com  ', 'john@example.com', 'trim whitespace'],
      ['john@example.com', 'john@example.com', 'already normalized'],
      ['', '', 'empty string'],
    ])('normalizes %s → %s (%s)', (input, expected) => {
      expect(service.normalizeEmail(input)).toBe(expected);
    });
  });

  describe('resolveHandle', () => {
    it('should resolve a phone number to a contact', async () => {
      const result = await service.resolveHandle('+1 (555) 123-4567');

      expect(result).toEqual({
        id: 'contact-1',
        fullName: 'John Doe',
        firstName: 'John',
        lastName: 'Doe',
      });
    });

    it('should resolve an email to a contact', async () => {
      const result = await service.resolveHandle('john.doe@example.com');

      expect(result).toEqual({
        id: 'contact-1',
        fullName: 'John Doe',
        firstName: 'John',
        lastName: 'Doe',
      });
    });

    it('should resolve case-insensitive email', async () => {
      const result = await service.resolveHandle('JANE.SMITH@EXAMPLE.COM');

      expect(result).toEqual({
        id: 'contact-2',
        fullName: 'Jane Smith',
        firstName: 'Jane',
        lastName: 'Smith',
      });
    });

    it('should return null for unknown handle', async () => {
      const result = await service.resolveHandle('unknown@example.com');

      expect(result).toBeNull();
    });

    it('should match phone by last 10 digits when no exact match exists', async () => {
      // Override mock to use a contact with only an 11-digit phone
      mockExecuteJxa.mockResolvedValue([
        {
          id: 'contact-intl',
          fullName: 'International User',
          firstName: 'International',
          lastName: 'User',
          phones: ['+12125551234'], // 12125551234 - 11 digits
          emails: [],
        },
      ]);

      // Searching with just last 10 digits should still match via fallback
      const result = await service.resolveHandle('2125551234');

      expect(result).toEqual({
        id: 'contact-intl',
        fullName: 'International User',
        firstName: 'International',
        lastName: 'User',
      });
    });

    it('should resolve international phone numbers', async () => {
      const result = await service.resolveHandle('+44 20 7946 0958');

      expect(result).toEqual({
        id: 'contact-2',
        fullName: 'Jane Smith',
        firstName: 'Jane',
        lastName: 'Smith',
      });
    });

    it('should only call JXA once for multiple resolves (caching)', async () => {
      await service.resolveHandle('john@example.com');
      await service.resolveHandle('jane@example.com');
      await service.resolveHandle('+1 555 123 4567');

      // JXA should only be called once to build cache
      expect(mockExecuteJxa).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveBatch', () => {
    it('should resolve multiple handles at once', async () => {
      const results = await service.resolveBatch([
        'john.doe@example.com',
        '+44 20 7946 0958',
        'unknown@test.com',
      ]);

      expect(results.size).toBe(2);
      expect(results.get('john.doe@example.com')).toEqual({
        id: 'contact-1',
        fullName: 'John Doe',
        firstName: 'John',
        lastName: 'Doe',
      });
      expect(results.get('+44 20 7946 0958')).toEqual({
        id: 'contact-2',
        fullName: 'Jane Smith',
        firstName: 'Jane',
        lastName: 'Smith',
      });
      expect(results.has('unknown@test.com')).toBe(false);
    });

    it('should return empty map for empty input', async () => {
      const results = await service.resolveBatch([]);

      expect(results.size).toBe(0);
    });

    it('should only call JXA once for batch resolve', async () => {
      await service.resolveBatch([
        'john@example.com',
        'jane@example.com',
        '+1 555 123 4567',
        '+44 20 7946 0958',
      ]);

      expect(mockExecuteJxa).toHaveBeenCalledTimes(1);
    });
  });

  describe('invalidateCache', () => {
    it('should force cache rebuild after invalidation', async () => {
      // First resolve builds cache
      await service.resolveHandle('john@example.com');
      expect(mockExecuteJxa).toHaveBeenCalledTimes(1);

      // Invalidate cache
      service.invalidateCache();

      // Next resolve should rebuild cache
      await service.resolveHandle('john@example.com');
      expect(mockExecuteJxa).toHaveBeenCalledTimes(2);
    });

    it('should clear cache entries', async () => {
      await service.resolveHandle('john@example.com');
      expect(service.getCacheSize()).toBeGreaterThan(0);

      service.invalidateCache();
      expect(service.getCacheSize()).toBe(0);
    });
  });

  describe('cache TTL', () => {
    it('should rebuild cache after TTL expires', async () => {
      // Build cache
      await service.resolveHandle('john@example.com');
      expect(mockExecuteJxa).toHaveBeenCalledTimes(1);

      // Wait for TTL to expire (100ms in test)
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should rebuild cache
      await service.resolveHandle('john@example.com');
      expect(mockExecuteJxa).toHaveBeenCalledTimes(2);
    });

    it('should not rebuild cache before TTL expires', async () => {
      // Build cache
      await service.resolveHandle('john@example.com');
      expect(mockExecuteJxa).toHaveBeenCalledTimes(1);

      // Immediately resolve again (before TTL)
      await service.resolveHandle('john@example.com');
      expect(mockExecuteJxa).toHaveBeenCalledTimes(1);
    });
  });

  describe('concurrent cache builds (coalescing)', () => {
    it('should coalesce concurrent cache builds into single JXA call', async () => {
      // Simulate slow JXA call with a deferred promise
      let resolveJxa: ((value: unknown) => void) | undefined;
      mockExecuteJxa.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveJxa = resolve;
          }),
      );

      // Start multiple concurrent resolves
      const promise1 = service.resolveHandle('john@example.com');
      const promise2 = service.resolveHandle('jane@example.com');
      const promise3 = service.resolveBatch(['+1 555 123 4567']);

      // JXA should only be called once
      expect(mockExecuteJxa).toHaveBeenCalledTimes(1);

      // Resolve the JXA call
      if (resolveJxa) {
        resolveJxa(mockContacts);
      }

      // All promises should resolve
      await Promise.all([promise1, promise2, promise3]);

      // Still only one JXA call
      expect(mockExecuteJxa).toHaveBeenCalledTimes(1);
    });
  });

  describe('graceful degradation on permission failure', () => {
    it('should return null on permission error', async () => {
      const { JxaError: MockJxaError } = jest.requireMock('./jxaExecutor.js');
      mockExecuteJxa.mockRejectedValue(
        new MockJxaError(
          'Permission denied for Contacts',
          'Contacts',
          true,
          'not authorized',
        ),
      );

      const result = await service.resolveHandle('john@example.com');

      expect(result).toBeNull();
    });

    it('should return empty map on permission error in batch', async () => {
      const { JxaError: MockJxaError } = jest.requireMock('./jxaExecutor.js');
      mockExecuteJxa.mockRejectedValue(
        new MockJxaError(
          'Permission denied for Contacts',
          'Contacts',
          true,
          'not authorized',
        ),
      );

      const results = await service.resolveBatch(['john@example.com']);

      expect(results.size).toBe(0);
    });

    it('should set cache timestamp on permission error to avoid repeated calls', async () => {
      const { JxaError: MockJxaError } = jest.requireMock('./jxaExecutor.js');
      const permError = new MockJxaError(
        'Permission denied for Contacts',
        'Contacts',
        true,
        'not authorized',
      );
      mockExecuteJxa.mockRejectedValue(permError);

      await service.resolveHandle('john@example.com');
      expect(mockExecuteJxa).toHaveBeenCalledTimes(1);

      // Second call should not trigger JXA again (cache is "valid" but empty)
      // Note: We need to keep the mock rejection for the second call since
      // the first call's error handling should have set the cache timestamp
      await service.resolveHandle('jane@example.com');
      expect(mockExecuteJxa).toHaveBeenCalledTimes(1);
    });

    it('should return null on other errors', async () => {
      mockExecuteJxa.mockRejectedValue(new Error('Network error'));

      const result = await service.resolveHandle('john@example.com');

      expect(result).toBeNull();
    });

    it('should return empty map on other errors in batch', async () => {
      mockExecuteJxa.mockRejectedValue(new Error('Network error'));

      const results = await service.resolveBatch(['john@example.com']);

      expect(results.size).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle contacts with empty names', async () => {
      mockExecuteJxa.mockResolvedValue([
        {
          id: 'contact-empty',
          fullName: '',
          firstName: '',
          lastName: '',
          phones: ['5551111111'],
          emails: ['empty@test.com'],
        },
      ]);

      const result = await service.resolveHandle('5551111111');

      expect(result).toEqual({
        id: 'contact-empty',
        fullName: '',
        firstName: undefined,
        lastName: undefined,
      });
    });

    it('should handle empty contacts array', async () => {
      mockExecuteJxa.mockResolvedValue([]);

      const result = await service.resolveHandle('john@example.com');

      expect(result).toBeNull();
      expect(service.getCacheSize()).toBe(0);
    });

    it('should handle very short phone numbers gracefully', async () => {
      // Phone detection requires at least 7 digits
      const result = await service.resolveHandle('123');

      // Should be treated as email since too short for phone
      expect(result).toBeNull();
    });
  });

  describe('resolveNameToHandles', () => {
    it('should resolve a full name to phone numbers and emails', async () => {
      // Mock returns contacts matching "John Doe" via targeted search
      mockExecuteJxa.mockResolvedValue([mockContacts[0]]);

      const result = await service.resolveNameToHandles('John Doe');

      expect(result).not.toBeNull();
      expect(result?.phones).toContain('15551234567');
      expect(result?.emails).toContain('john.doe@example.com');
      expect(result?.emails).toContain('john@work.com');
    });

    it('should use targeted JXA search with people.whose', async () => {
      mockExecuteJxa.mockResolvedValue([mockContacts[0]]);

      await service.resolveNameToHandles('John');

      // Verify JXA was called with a script containing people.whose
      expect(mockExecuteJxa).toHaveBeenCalledWith(
        expect.stringContaining('people.whose'),
        15000,
        'Contacts',
        2,
        1000,
      );
    });

    it('should support partial name matching (via targeted search)', async () => {
      // JXA people.whose handles partial matching natively
      mockExecuteJxa.mockResolvedValue([mockContacts[0]]);

      const result = await service.resolveNameToHandles('john');

      expect(result).not.toBeNull();
      expect(result?.phones).toContain('15551234567');
    });

    it('should match by last name', async () => {
      mockExecuteJxa.mockResolvedValue([mockContacts[1]]);

      const result = await service.resolveNameToHandles('Smith');

      expect(result).not.toBeNull();
      expect(result?.emails).toContain('jane.smith@example.com');
    });

    it('should return null for unknown name (empty results)', async () => {
      mockExecuteJxa.mockResolvedValue([]);

      const result = await service.resolveNameToHandles('Unknown Person');

      expect(result).toBeNull();
    });

    it('should return null for empty name', async () => {
      const result = await service.resolveNameToHandles('');

      expect(result).toBeNull();
      // Should not call JXA for empty input
      expect(mockExecuteJxa).not.toHaveBeenCalled();
    });

    it('should return null for whitespace-only name', async () => {
      const result = await service.resolveNameToHandles('   ');

      expect(result).toBeNull();
      expect(mockExecuteJxa).not.toHaveBeenCalled();
    });

    it('should combine handles from multiple contacts with similar names', async () => {
      mockExecuteJxa.mockResolvedValue([
        {
          id: 'john-1',
          fullName: 'John Smith',
          firstName: 'John',
          lastName: 'Smith',
          phones: ['5551111111'],
          emails: ['john.smith@example.com'],
        },
        {
          id: 'john-2',
          fullName: 'John Doe',
          firstName: 'John',
          lastName: 'Doe',
          phones: ['5552222222'],
          emails: ['john.doe@example.com'],
        },
      ]);

      const result = await service.resolveNameToHandles('John');

      expect(result).not.toBeNull();
      expect(result?.phones).toContain('5551111111');
      expect(result?.phones).toContain('5552222222');
      expect(result?.emails).toContain('john.smith@example.com');
      expect(result?.emails).toContain('john.doe@example.com');
    });

    it('should deduplicate handles', async () => {
      mockExecuteJxa.mockResolvedValue([
        {
          id: 'contact-1',
          fullName: 'John Doe',
          firstName: 'John',
          lastName: 'Doe',
          phones: ['5551234567', '5551234567'], // Duplicate
          emails: ['john@example.com'],
        },
      ]);

      const result = await service.resolveNameToHandles('John');

      expect(result).not.toBeNull();
      expect(result?.phones.length).toBe(1);
    });

    it('should return null on permission error', async () => {
      const { JxaError: MockJxaError } = jest.requireMock('./jxaExecutor.js');
      mockExecuteJxa.mockRejectedValue(
        new MockJxaError(
          'Permission denied for Contacts',
          'Contacts',
          true,
          'not authorized',
        ),
      );

      const result = await service.resolveNameToHandles('John');

      expect(result).toBeNull();
    });

    it('should make independent JXA calls for resolveHandle and resolveNameToHandles', async () => {
      // resolveHandle uses bulk cache, resolveNameToHandles uses targeted search
      await service.resolveHandle('john@example.com');
      mockExecuteJxa.mockResolvedValue([mockContacts[0]]);
      await service.resolveNameToHandles('John');

      // Both should trigger separate JXA calls (different code paths)
      expect(mockExecuteJxa).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['only phones', ['5551234567'], [], 1, 0],
      ['only emails', [], ['email@example.com'], 0, 1],
    ])('handles contacts with %s', async (_desc, phones, emails, expectedPhones, expectedEmails) => {
      mockExecuteJxa.mockResolvedValue([
        {
          id: 'partial',
          fullName: 'Partial Contact',
          firstName: 'Partial',
          lastName: 'Contact',
          phones,
          emails,
        },
      ]);

      const result = await service.resolveNameToHandles('Partial');

      expect(result).not.toBeNull();
      expect(result?.phones.length).toBe(expectedPhones);
      expect(result?.emails.length).toBe(expectedEmails);
    });

    it('should return null for contacts with no handles', async () => {
      mockExecuteJxa.mockResolvedValue([
        {
          id: 'no-handles',
          fullName: 'No Handles',
          firstName: 'No',
          lastName: 'Handles',
          phones: [],
          emails: [],
        },
      ]);

      const result = await service.resolveNameToHandles('No Handles');

      expect(result).toBeNull();
    });
  });

  describe('resolveNameToHandles error handling', () => {
    it('should throw ContactSearchError on timeout', async () => {
      mockExecuteJxa.mockRejectedValue(
        new Error('JXA execution failed for Contacts: timed out'),
      );

      await expect(service.resolveNameToHandles('John')).rejects.toThrow(
        ContactSearchError,
      );

      try {
        await service.resolveNameToHandles('John');
      } catch (error) {
        expect(error).toBeInstanceOf(ContactSearchError);
        expect((error as ContactSearchError).isTimeout).toBe(true);
      }
    });

    it('should throw ContactSearchError on non-permission JXA failure', async () => {
      mockExecuteJxa.mockRejectedValue(
        new Error('JXA execution failed for Contacts: script error'),
      );

      await expect(service.resolveNameToHandles('John')).rejects.toThrow(
        ContactSearchError,
      );

      try {
        await service.resolveNameToHandles('John');
      } catch (error) {
        expect(error).toBeInstanceOf(ContactSearchError);
        expect((error as ContactSearchError).isTimeout).toBe(false);
      }
    });

    it('should include search term in error message', async () => {
      mockExecuteJxa.mockRejectedValue(new Error('some error'));

      try {
        await service.resolveNameToHandles('John Doe');
      } catch (error) {
        expect((error as ContactSearchError).message).toContain('John Doe');
      }
    });
  });

  describe('ContactSearchError', () => {
    it('should have correct name', () => {
      const error = new ContactSearchError('test', false);
      expect(error.name).toBe('ContactSearchError');
    });

    it('should preserve isTimeout flag', () => {
      const timeoutError = new ContactSearchError('timeout', true);
      expect(timeoutError.isTimeout).toBe(true);

      const otherError = new ContactSearchError('other', false);
      expect(otherError.isTimeout).toBe(false);
    });

    it('should be an instance of Error', () => {
      const error = new ContactSearchError('test', false);
      expect(error).toBeInstanceOf(Error);
    });
  });
});
