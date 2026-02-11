/**
 * contactsHandlers.test.ts
 * Tests for all 5 Contacts CRUD handlers
 */

// Mock jxaExecutor - only mock OS calls, use real sanitizeForJxa/buildScript
jest.mock('../../utils/jxaExecutor.js', () => {
  const actual = jest.requireActual('../../utils/jxaExecutor.js');
  return {
    ...actual,
    executeJxa: jest.fn(),
    executeJxaWithRetry: jest.fn(),
  };
});

jest.mock('../../utils/errorHandling.js', () => ({
  handleAsyncOperation: jest.fn(
    async (operation: () => Promise<string>, _name: string) => {
      try {
        const result = await operation();
        return { content: [{ type: 'text', text: result }], isError: false };
      } catch (error) {
        return {
          content: [{ type: 'text', text: (error as Error).message }],
          isError: true,
        };
      }
    },
  ),
}));

const mockExecuteJxa = jest.requireMock('../../utils/jxaExecutor.js')
  .executeJxa as jest.Mock;
const mockExecuteJxaWithRetry = jest.requireMock('../../utils/jxaExecutor.js')
  .executeJxaWithRetry as jest.Mock;

// biome-ignore lint: test helper
function getTextContent(result: any): string {
  return result.content[0].text;
}

describe('Contacts Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  let handleReadContacts: typeof import('./contactsHandlers.js').handleReadContacts;
  let handleSearchContacts: typeof import('./contactsHandlers.js').handleSearchContacts;
  let handleCreateContact: typeof import('./contactsHandlers.js').handleCreateContact;
  let handleUpdateContact: typeof import('./contactsHandlers.js').handleUpdateContact;
  let handleDeleteContact: typeof import('./contactsHandlers.js').handleDeleteContact;

  beforeAll(async () => {
    const mod = await import('./contactsHandlers.js');
    handleReadContacts = mod.handleReadContacts;
    handleSearchContacts = mod.handleSearchContacts;
    handleCreateContact = mod.handleCreateContact;
    handleUpdateContact = mod.handleUpdateContact;
    handleDeleteContact = mod.handleDeleteContact;
  });

  describe('handleReadContacts', () => {
    it('returns contact list with default pagination', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue([
        {
          id: 'c1',
          firstName: 'John',
          lastName: 'Doe',
          fullName: 'John Doe',
          organization: 'Acme',
          emails: [{ value: 'john@acme.com', label: 'work' }],
          phones: [{ value: '+15551234567', label: 'mobile' }],
          addresses: [],
        },
      ]);

      const result = await handleReadContacts({ action: 'read' });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('John Doe');
      expect(getTextContent(result)).toContain('john@acme.com');
      expect(getTextContent(result)).toContain('+15551234567');
    });

    it('returns single contact by ID with detail format', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue({
        id: 'c1',
        firstName: 'Jane',
        lastName: 'Smith',
        fullName: 'Jane Smith',
        organization: 'Corp',
        jobTitle: 'Engineer',
        emails: [{ value: 'jane@corp.com', label: 'work' }],
        phones: [],
        addresses: [
          {
            street: '123 Main St',
            city: 'Springfield',
            state: 'IL',
            zip: '62701',
            country: 'US',
            label: 'home',
          },
        ],
        birthday: '1990-05-15',
        note: 'Important client',
        modificationDate: '2025-01-01',
      });

      const result = await handleReadContacts({ action: 'read', id: 'c1' });
      expect(result.isError).toBe(false);
      const text = getTextContent(result);
      expect(text).toContain('### Contact: Jane Smith');
      expect(text).toContain('Engineer');
      expect(text).toContain('123 Main St');
      expect(text).toContain('Important client');
      expect(text).toContain('Birthday');
    });

    it('returns "not found" when contact is null', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue(null);

      const result = await handleReadContacts({
        action: 'read',
        id: 'missing',
      });
      expect(getTextContent(result)).toBe('Contact not found.');
    });

    it('returns empty state when no contacts exist', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue([]);

      const result = await handleReadContacts({ action: 'read' });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('No contacts found.');
    });

    it('passes pagination params to script', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue([]);

      await handleReadContacts({ action: 'read', limit: 10, offset: 20 });

      const script = mockExecuteJxaWithRetry.mock.calls[0][0];
      expect(script).toContain('offset = 20');
      expect(script).toContain('limit = 10');
    });

    it('propagates JXA errors', async () => {
      mockExecuteJxaWithRetry.mockRejectedValue(
        new Error('JXA execution failed'),
      );

      const result = await handleReadContacts({ action: 'read' });
      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('JXA execution failed');
    });
  });

  describe('handleSearchContacts', () => {
    it('searches contacts by name', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue([
        {
          id: 'c1',
          firstName: 'John',
          lastName: 'Doe',
          fullName: 'John Doe',
          organization: '',
          emails: [],
          phones: [],
          addresses: [],
        },
      ]);

      const result = await handleSearchContacts({
        action: 'read',
        search: 'John',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Contacts matching "John"');
      expect(getTextContent(result)).toContain('John Doe');
    });

    it('returns empty when no matches', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue([]);

      const result = await handleSearchContacts({
        action: 'read',
        search: 'Nonexistent',
      });
      expect(getTextContent(result)).toContain(
        'No contacts found matching search.',
      );
    });

    it('sanitizes search query in script', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue([]);

      await handleSearchContacts({
        action: 'read',
        search: "O'Brien",
      });

      const script = mockExecuteJxaWithRetry.mock.calls[0][0];
      expect(script).toContain("O\\'Brien");
    });

    it('propagates errors', async () => {
      mockExecuteJxaWithRetry.mockRejectedValue(new Error('Contacts timeout'));

      const result = await handleSearchContacts({
        action: 'read',
        search: 'test',
      });
      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Contacts timeout');
    });
  });

  describe('handleCreateContact', () => {
    it('creates contact with name only', async () => {
      mockExecuteJxa.mockResolvedValue({
        id: 'new-1',
        fullName: 'Alice Wonder',
      });

      const result = await handleCreateContact({
        action: 'create',
        firstName: 'Alice',
        lastName: 'Wonder',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain(
        'Successfully created contact "Alice Wonder"',
      );
      expect(getTextContent(result)).toContain('ID: new-1');
    });

    it('creates contact with email and phone', async () => {
      mockExecuteJxa.mockResolvedValue({ id: 'new-2', fullName: 'Bob Test' });

      await handleCreateContact({
        action: 'create',
        firstName: 'Bob',
        lastName: 'Test',
        email: 'bob@test.com',
        phone: '+15551234567',
      });

      const script = mockExecuteJxa.mock.calls[0][0];
      expect(script).toContain('bob@test.com');
      expect(script).toContain('+15551234567');
      expect(script).toContain('Contacts.Email');
      expect(script).toContain('Contacts.Phone');
    });

    it('creates contact with address', async () => {
      mockExecuteJxa.mockResolvedValue({ id: 'new-3', fullName: 'Eve Town' });

      await handleCreateContact({
        action: 'create',
        firstName: 'Eve',
        lastName: 'Town',
        street: '456 Oak Ave',
        city: 'Portland',
        state: 'OR',
        zip: '97201',
        country: 'US',
      });

      const script = mockExecuteJxa.mock.calls[0][0];
      expect(script).toContain('Contacts.Address');
      expect(script).toContain('456 Oak Ave');
      expect(script).toContain('Portland');
    });

    it('sanitizes special characters in fields', async () => {
      mockExecuteJxa.mockResolvedValue({
        id: 'new-4',
        fullName: "O'Brien & Sons",
      });

      await handleCreateContact({
        action: 'create',
        firstName: "O'Brien",
        organization: 'A & B "Corp"',
      });

      const script = mockExecuteJxa.mock.calls[0][0];
      expect(script).toContain("O\\'Brien");
      expect(script).toContain('A & B \\"Corp\\"');
    });

    it('propagates JXA errors', async () => {
      mockExecuteJxa.mockRejectedValue(new Error('Contacts save failed'));

      const result = await handleCreateContact({
        action: 'create',
        firstName: 'Fail',
      });
      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Contacts save failed');
    });
  });

  describe('handleUpdateContact', () => {
    it('updates contact with partial fields', async () => {
      mockExecuteJxa.mockResolvedValue({ id: 'c1', name: 'Jane Updated' });

      const result = await handleUpdateContact({
        action: 'update',
        id: 'c1',
        firstName: 'Jane',
        lastName: 'Updated',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain(
        'Successfully updated contact "Jane Updated"',
      );
    });

    it('sets hasField flags correctly for provided fields', async () => {
      mockExecuteJxa.mockResolvedValue({ id: 'c1', name: 'Test' });

      await handleUpdateContact({
        action: 'update',
        id: 'c1',
        firstName: 'New',
      });

      const script = mockExecuteJxa.mock.calls[0][0];
      expect(script).toContain('"true" === "true") p.firstName');
      expect(script).toContain('"false" === "true") p.lastName');
    });

    it('propagates "Contact not found" error from JXA', async () => {
      mockExecuteJxa.mockRejectedValue(new Error('Contact not found'));

      const result = await handleUpdateContact({
        action: 'update',
        id: 'missing-id',
        firstName: 'Ghost',
      });
      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Contact not found');
    });

    it('sanitizes update values', async () => {
      mockExecuteJxa.mockResolvedValue({ id: 'c1', name: 'Test' });

      await handleUpdateContact({
        action: 'update',
        id: 'c1',
        note: 'Line1\nLine2',
      });

      const script = mockExecuteJxa.mock.calls[0][0];
      expect(script).toContain('Line1\\nLine2');
    });
  });

  describe('handleDeleteContact', () => {
    it('deletes contact successfully', async () => {
      mockExecuteJxa.mockResolvedValue({ deleted: true, name: 'John Doe' });

      const result = await handleDeleteContact({
        action: 'delete',
        id: 'c1',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain(
        'Successfully deleted contact "John Doe"',
      );
      expect(getTextContent(result)).toContain('ID: c1');
    });

    it('propagates "Contact not found" error', async () => {
      mockExecuteJxa.mockRejectedValue(new Error('Contact not found'));

      const result = await handleDeleteContact({
        action: 'delete',
        id: 'missing',
      });
      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Contact not found');
    });

    it('sanitizes contact ID in script', async () => {
      mockExecuteJxa.mockResolvedValue({ deleted: true, name: 'Test' });

      await handleDeleteContact({
        action: 'delete',
        id: 'abc-123-def',
      });

      const script = mockExecuteJxa.mock.calls[0][0];
      expect(script).toContain('abc-123-def');
    });
  });
});
