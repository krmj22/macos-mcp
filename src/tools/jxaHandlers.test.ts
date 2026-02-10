/**
 * jxaHandlers.test.ts
 * Tests for JXA-based handlers: Notes, Mail, Messages (Issues 1-5)
 */

// Mock jxaExecutor - only mock OS calls, use real sanitizeForJxa/buildScript
jest.mock('../utils/jxaExecutor.js', () => {
  const actual = jest.requireActual('../utils/jxaExecutor.js');
  return {
    ...actual,
    executeJxa: jest.fn(),
    executeJxaWithRetry: jest.fn(),
    executeAppleScript: jest.fn(),
  };
});

jest.mock('../utils/sqliteMessageReader.js', () => ({
  SqliteAccessError: class SqliteAccessError extends Error {
    isPermissionError: boolean;
    constructor(message: string, isPermissionError: boolean) {
      super(message);
      this.name = 'SqliteAccessError';
      this.isPermissionError = isPermissionError;
    }
  },
  readChatMessages: jest.fn().mockResolvedValue([]),
  searchMessages: jest.fn().mockResolvedValue([]),
  listChats: jest.fn().mockResolvedValue([]),
  readMessagesByHandles: jest.fn().mockResolvedValue([]),
}));

jest.mock('../utils/errorHandling.js', () => ({
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

// Mock contactResolver for mail sender enrichment tests
jest.mock('../utils/contactResolver.js', () => ({
  contactResolver: {
    resolveHandle: jest.fn().mockResolvedValue(null),
    resolveBatch: jest.fn().mockResolvedValue(new Map()),
  },
}));

const mockExecuteJxa = jest.requireMock('../utils/jxaExecutor.js')
  .executeJxa as jest.Mock;
const mockExecuteJxaWithRetry = jest.requireMock('../utils/jxaExecutor.js')
  .executeJxaWithRetry as jest.Mock;
const mockListChats = jest.requireMock('../utils/sqliteMessageReader.js')
  .listChats as jest.Mock;
const mockReadChatMessages = jest.requireMock('../utils/sqliteMessageReader.js')
  .readChatMessages as jest.Mock;
const mockSearchMessages = jest.requireMock('../utils/sqliteMessageReader.js')
  .searchMessages as jest.Mock;
const MockSqliteAccessError = jest.requireMock(
  '../utils/sqliteMessageReader.js',
).SqliteAccessError as new (
  message: string,
  isPermissionError: boolean,
) => Error & { isPermissionError: boolean };

// biome-ignore lint: test helper
function getTextContent(result: any): string {
  return result.content[0].text;
}

describe('Notes Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  let handleReadNotes: typeof import('./handlers/notesHandlers.js').handleReadNotes;
  let handleUpdateNote: typeof import('./handlers/notesHandlers.js').handleUpdateNote;
  let handleReadNotesFolders: typeof import('./handlers/notesHandlers.js').handleReadNotesFolders;
  let handleCreateNotesFolder: typeof import('./handlers/notesHandlers.js').handleCreateNotesFolder;

  beforeAll(async () => {
    const mod = await import('./handlers/notesHandlers.js');
    handleReadNotes = mod.handleReadNotes;
    handleUpdateNote = mod.handleUpdateNote;
    handleReadNotesFolders = mod.handleReadNotesFolders;
    handleCreateNotesFolder = mod.handleCreateNotesFolder;
  });

  describe('handleReadNotes', () => {
    it('returns single note by ID', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue({
        id: 'n1',
        name: 'Test Note',
        body: 'Hello',
        folder: 'Notes',
        creationDate: '2025-01-01',
        modificationDate: '2025-01-02',
      });

      const result = await handleReadNotes({ action: 'read', id: 'n1' });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('### Note: Test Note');
      expect(getTextContent(result)).toContain('Hello');
    });

    it('returns "not found" when note missing', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue(null);

      const result = await handleReadNotes({ action: 'read', id: 'missing' });
      expect(getTextContent(result)).toBe('Note not found.');
    });

    it('lists notes with pagination', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue([
        {
          id: 'n1',
          name: 'Note 1',
          body: '',
          folder: 'Notes',
          creationDate: '',
          modificationDate: '2025-01-01',
        },
      ]);

      const result = await handleReadNotes({
        action: 'read',
        limit: 10,
        offset: 0,
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Note 1');
    });

    it('filters notes by folder', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue([
        {
          id: 'n2',
          name: 'Work Note',
          body: '',
          folder: 'Work',
          creationDate: '',
          modificationDate: '',
        },
      ]);

      const result = await handleReadNotes({ action: 'read', folder: 'Work' });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Notes in "Work"');
    });

    it('searches notes', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue([
        {
          id: 'n3',
          name: 'Found',
          body: 'match',
          folder: 'Notes',
          creationDate: '',
          modificationDate: '',
        },
      ]);

      const result = await handleReadNotes({ action: 'read', search: 'match' });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Notes matching "match"');
    });

    it('sanitizes apostrophes in search (prevents double-escape)', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue([]);

      await handleReadNotes({ action: 'read', search: "O'Brien" });

      const script = mockExecuteJxaWithRetry.mock.calls[0][0];
      expect(script).toContain("O\\'Brien");
      expect(script).not.toContain("O\\\\'Brien");
    });

    it('sanitizes backslashes in search', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue([]);

      await handleReadNotes({ action: 'read', search: 'path\\to\\file' });

      const script = mockExecuteJxaWithRetry.mock.calls[0][0];
      expect(script).toContain('path\\\\to\\\\file');
    });
  });

  describe('handleUpdateNote', () => {
    it('updates note body with full replace (default behavior)', async () => {
      mockExecuteJxa.mockResolvedValue({
        id: 'n1',
        name: 'Test Note',
        folder: 'Notes',
      });

      const result = await handleUpdateNote({
        action: 'update',
        id: 'n1',
        body: 'New content',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Successfully updated note');
      expect(getTextContent(result)).not.toContain('(appended)');

      const script = mockExecuteJxa.mock.calls[0][0];
      // Full replace uses hasBody flag, not plaintext()
      expect(script).toContain('"true"');
      expect(script).toContain('New content');
      expect(script).not.toContain('plaintext()');
    });

    it('appends body when append=true', async () => {
      mockExecuteJxa.mockResolvedValue({
        id: 'n1',
        name: 'Test Note',
        folder: 'Notes',
      });

      const result = await handleUpdateNote({
        action: 'update',
        id: 'n1',
        body: 'Appended content',
        append: true,
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Successfully updated note');
      expect(getTextContent(result)).toContain('(appended)');

      const script = mockExecuteJxa.mock.calls[0][0];
      // Append mode uses n.plaintext() to read existing content
      expect(script).toContain('n.plaintext()');
      expect(script).toContain('Appended content');
      // Should check combined length against max
      expect(script).toContain('2000');
    });

    it('ignores append=true when body is not provided', async () => {
      mockExecuteJxa.mockResolvedValue({
        id: 'n1',
        name: 'Test Note',
        folder: 'Notes',
      });

      const result = await handleUpdateNote({
        action: 'update',
        id: 'n1',
        title: 'New Title',
        append: true,
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).not.toContain('(appended)');

      const script = mockExecuteJxa.mock.calls[0][0];
      // Should NOT use append script when no body provided
      expect(script).not.toContain('plaintext()');
    });

    it('uses full replace when append=false', async () => {
      mockExecuteJxa.mockResolvedValue({
        id: 'n1',
        name: 'Test Note',
        folder: 'Notes',
      });

      await handleUpdateNote({
        action: 'update',
        id: 'n1',
        body: 'Replaced content',
        append: false,
      });

      const script = mockExecuteJxa.mock.calls[0][0];
      expect(script).not.toContain('plaintext()');
      expect(script).toContain('Replaced content');
    });

    it('sanitizes user input in append mode', async () => {
      mockExecuteJxa.mockResolvedValue({
        id: 'n1',
        name: 'Test Note',
        folder: 'Notes',
      });

      await handleUpdateNote({
        action: 'update',
        id: 'n1',
        body: 'O\'Brien\'s "notes"',
        append: true,
      });

      const script = mockExecuteJxa.mock.calls[0][0];
      // Verify sanitization happened (quotes escaped)
      expect(script).toContain("O\\'Brien\\'s");
      expect(script).toContain('\\"notes\\"');
    });

    it('supports append with targetFolder move', async () => {
      mockExecuteJxa.mockResolvedValue({
        id: 'n1',
        name: 'Test Note',
        folder: 'Work',
      });

      const result = await handleUpdateNote({
        action: 'update',
        id: 'n1',
        body: 'More content',
        append: true,
        targetFolder: 'Work',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('(appended)');
      expect(getTextContent(result)).toContain('Folder: Work');

      const script = mockExecuteJxa.mock.calls[0][0];
      expect(script).toContain('plaintext()');
      expect(script).toContain('targetFolder');
    });
  });

  describe('handleReadNotesFolders', () => {
    it('lists folders', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue([
        { name: 'Notes', noteCount: 5 },
        { name: 'Work', noteCount: 3 },
      ]);

      const result = await handleReadNotesFolders({ action: 'read' });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Note Folders');
      expect(getTextContent(result)).toContain('Notes');
      expect(getTextContent(result)).toContain('Work');
    });
  });

  describe('handleCreateNotesFolder', () => {
    it('creates a folder', async () => {
      mockExecuteJxa.mockResolvedValue({ name: 'New Folder' });

      const result = await handleCreateNotesFolder({
        action: 'create',
        name: 'New Folder',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Successfully created folder');
    });
  });
});

describe('Mail Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  let handleReadMail: typeof import('./handlers/mailHandlers.js').handleReadMail;
  let handleCreateMail: typeof import('./handlers/mailHandlers.js').handleCreateMail;
  let handleUpdateMail: typeof import('./handlers/mailHandlers.js').handleUpdateMail;
  let handleDeleteMail: typeof import('./handlers/mailHandlers.js').handleDeleteMail;

  beforeAll(async () => {
    const mod = await import('./handlers/mailHandlers.js');
    handleReadMail = mod.handleReadMail;
    handleCreateMail = mod.handleCreateMail;
    handleUpdateMail = mod.handleUpdateMail;
    handleDeleteMail = mod.handleDeleteMail;
  });

  describe('handleReadMail', () => {
    it('returns single mail by ID', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue({
        id: 'm1',
        subject: 'Test',
        sender: 'a@b.com',
        dateReceived: '2025-01-01',
        read: true,
        mailbox: 'Inbox',
        account: 'Gmail',
        content: 'Hello',
        toRecipients: ['c@d.com'],
        ccRecipients: [],
        preview: '',
      });

      const result = await handleReadMail({ action: 'read', id: 'm1' });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('### Mail: Test');
    });

    it('lists mailboxes', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue([
        { name: 'Inbox', account: 'Gmail', unreadCount: 5 },
        { name: 'Sent', account: 'Gmail', unreadCount: 0 },
      ]);

      const result = await handleReadMail({ action: 'read', mailbox: '_list' });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Mailboxes');
      expect(getTextContent(result)).toContain('Inbox');
    });

    it('reads from specific mailbox', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue([
        {
          id: 'm2',
          subject: 'Sent Mail',
          sender: 'me@x.com',
          dateReceived: '',
          read: true,
          mailbox: 'Sent',
          account: 'Gmail',
          preview: '',
        },
      ]);

      const result = await handleReadMail({ action: 'read', mailbox: 'Sent' });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Mailbox: Sent');
    });

    it('searches mail including body', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue([]);

      const result = await handleReadMail({
        action: 'read',
        search: 'invoice',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Mail matching "invoice"');
    });

    it('lists inbox with pagination', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue([]);

      const result = await handleReadMail({
        action: 'read',
        limit: 10,
        offset: 5,
      });
      expect(result.isError).toBe(false);
    });
  });

  describe('handleCreateMail', () => {
    it('sends with cc and bcc', async () => {
      mockExecuteJxa.mockResolvedValue({ sent: true });

      const result = await handleCreateMail({
        action: 'create',
        subject: 'Test',
        body: 'Body',
        to: ['a@b.com'],
        cc: ['c@d.com'],
        bcc: ['e@f.com'],
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Successfully drafted mail');
    });

    it('sends a reply', async () => {
      mockExecuteJxaWithRetry.mockResolvedValue({
        id: 'm1',
        subject: 'Original',
        sender: 'a@b.com',
        dateReceived: '2025-01-01',
        read: true,
        mailbox: 'Inbox',
        account: 'Gmail',
        content: 'Original body',
        toRecipients: ['me@x.com'],
        ccRecipients: [],
        preview: '',
      });
      mockExecuteJxa.mockResolvedValue({ sent: true });

      const result = await handleCreateMail({
        action: 'create',
        subject: 'Reply',
        body: 'Thanks',
        to: ['a@b.com'],
        replyToId: 'm1',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Re: Original');
    });

    it('sanitizes newlines in body', async () => {
      mockExecuteJxa.mockResolvedValue({ sent: true });

      await handleCreateMail({
        action: 'create',
        subject: 'Test',
        body: 'Line1\nLine2',
        to: ['test@example.com'],
      });

      const script = mockExecuteJxa.mock.calls[0][0];
      expect(script).toContain('Line1\\nLine2');
    });

    it('sanitizes quotes in subject', async () => {
      mockExecuteJxa.mockResolvedValue({ sent: true });

      await handleCreateMail({
        action: 'create',
        subject: 'He said "hello"',
        body: 'Body',
        to: ['test@example.com'],
      });

      const script = mockExecuteJxa.mock.calls[0][0];
      expect(script).toContain('He said \\"hello\\"');
    });
  });

  describe('handleUpdateMail', () => {
    it('marks message as read', async () => {
      mockExecuteJxa.mockResolvedValue({ updated: true });

      const result = await handleUpdateMail({
        action: 'update',
        id: 'm1',
        read: true,
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('marked message as read');
    });

    it('marks message as unread', async () => {
      mockExecuteJxa.mockResolvedValue({ updated: true });

      const result = await handleUpdateMail({
        action: 'update',
        id: 'm1',
        read: false,
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('marked message as unread');
    });
  });

  describe('handleDeleteMail', () => {
    it('deletes a message', async () => {
      mockExecuteJxa.mockResolvedValue({ deleted: true });

      const result = await handleDeleteMail({ action: 'delete', id: 'm1' });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Successfully deleted');
    });
  });
});

describe('Messages Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  let handleReadMessages: typeof import('./handlers/messagesHandlers.js').handleReadMessages;

  beforeAll(async () => {
    const mod = await import('./handlers/messagesHandlers.js');
    handleReadMessages = mod.handleReadMessages;
  });

  describe('handleReadMessages', () => {
    it('lists chats via SQLite', async () => {
      mockListChats.mockResolvedValue([
        {
          id: 'c1',
          name: 'John',
          participants: ['+1234'],
          lastMessage: 'Hi',
          lastDate: '2025-01-01',
        },
      ]);

      const result = await handleReadMessages({ action: 'read' });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Chats');
      expect(getTextContent(result)).toContain('John');
      expect(mockListChats).toHaveBeenCalledWith(50, 0, undefined, undefined);
    });

    it('reads chat messages via SQLite', async () => {
      mockReadChatMessages.mockResolvedValue([
        {
          id: 'msg1',
          text: 'Hello',
          sender: '+1234',
          date: '2025-01-01',
          isFromMe: false,
        },
      ]);

      const result = await handleReadMessages({ action: 'read', chatId: 'c1' });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Hello');
      expect(mockReadChatMessages).toHaveBeenCalledWith('c1', 50, 0, undefined);
    });

    it('reports error when SQLite fails with permission error', async () => {
      mockListChats.mockRejectedValue(
        new MockSqliteAccessError('DB access denied', true),
      );

      const result = await handleReadMessages({ action: 'read' });
      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Full Disk Access');
    });

    it('searches chats by name via SQLite', async () => {
      mockListChats.mockResolvedValue([
        {
          id: 'c1',
          name: 'John',
          participants: ['+1234'],
          lastMessage: '',
          lastDate: '',
        },
      ]);

      const result = await handleReadMessages({
        action: 'read',
        search: 'John',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Chats matching "John"');
      // Verify search param was passed to listChats
      expect(mockListChats).toHaveBeenCalledWith(50, 0, undefined, 'John');
    });

    it('searches messages by content via SQLite', async () => {
      mockSearchMessages.mockResolvedValue([
        {
          chatId: 'c1',
          chatName: 'John',
          id: 'msg1',
          text: 'meet at 5',
          sender: '+1234',
          date: '2025-01-01',
          isFromMe: false,
        },
      ]);

      const result = await handleReadMessages({
        action: 'read',
        search: 'meet',
        searchMessages: true,
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Messages matching "meet"');
      expect(getTextContent(result)).toContain('John');
      expect(mockSearchMessages).toHaveBeenCalledWith('meet', 50, undefined);
    });

    it('does not use JXA for any read operations', async () => {
      mockListChats.mockResolvedValue([]);

      await handleReadMessages({ action: 'read' });
      // JXA executeJxaWithRetry should never be called for reads
      expect(mockExecuteJxaWithRetry).not.toHaveBeenCalled();
    });

    it('passes date range to readChatMessages when filtering by chatId with dates', async () => {
      mockReadChatMessages.mockResolvedValue([
        {
          id: 'msg1',
          text: 'Hello',
          sender: '+1234',
          date: '2025-01-15T12:00:00.000Z',
          isFromMe: false,
        },
      ]);

      const result = await handleReadMessages({
        action: 'read',
        chatId: 'c1',
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Hello');
      expect(mockReadChatMessages).toHaveBeenCalledWith('c1', 50, 0, {
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      });
    });

    it('passes date range to searchMessages when searching with dates', async () => {
      mockSearchMessages.mockResolvedValue([
        {
          id: 'msg1',
          text: 'meeting notes',
          sender: '+1234',
          date: '2025-01-15T12:00:00.000Z',
          isFromMe: false,
          chatId: 'c1',
          chatName: 'Work',
        },
      ]);

      const result = await handleReadMessages({
        action: 'read',
        search: 'meeting',
        searchMessages: true,
        startDate: '2025-01-01',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('meeting notes');
      expect(mockSearchMessages).toHaveBeenCalledWith('meeting', 50, {
        startDate: '2025-01-01',
        endDate: undefined,
      });
    });

    it('passes no date range when no dates specified (chatId path)', async () => {
      mockReadChatMessages.mockResolvedValue([
        {
          id: 'msg1',
          text: 'Hello',
          sender: '+1234',
          date: '2025-01-01',
          isFromMe: false,
        },
      ]);

      await handleReadMessages({
        action: 'read',
        chatId: 'c1',
      });
      expect(mockReadChatMessages).toHaveBeenCalledWith('c1', 50, 0, undefined);
    });

    it('resolves dateRange shortcut to date filter for chatId path', async () => {
      mockReadChatMessages.mockResolvedValue([
        {
          id: 'msg1',
          text: 'Today msg',
          sender: '+1234',
          date: '2025-06-01T12:00:00.000Z',
          isFromMe: false,
        },
      ]);

      const result = await handleReadMessages({
        action: 'read',
        chatId: 'c1',
        dateRange: 'today',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Today msg');
      expect(mockReadChatMessages).toHaveBeenCalledWith(
        'c1',
        50,
        0,
        expect.objectContaining({
          startDate: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
          ),
          endDate: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
          ),
        }),
      );
    });

    it('explicit startDate/endDate take precedence over dateRange', async () => {
      mockReadChatMessages.mockResolvedValue([
        {
          id: 'msg1',
          text: 'Explicit range msg',
          sender: '+1234',
          date: '2025-01-15T12:00:00.000Z',
          isFromMe: false,
        },
      ]);

      const result = await handleReadMessages({
        action: 'read',
        chatId: 'c1',
        dateRange: 'today',
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      });
      expect(result.isError).toBe(false);
      expect(mockReadChatMessages).toHaveBeenCalledWith('c1', 50, 0, {
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      });
    });

    it('resolves dateRange for search path', async () => {
      mockSearchMessages.mockResolvedValue([
        {
          id: 'msg1',
          text: 'search result',
          sender: '+1234',
          date: '2025-06-01T12:00:00.000Z',
          isFromMe: false,
          chatId: 'c1',
          chatName: 'Work',
        },
      ]);

      const result = await handleReadMessages({
        action: 'read',
        search: 'meeting',
        searchMessages: true,
        dateRange: 'last_7_days',
      });
      expect(result.isError).toBe(false);
      expect(mockSearchMessages).toHaveBeenCalledWith(
        'meeting',
        50,
        expect.objectContaining({
          startDate: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
          ),
          endDate: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
          ),
        }),
      );
    });

    it('passes date range to listChats on default path with startDate/endDate', async () => {
      mockListChats.mockResolvedValue([
        {
          id: 'iMessage;-;+1234567890',
          name: 'Jane Doe',
          participants: ['+1234567890'],
          lastMessage: 'Recent chat',
          lastDate: '2025-01-15T12:00:00.000Z',
        },
      ]);

      const result = await handleReadMessages({
        action: 'read',
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Chats');
      expect(getTextContent(result)).toContain('Jane Doe');
      expect(mockListChats).toHaveBeenCalledWith(
        50,
        0,
        {
          startDate: '2025-01-01',
          endDate: '2025-01-31',
        },
        undefined,
      );
    });

    it('passes dateRange shortcut to listChats on default path', async () => {
      mockListChats.mockResolvedValue([
        {
          id: 'chat1',
          name: 'Bob',
          participants: ['bob@example.com'],
          lastMessage: 'Today msg',
          lastDate: '2025-06-01T10:00:00.000Z',
        },
      ]);

      const result = await handleReadMessages({
        action: 'read',
        dateRange: 'today',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Bob');
      expect(mockListChats).toHaveBeenCalledWith(
        50,
        0,
        expect.objectContaining({
          startDate: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
          ),
          endDate: expect.stringMatching(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
          ),
        }),
        undefined,
      );
    });

    it('returns empty list when no chats match date filter on default path', async () => {
      mockListChats.mockResolvedValue([]);

      const result = await handleReadMessages({
        action: 'read',
        startDate: '2020-01-01',
        endDate: '2020-01-31',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('No chats found');
      expect(mockListChats).toHaveBeenCalledWith(
        50,
        0,
        {
          startDate: '2020-01-01',
          endDate: '2020-01-31',
        },
        undefined,
      );
    });

    it('passes no date range to listChats when no dates specified', async () => {
      mockListChats.mockResolvedValue([
        {
          id: 'c1',
          name: 'John',
          participants: ['+1234'],
          lastMessage: 'Hi',
          lastDate: '2025-01-01',
        },
      ]);

      await handleReadMessages({ action: 'read' });
      expect(mockListChats).toHaveBeenCalledWith(50, 0, undefined, undefined);
    });

    it('explicit dates take precedence over dateRange on default path', async () => {
      mockListChats.mockResolvedValue([
        {
          id: 'chat1',
          name: 'Alice',
          participants: ['alice@example.com'],
          lastMessage: 'Hello',
          lastDate: '2025-01-15T12:00:00.000Z',
        },
      ]);

      await handleReadMessages({
        action: 'read',
        dateRange: 'today',
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      });
      expect(mockListChats).toHaveBeenCalledWith(
        50,
        0,
        {
          startDate: '2025-01-01',
          endDate: '2025-01-31',
        },
        undefined,
      );
    });
  });
});

describe('resolveDateRange', () => {
  let resolveDateRange: typeof import('./handlers/messagesHandlers.js').resolveDateRange;

  beforeAll(async () => {
    const mod = await import('./handlers/messagesHandlers.js');
    resolveDateRange = mod.resolveDateRange;
  });

  it('returns startDate at midnight and endDate at now for "today"', () => {
    const before = new Date();
    const result = resolveDateRange('today');
    const after = new Date();

    // startDate should be midnight today (local time)
    expect(result.startDate).toMatch(/^\d{4}-\d{2}-\d{2} 00:00:00$/);

    // endDate should be close to "now"
    const endParts = result.endDate.match(
      /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
    );
    expect(endParts).not.toBeNull();
    const endDate = new Date(
      Number(endParts?.[1]),
      Number(endParts?.[2]) - 1,
      Number(endParts?.[3]),
      Number(endParts?.[4]),
      Number(endParts?.[5]),
      Number(endParts?.[6]),
    );
    expect(endDate.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(endDate.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it('returns yesterday midnight to today midnight for "yesterday"', () => {
    const result = resolveDateRange('yesterday');
    const now = new Date();
    const todayMidnight = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} 00:00:00`;
    expect(result.endDate).toBe(todayMidnight);

    // startDate should be one day before todayMidnight
    const yesterdayDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 1,
    );
    const expectedStart = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getDate()).padStart(2, '0')} 00:00:00`;
    expect(result.startDate).toBe(expectedStart);
  });

  it('returns Monday midnight as start for "this_week"', () => {
    const result = resolveDateRange('this_week');

    // Parse startDate
    const parts = result.startDate.match(/^(\d{4})-(\d{2})-(\d{2}) 00:00:00$/);
    expect(parts).not.toBeNull();
    const startDate = new Date(
      Number(parts?.[1]),
      Number(parts?.[2]) - 1,
      Number(parts?.[3]),
    );
    // getDay() should be Monday (1)
    expect(startDate.getDay()).toBe(1);
  });

  it('returns 7 days ago for "last_7_days"', () => {
    const result = resolveDateRange('last_7_days');
    const now = new Date();
    const sevenDaysAgo = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 7,
    );
    const expectedStart = `${sevenDaysAgo.getFullYear()}-${String(sevenDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(sevenDaysAgo.getDate()).padStart(2, '0')} 00:00:00`;
    expect(result.startDate).toBe(expectedStart);
  });

  it('returns 30 days ago for "last_30_days"', () => {
    const result = resolveDateRange('last_30_days');
    const now = new Date();
    const thirtyDaysAgo = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 30,
    );
    const expectedStart = `${thirtyDaysAgo.getFullYear()}-${String(thirtyDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(thirtyDaysAgo.getDate()).padStart(2, '0')} 00:00:00`;
    expect(result.startDate).toBe(expectedStart);
  });

  it('produces dates in YYYY-MM-DD HH:mm:ss format', () => {
    for (const range of [
      'today',
      'yesterday',
      'this_week',
      'last_7_days',
      'last_30_days',
    ] as const) {
      const result = resolveDateRange(range);
      expect(result.startDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(result.endDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
  });

  it('uses local timezone (startDate year matches current year)', () => {
    const result = resolveDateRange('today');
    const now = new Date();
    expect(result.startDate).toContain(String(now.getFullYear()));
  });
});

describe('Retry Logic (executeJxaWithRetry)', () => {
  it('is exported and callable', async () => {
    await jest.isolateModulesAsync(async () => {
      const { executeJxaWithRetry } = await import('../utils/jxaExecutor.js');
      expect(typeof executeJxaWithRetry).toBe('function');
    });
  });
});

describe('Error Handling - JXA hints', () => {
  it('provides timeout hint for JxaError', async () => {
    // Use requireActual to bypass module-level mocks
    const { handleAsyncOperation } = jest.requireActual(
      '../utils/errorHandling.js',
    ) as typeof import('../utils/errorHandling.js');
    const { JxaError } = jest.requireActual(
      '../utils/jxaExecutor.js',
    ) as typeof import('../utils/jxaExecutor.js');

    const result = await handleAsyncOperation(async () => {
      throw new JxaError('timed out', 'Notes', false, 'osascript timed out');
    }, 'read notes');

    expect(result.isError).toBe(true);
    expect(result.content[0]).toHaveProperty('type', 'text');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(text).toContain('did not respond in time');
  });
});

describe('Shared Formatting', () => {
  let formatListMarkdown: typeof import('./handlers/shared.js').formatListMarkdown;

  beforeAll(async () => {
    const mod = await import('./handlers/shared.js');
    formatListMarkdown = mod.formatListMarkdown;
  });

  it('shows total count without pagination', () => {
    const result = formatListMarkdown(
      'Items',
      ['a', 'b'],
      (item) => [`- ${item}`],
      'None',
    );
    expect(result).toContain('Total: 2');
  });

  it('shows range header with pagination', () => {
    const result = formatListMarkdown(
      'Items',
      ['a', 'b'],
      (item) => [`- ${item}`],
      'None',
      { offset: 10, limit: 2 },
    );
    expect(result).toContain('Showing 11–12');
  });

  it('shows total count when not at pagination boundary', () => {
    const result = formatListMarkdown(
      'Items',
      ['a'],
      (item) => [`- ${item}`],
      'None',
      { offset: 0, limit: 50 },
    );
    expect(result).toContain('Total: 1');
  });

  it('shows empty message when no items', () => {
    const result = formatListMarkdown('Items', [], () => [], 'Nothing here');
    expect(result).toContain('Nothing here');
  });
});

describe('Schema Validation', () => {
  let ReadNotesSchema: typeof import('../validation/schemas.js').ReadNotesSchema;
  let UpdateNoteSchema: typeof import('../validation/schemas.js').UpdateNoteSchema;
  let ReadMailSchema: typeof import('../validation/schemas.js').ReadMailSchema;
  let ReadMessagesSchema: typeof import('../validation/schemas.js').ReadMessagesSchema;
  let CreateMailSchema: typeof import('../validation/schemas.js').CreateMailSchema;
  let UpdateMailSchema: typeof import('../validation/schemas.js').UpdateMailSchema;
  let DeleteMailSchema: typeof import('../validation/schemas.js').DeleteMailSchema;
  let CreateNotesFolderSchema: typeof import('../validation/schemas.js').CreateNotesFolderSchema;

  beforeAll(async () => {
    const mod = await import('../validation/schemas.js');
    ReadNotesSchema = mod.ReadNotesSchema;
    UpdateNoteSchema = mod.UpdateNoteSchema;
    ReadMailSchema = mod.ReadMailSchema;
    ReadMessagesSchema = mod.ReadMessagesSchema;
    CreateMailSchema = mod.CreateMailSchema;
    UpdateMailSchema = mod.UpdateMailSchema;
    DeleteMailSchema = mod.DeleteMailSchema;
    CreateNotesFolderSchema = mod.CreateNotesFolderSchema;
  });

  describe('Pagination fields', () => {
    it('ReadNotesSchema defaults limit to 50 and offset to 0', () => {
      const result = ReadNotesSchema.parse({});
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(0);
    });

    it('ReadMailSchema accepts custom limit/offset', () => {
      const result = ReadMailSchema.parse({ limit: 10, offset: 5 });
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(5);
    });

    it('ReadMessagesSchema accepts search and searchMessages', () => {
      const result = ReadMessagesSchema.parse({
        search: 'test',
        searchMessages: true,
      });
      expect(result.search).toBe('test');
      expect(result.searchMessages).toBe(true);
    });

    it('rejects limit > 200', () => {
      expect(() => ReadNotesSchema.parse({ limit: 201 })).toThrow();
    });

    it('rejects limit < 1', () => {
      expect(() => ReadNotesSchema.parse({ limit: 0 })).toThrow();
    });
  });

  describe('Mail schemas', () => {
    it('CreateMailSchema accepts cc/bcc/replyToId', () => {
      const result = CreateMailSchema.parse({
        subject: 'Test',
        body: 'Body',
        to: ['a@b.com'],
        cc: ['c@d.com'],
        bcc: ['e@f.com'],
        replyToId: 'msg123',
      });
      expect(result.cc).toEqual(['c@d.com']);
      expect(result.bcc).toEqual(['e@f.com']);
      expect(result.replyToId).toBe('msg123');
    });

    it('UpdateMailSchema requires id and read', () => {
      const result = UpdateMailSchema.parse({ id: 'm1', read: true });
      expect(result.id).toBe('m1');
      expect(result.read).toBe(true);
    });

    it('UpdateMailSchema rejects missing read', () => {
      expect(() => UpdateMailSchema.parse({ id: 'm1' })).toThrow();
    });

    it('DeleteMailSchema requires id', () => {
      expect(() => DeleteMailSchema.parse({})).toThrow();
    });

    it('ReadMailSchema accepts mailbox and account', () => {
      const result = ReadMailSchema.parse({
        mailbox: 'Sent',
        account: 'Gmail',
      });
      expect(result.mailbox).toBe('Sent');
      expect(result.account).toBe('Gmail');
    });

    it('ReadMailSchema defaults enrichContacts to true', () => {
      const result = ReadMailSchema.parse({});
      expect(result.enrichContacts).toBe(true);
    });

    it('ReadMailSchema accepts enrichContacts: false', () => {
      const result = ReadMailSchema.parse({ enrichContacts: false });
      expect(result.enrichContacts).toBe(false);
    });
  });

  describe('UpdateNoteSchema with append', () => {
    it('accepts append=true with body', () => {
      const result = UpdateNoteSchema.parse({
        id: 'n1',
        body: 'New content',
        append: true,
      });
      expect(result.append).toBe(true);
      expect(result.body).toBe('New content');
    });

    it('accepts append=false', () => {
      const result = UpdateNoteSchema.parse({
        id: 'n1',
        body: 'Replaced',
        append: false,
      });
      expect(result.append).toBe(false);
    });

    it('defaults append to undefined when omitted', () => {
      const result = UpdateNoteSchema.parse({
        id: 'n1',
        body: 'Content',
      });
      expect(result.append).toBeUndefined();
    });

    it('accepts append without body (no-op for append)', () => {
      const result = UpdateNoteSchema.parse({
        id: 'n1',
        append: true,
      });
      expect(result.append).toBe(true);
      expect(result.body).toBeUndefined();
    });
  });

  describe('Notes folder schemas', () => {
    it('CreateNotesFolderSchema requires name', () => {
      expect(() => CreateNotesFolderSchema.parse({})).toThrow();
    });

    it('CreateNotesFolderSchema accepts valid name', () => {
      const result = CreateNotesFolderSchema.parse({ name: 'Work' });
      expect(result.name).toBe('Work');
    });
  });

  describe('Notes read with folder', () => {
    it('ReadNotesSchema accepts folder filter', () => {
      const result = ReadNotesSchema.parse({ folder: 'Work' });
      expect(result.folder).toBe('Work');
    });
  });

  describe('Messages date filtering schemas', () => {
    it('ReadMessagesSchema accepts startDate and endDate', () => {
      const result = ReadMessagesSchema.parse({
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      });
      expect(result.startDate).toBe('2025-01-01');
      expect(result.endDate).toBe('2025-01-31');
    });

    it('ReadMessagesSchema accepts ISO 8601 dates', () => {
      const result = ReadMessagesSchema.parse({
        startDate: '2025-01-01T00:00:00Z',
        endDate: '2025-01-31T23:59:59Z',
      });
      expect(result.startDate).toBe('2025-01-01T00:00:00Z');
      expect(result.endDate).toBe('2025-01-31T23:59:59Z');
    });

    it('ReadMessagesSchema accepts local datetime format', () => {
      const result = ReadMessagesSchema.parse({
        startDate: '2025-01-01 09:00:00',
      });
      expect(result.startDate).toBe('2025-01-01 09:00:00');
    });

    it('ReadMessagesSchema allows omitting both dates', () => {
      const result = ReadMessagesSchema.parse({});
      expect(result.startDate).toBeUndefined();
      expect(result.endDate).toBeUndefined();
    });

    it('ReadMessagesSchema allows only startDate', () => {
      const result = ReadMessagesSchema.parse({
        startDate: '2025-06-01',
      });
      expect(result.startDate).toBe('2025-06-01');
      expect(result.endDate).toBeUndefined();
    });

    it('ReadMessagesSchema allows only endDate', () => {
      const result = ReadMessagesSchema.parse({
        endDate: '2025-06-30',
      });
      expect(result.startDate).toBeUndefined();
      expect(result.endDate).toBe('2025-06-30');
    });

    it('ReadMessagesSchema accepts dateRange shortcut', () => {
      const result = ReadMessagesSchema.parse({ dateRange: 'today' });
      expect(result.dateRange).toBe('today');
    });

    it('ReadMessagesSchema accepts all dateRange values', () => {
      for (const value of [
        'today',
        'yesterday',
        'this_week',
        'last_7_days',
        'last_30_days',
      ]) {
        const result = ReadMessagesSchema.parse({ dateRange: value });
        expect(result.dateRange).toBe(value);
      }
    });

    it('ReadMessagesSchema rejects invalid dateRange value', () => {
      expect(() =>
        ReadMessagesSchema.parse({ dateRange: 'next_month' }),
      ).toThrow();
    });

    it('ReadMessagesSchema allows dateRange with startDate/endDate', () => {
      const result = ReadMessagesSchema.parse({
        dateRange: 'today',
        startDate: '2025-06-01',
        endDate: '2025-06-30',
      });
      expect(result.dateRange).toBe('today');
      expect(result.startDate).toBe('2025-06-01');
      expect(result.endDate).toBe('2025-06-30');
    });

    it('ReadMessagesSchema rejects invalid date format', () => {
      expect(() =>
        ReadMessagesSchema.parse({ startDate: 'not-a-date' }),
      ).toThrow();
    });

    it('ReadMessagesSchema accepts dates with chatId', () => {
      const result = ReadMessagesSchema.parse({
        chatId: 'iMessage;-;+1234',
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      });
      expect(result.chatId).toBe('iMessage;-;+1234');
      expect(result.startDate).toBe('2025-01-01');
    });

    it('ReadMessagesSchema accepts dates with search and searchMessages', () => {
      const result = ReadMessagesSchema.parse({
        search: 'hello',
        searchMessages: true,
        startDate: '2025-01-01',
      });
      expect(result.search).toBe('hello');
      expect(result.searchMessages).toBe(true);
      expect(result.startDate).toBe('2025-01-01');
    });
  });
});
