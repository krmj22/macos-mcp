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

jest.mock('../utils/sqliteMailReader.js', () => ({
  SqliteMailAccessError: class SqliteMailAccessError extends Error {
    isPermissionError: boolean;
    constructor(message: string, isPermissionError: boolean) {
      super(message);
      this.name = 'SqliteMailAccessError';
      this.isPermissionError = isPermissionError;
    }
  },
  listInboxMessages: jest.fn().mockResolvedValue([]),
  searchMessages: jest.fn().mockResolvedValue([]),
  searchBySenderEmails: jest.fn().mockResolvedValue([]),
  getMessageById: jest.fn().mockResolvedValue(null),
  listMailboxMessages: jest.fn().mockResolvedValue([]),
  listMailboxes: jest.fn().mockResolvedValue([]),
  mailDateToISO: jest.fn((ts: number) =>
    ts ? new Date(ts * 1000).toISOString() : '',
  ),
  parseMailboxUrl: jest.fn((url: string) => ({ account: '', mailbox: url })),
}));

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
  ContactSearchError: class ContactSearchError extends Error {
    isTimeout: boolean;
    constructor(message: string, isTimeout: boolean) {
      super(message);
      this.name = 'ContactSearchError';
      this.isTimeout = isTimeout;
    }
  },
  contactResolver: {
    resolveHandle: jest.fn().mockResolvedValue(null),
    resolveBatch: jest.fn().mockResolvedValue(new Map()),
    resolveNameToHandles: jest.fn().mockResolvedValue(null),
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

const mockReadMessagesByHandles = jest.requireMock(
  '../utils/sqliteMessageReader.js',
).readMessagesByHandles as jest.Mock;
const mockResolveNameToHandles = jest.requireMock('../utils/contactResolver.js')
  .contactResolver.resolveNameToHandles as jest.Mock;
const mockResolveBatch = jest.requireMock('../utils/contactResolver.js')
  .contactResolver.resolveBatch as jest.Mock;
const MockContactSearchError = jest.requireMock('../utils/contactResolver.js')
  .ContactSearchError as new (
  message: string,
  isTimeout: boolean,
) => Error & { isTimeout: boolean };

const mockMailGetMessageById = jest.requireMock('../utils/sqliteMailReader.js')
  .getMessageById as jest.Mock;
const mockMailListInboxMessages = jest.requireMock(
  '../utils/sqliteMailReader.js',
).listInboxMessages as jest.Mock;
const mockMailSearchMessages = jest.requireMock('../utils/sqliteMailReader.js')
  .searchMessages as jest.Mock;
const mockMailListMailboxMessages = jest.requireMock(
  '../utils/sqliteMailReader.js',
).listMailboxMessages as jest.Mock;
const mockMailListMailboxes = jest.requireMock('../utils/sqliteMailReader.js')
  .listMailboxes as jest.Mock;

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
  let handleCreateNote: typeof import('./handlers/notesHandlers.js').handleCreateNote;
  let handleDeleteNote: typeof import('./handlers/notesHandlers.js').handleDeleteNote;
  let markdownToHtml: typeof import('./handlers/notesHandlers.js').markdownToHtml;

  beforeAll(async () => {
    const mod = await import('./handlers/notesHandlers.js');
    handleReadNotes = mod.handleReadNotes;
    handleUpdateNote = mod.handleUpdateNote;
    handleReadNotesFolders = mod.handleReadNotesFolders;
    handleCreateNotesFolder = mod.handleCreateNotesFolder;
    handleCreateNote = mod.handleCreateNote;
    handleDeleteNote = mod.handleDeleteNote;
    markdownToHtml = mod.markdownToHtml;
  });

  describe('markdownToHtml', () => {
    // Backward compatibility (plain text passthrough)
    it('converts newlines to <br> between text lines', () => {
      expect(markdownToHtml('Line 1\nLine 2\nLine 3')).toBe(
        'Line 1<br>Line 2<br>Line 3',
      );
    });

    it('handles Windows-style line endings', () => {
      expect(markdownToHtml('Line 1\r\nLine 2\r\nLine 3')).toBe(
        'Line 1<br>Line 2<br>Line 3',
      );
    });

    it('handles bare carriage returns', () => {
      expect(markdownToHtml('Line 1\rLine 2')).toBe('Line 1<br>Line 2');
    });

    it('escapes HTML entities', () => {
      expect(markdownToHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
    });

    it('escapes entities AND converts newlines together', () => {
      expect(markdownToHtml('A & B\nC < D')).toBe('A &amp; B<br>C &lt; D');
    });

    it('returns empty string for empty input', () => {
      expect(markdownToHtml('')).toBe('');
    });

    it('returns empty string for falsy input', () => {
      // biome-ignore lint: test edge case
      expect(markdownToHtml(undefined as any)).toBe('');
    });

    it('passes through plain text without newlines unchanged', () => {
      expect(markdownToHtml('Hello world')).toBe('Hello world');
    });

    it('handles consecutive blank lines', () => {
      expect(markdownToHtml('A\n\n\nB')).toBe('A<br><br>B');
    });

    // Headings
    it('converts # to <h1>', () => {
      expect(markdownToHtml('# Hello')).toBe('<h1>Hello</h1>');
    });

    it('converts ## to <h2>', () => {
      expect(markdownToHtml('## Sub heading')).toBe('<h2>Sub heading</h2>');
    });

    it('converts ### to <h3>', () => {
      expect(markdownToHtml('### Third level')).toBe('<h3>Third level</h3>');
    });

    it('applies inline formatting within headings', () => {
      expect(markdownToHtml('# **Bold** heading')).toBe(
        '<h1><b>Bold</b> heading</h1>',
      );
    });

    it('does not treat # mid-line as heading', () => {
      const result = markdownToHtml('Not a # heading');
      expect(result).not.toContain('<h1>');
      expect(result).toContain('Not a # heading');
    });

    // Inline formatting
    it('converts **bold** to <b>', () => {
      expect(markdownToHtml('This is **bold** text')).toBe(
        'This is <b>bold</b> text',
      );
    });

    it('converts __bold__ to <b>', () => {
      expect(markdownToHtml('This is __bold__ text')).toBe(
        'This is <b>bold</b> text',
      );
    });

    it('converts *italic* to <i>', () => {
      expect(markdownToHtml('This is *italic* text')).toBe(
        'This is <i>italic</i> text',
      );
    });

    it('converts _italic_ to <i>', () => {
      expect(markdownToHtml('This is _italic_ text')).toBe(
        'This is <i>italic</i> text',
      );
    });

    it('converts ~~strikethrough~~ to <s>', () => {
      expect(markdownToHtml('This is ~~gone~~ text')).toBe(
        'This is <s>gone</s> text',
      );
    });

    it('converts `code` to <tt>', () => {
      expect(markdownToHtml('Use `npm install` here')).toBe(
        'Use <tt>npm install</tt> here',
      );
    });

    it('handles mixed inline formatting on same line', () => {
      const result = markdownToHtml('**bold** and *italic* and `code`');
      expect(result).toBe('<b>bold</b> and <i>italic</i> and <tt>code</tt>');
    });

    // Unordered lists
    it('converts - items to <ul><li>', () => {
      expect(markdownToHtml('- Item 1\n- Item 2')).toBe(
        '<ul><li>Item 1</li><li>Item 2</li></ul>',
      );
    });

    it('converts * items to <ul><li>', () => {
      expect(markdownToHtml('* Item A\n* Item B')).toBe(
        '<ul><li>Item A</li><li>Item B</li></ul>',
      );
    });

    it('converts + items to <ul><li>', () => {
      expect(markdownToHtml('+ Item X\n+ Item Y')).toBe(
        '<ul><li>Item X</li><li>Item Y</li></ul>',
      );
    });

    // Ordered lists
    it('converts 1. items to <ol><li>', () => {
      expect(markdownToHtml('1. First\n2. Second')).toBe(
        '<ol><li>First</li><li>Second</li></ol>',
      );
    });

    // List grouping and flushing
    it('groups adjacent list items into single list', () => {
      const result = markdownToHtml('- A\n- B\n- C');
      expect(result).toBe('<ul><li>A</li><li>B</li><li>C</li></ul>');
    });

    it('flushes list when followed by non-list line', () => {
      const result = markdownToHtml('- Item\nParagraph');
      expect(result).toBe('<ul><li>Item</li></ul>Paragraph');
    });

    it('applies inline formatting in list items', () => {
      expect(markdownToHtml('- **Bold** item')).toBe(
        '<ul><li><b>Bold</b> item</li></ul>',
      );
    });

    it('switches from UL to OL when list type changes', () => {
      expect(markdownToHtml('- Bullet\n1. Ordered')).toBe(
        '<ul><li>Bullet</li></ul><ol><li>Ordered</li></ol>',
      );
    });

    // Mixed content
    it('handles heading + paragraph + list', () => {
      const md = '# Title\n\nSome text\n\n- Item 1\n- Item 2';
      const result = markdownToHtml(md);
      expect(result).toContain('<h1>Title</h1>');
      expect(result).toContain('Some text');
      expect(result).toContain('<ul><li>Item 1</li><li>Item 2</li></ul>');
    });

    it('handles paragraph + blank + paragraph', () => {
      const result = markdownToHtml('First para\n\nSecond para');
      expect(result).toBe('First para<br>Second para');
    });

    // Escaping
    it('escapes & in plain text', () => {
      expect(markdownToHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    it('escapes < and > in text', () => {
      expect(markdownToHtml('a < b > c')).toBe('a &lt; b &gt; c');
    });

    it('escapes HTML in headings', () => {
      expect(markdownToHtml('# A & B')).toBe('<h1>A &amp; B</h1>');
    });

    it('escapes HTML in list items', () => {
      expect(markdownToHtml('- A & B')).toBe('<ul><li>A &amp; B</li></ul>');
    });
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
      // Append uses n.plaintext() for length check, n.body() for HTML concat
      expect(script).toContain('n.plaintext()');
      expect(script).toContain('n.body()');
      expect(script).toContain('<br>');
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
      expect(script).toContain('n.body()');
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

  describe('handleCreateNote', () => {
    it('creates a note with title and body', async () => {
      mockExecuteJxa.mockResolvedValue({ id: 'new-note-1', name: 'My Note' });

      const result = await handleCreateNote({
        action: 'create',
        title: 'My Note',
        body: 'Note body content',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Successfully created note');
      expect(getTextContent(result)).toContain('My Note');
      expect(getTextContent(result)).toContain('new-note-1');
    });

    it('creates a note in a specific folder', async () => {
      mockExecuteJxa.mockResolvedValue({ id: 'new-note-2', name: 'Work Note' });

      const result = await handleCreateNote({
        action: 'create',
        title: 'Work Note',
        body: 'Work content',
        folder: 'Work',
      });
      expect(result.isError).toBe(false);
      const script = mockExecuteJxa.mock.calls[0][0];
      expect(script).toContain('Work');
    });

    it('converts newlines to HTML in body', async () => {
      mockExecuteJxa.mockResolvedValue({ id: 'n-html', name: 'Multi Line' });

      await handleCreateNote({
        action: 'create',
        title: 'Multi Line',
        body: 'Line 1\nLine 2\nLine 3',
      });

      const script = mockExecuteJxa.mock.calls[0][0];
      expect(script).toContain('Line 1<br>Line 2<br>Line 3');
      expect(script).not.toContain('Line 1\\nLine 2');
    });

    it('escapes HTML entities in body', async () => {
      mockExecuteJxa.mockResolvedValue({ id: 'n-esc', name: 'Escaped' });

      await handleCreateNote({
        action: 'create',
        title: 'Escaped',
        body: 'a & b < c',
      });

      const script = mockExecuteJxa.mock.calls[0][0];
      expect(script).toContain('a &amp; b &lt; c');
    });

    it('creates a note with minimal fields (title only)', async () => {
      mockExecuteJxa.mockResolvedValue({ id: 'n3', name: 'Title Only' });

      const result = await handleCreateNote({
        action: 'create',
        title: 'Title Only',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Title Only');
    });
  });

  describe('handleDeleteNote', () => {
    it('deletes a note by ID', async () => {
      mockExecuteJxa.mockResolvedValue({ deleted: true });

      const result = await handleDeleteNote({ action: 'delete', id: 'n1' });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Successfully deleted note');
      expect(getTextContent(result)).toContain('n1');
    });

    it('includes note ID in deletion message', async () => {
      mockExecuteJxa.mockResolvedValue({ deleted: true });

      const result = await handleDeleteNote({
        action: 'delete',
        id: 'x-coredata-123',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('x-coredata-123');
    });

    it('returns error when JXA throws', async () => {
      mockExecuteJxa.mockRejectedValue(new Error('Note not found'));

      const result = await handleDeleteNote({
        action: 'delete',
        id: 'missing',
      });
      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Note not found');
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
      mockMailGetMessageById.mockResolvedValue({
        id: 'm1',
        subject: 'Test',
        sender: 'a@b.com',
        senderName: '',
        dateReceived: '2025-01-01',
        read: true,
        mailbox: 'Inbox',
        account: 'Gmail',
        preview: 'Hello preview',
        toRecipients: ['c@d.com'],
        ccRecipients: [],
      });
      // JXA fallback for full content
      mockExecuteJxaWithRetry.mockResolvedValue({
        id: 'm1',
        content: 'Hello full content',
      });

      const result = await handleReadMail({ action: 'read', id: 'm1' });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('### Mail: Test');
    });

    it('lists mailboxes', async () => {
      mockMailListMailboxes.mockResolvedValue([
        {
          name: 'Inbox',
          account: 'Gmail',
          url: 'imap://x/INBOX',
          totalCount: 100,
          unreadCount: 5,
        },
        {
          name: 'Sent',
          account: 'Gmail',
          url: 'imap://x/Sent',
          totalCount: 50,
          unreadCount: 0,
        },
      ]);

      const result = await handleReadMail({ action: 'read', mailbox: '_list' });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Mailboxes');
      expect(getTextContent(result)).toContain('Inbox');
    });

    it('reads from specific mailbox', async () => {
      mockMailListMailboxes.mockResolvedValue([
        {
          name: 'Sent',
          account: 'Gmail',
          url: 'imap://x/Sent',
          totalCount: 50,
          unreadCount: 0,
        },
      ]);
      mockMailListMailboxMessages.mockResolvedValue([
        {
          id: 'm2',
          subject: 'Sent Mail',
          sender: 'me@x.com',
          senderName: '',
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
      mockMailSearchMessages.mockResolvedValue([]);

      const result = await handleReadMail({
        action: 'read',
        search: 'invoice',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Mail matching "invoice"');
    });

    it('lists inbox with pagination', async () => {
      mockMailListInboxMessages.mockResolvedValue([]);

      const result = await handleReadMail({
        action: 'read',
        limit: 10,
        offset: 5,
      });
      expect(result.isError).toBe(false);
    });

    it('falls back gracefully when contact enrichment times out', async () => {
      mockMailListInboxMessages.mockResolvedValue([
        {
          id: 'm1',
          subject: 'Slow enrichment',
          sender: 'slow@example.com',
          senderName: '',
          dateReceived: '2025-01-01',
          read: false,
          mailbox: 'Inbox',
          account: 'Gmail',
          preview: 'Preview text',
          toRecipients: [],
          ccRecipients: [],
        },
      ]);
      // Simulate a slow resolveBatch that never resolves within timeout
      mockResolveBatch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(
                  new Map([['slow@example.com', { fullName: 'Too Late' }]]),
                ),
              10000,
            ),
          ),
      );

      const result = await handleReadMail({ action: 'read' });
      expect(result.isError).toBe(false);
      const text = getTextContent(result);
      // Should show email address (fallback), not "Too Late" (timed out)
      expect(text).toContain('slow@example.com');
    }, 10000);

    it('shows senderName when enrichment returns empty and senderName is populated', async () => {
      mockMailListInboxMessages.mockResolvedValue([
        {
          id: 'm1',
          subject: 'Fallback test',
          sender: 'someone@example.com',
          senderName: 'Someone Display',
          dateReceived: '2025-01-01',
          read: false,
          mailbox: 'Inbox',
          account: 'Gmail',
          preview: 'Preview',
          toRecipients: [],
          ccRecipients: [],
        },
      ]);
      // Enrichment returns empty map (no match found)
      mockResolveBatch.mockResolvedValue(new Map());

      const result = await handleReadMail({ action: 'read' });
      expect(result.isError).toBe(false);
      const text = getTextContent(result);
      // Should fall back to senderName (3-level: fullName → senderName → sender)
      expect(text).toContain('Someone Display');
    });

    it('shows raw email when enrichment returns empty and senderName is empty', async () => {
      mockMailListInboxMessages.mockResolvedValue([
        {
          id: 'm1',
          subject: 'Raw fallback',
          sender: 'raw@example.com',
          senderName: '',
          dateReceived: '2025-01-01',
          read: false,
          mailbox: 'Inbox',
          account: 'Gmail',
          preview: 'Preview',
          toRecipients: [],
          ccRecipients: [],
        },
      ]);
      mockResolveBatch.mockResolvedValue(new Map());

      const result = await handleReadMail({ action: 'read' });
      expect(result.isError).toBe(false);
      const text = getTextContent(result);
      // Should fall back to raw email (senderName empty, fullName empty)
      expect(text).toContain('raw@example.com');
    });

    it('caps enrichment at MAX_ENRICHMENT_ADDRESSES (20)', async () => {
      // Create 25 messages with unique senders
      const messages = Array.from({ length: 25 }, (_, i) => ({
        id: `m${i}`,
        subject: `Mail ${i}`,
        sender: `sender${i}@example.com`,
        senderName: '',
        dateReceived: '2025-01-01',
        read: false,
        mailbox: 'Inbox',
        account: 'Gmail',
        preview: '',
        toRecipients: [],
        ccRecipients: [],
      }));
      mockMailListInboxMessages.mockResolvedValue(messages);
      mockResolveBatch.mockResolvedValue(new Map());

      await handleReadMail({ action: 'read' });

      // resolveBatch should receive at most 20 addresses
      expect(mockResolveBatch).toHaveBeenCalledTimes(1);
      expect(mockResolveBatch.mock.calls[0][0].length).toBeLessThanOrEqual(20);
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
      // JXA returns full content for reply
      mockExecuteJxaWithRetry.mockResolvedValue({
        id: 'm1',
        content: 'Original body',
      });
      // SQLite returns metadata for reply header
      mockMailGetMessageById.mockResolvedValue({
        id: 'm1',
        subject: 'Original',
        sender: 'a@b.com',
        senderName: '',
        dateReceived: '2025-01-01',
        read: true,
        mailbox: 'Inbox',
        account: 'Gmail',
        preview: '',
        toRecipients: ['me@x.com'],
        ccRecipients: [],
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

    it('returns empty chat list from SQLite gracefully', async () => {
      mockListChats.mockResolvedValue([]);

      const result = await handleReadMessages({ action: 'read' });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('No chats found');
    });

    it('handles contact search with resolved handles', async () => {
      mockResolveNameToHandles.mockResolvedValue({
        phones: ['+15551234567'],
        emails: ['john@test.com'],
      });
      mockReadMessagesByHandles.mockResolvedValue([
        {
          id: 'msg1',
          text: 'Hello from John',
          sender: '+15551234567',
          date: '2025-01-01T12:00:00.000Z',
          isFromMe: false,
          chatId: 'c1',
          chatName: 'John',
        },
      ]);

      const result = await handleReadMessages({
        action: 'read',
        contact: 'John',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Messages from contact "John"');
      expect(getTextContent(result)).toContain('Hello from John');
      expect(mockReadMessagesByHandles).toHaveBeenCalledWith(
        ['+15551234567', 'john@test.com'],
        50,
        undefined,
      );
    });

    it('handles contact with no handles found', async () => {
      mockResolveNameToHandles.mockResolvedValue({
        phones: [],
        emails: [],
      });

      const result = await handleReadMessages({
        action: 'read',
        contact: 'Ghost',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain(
        'No contact found matching "Ghost"',
      );
    });

    it('handles contact resolver returning null', async () => {
      mockResolveNameToHandles.mockResolvedValue(null);

      const result = await handleReadMessages({
        action: 'read',
        contact: 'Nobody',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain(
        'No contact found matching "Nobody"',
      );
    });

    it('handles ContactSearchError with timeout', async () => {
      mockResolveNameToHandles.mockRejectedValue(
        new MockContactSearchError('Contacts timed out', true),
      );

      const result = await handleReadMessages({
        action: 'read',
        contact: 'Slow',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Contact search timed out');
    });

    it('handles ContactSearchError without timeout', async () => {
      mockResolveNameToHandles.mockRejectedValue(
        new MockContactSearchError('JXA failed', false),
      );

      const result = await handleReadMessages({
        action: 'read',
        contact: 'Broken',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Contact search failed');
    });

    it('enriches chat participants with contact names', async () => {
      const resolvedMap = new Map();
      resolvedMap.set('+15551234567', { fullName: 'John Doe' });
      mockResolveBatch.mockResolvedValue(resolvedMap);
      mockListChats.mockResolvedValue([
        {
          id: 'c1',
          name: '+15551234567',
          participants: ['+15551234567'],
          lastMessage: 'Hi',
          lastDate: '2025-01-01',
        },
      ]);

      const result = await handleReadMessages({ action: 'read' });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('John Doe');
    });

    it('enriches message senders with contact names', async () => {
      const resolvedMap = new Map();
      resolvedMap.set('+15559876543', { fullName: 'Alice Wonder' });
      mockResolveBatch.mockResolvedValue(resolvedMap);
      mockReadChatMessages.mockResolvedValue([
        {
          id: 'msg1',
          text: 'Hello',
          sender: '+15559876543',
          date: '2025-01-01',
          isFromMe: false,
        },
      ]);

      const result = await handleReadMessages({
        action: 'read',
        chatId: 'c1',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Alice Wonder');
    });

    it('falls back to raw handle when chat list enrichment times out', async () => {
      mockListChats.mockResolvedValue([
        {
          id: 'c1',
          name: '+15559999999',
          participants: ['+15559999999'],
          lastMessage: 'Hi',
          lastDate: '2025-01-01',
        },
      ]);
      // Simulate slow resolveBatch that exceeds the 5s timeout
      mockResolveBatch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(new Map([['+15559999999', { fullName: 'Too Late' }]])),
              10000,
            ),
          ),
      );

      const result = await handleReadMessages({ action: 'read' });
      expect(result.isError).toBe(false);
      const text = getTextContent(result);
      // Should show raw phone number (timeout fallback), not "Too Late"
      expect(text).toContain('+15559999999');
      expect(text).not.toContain('Too Late');
    }, 10000);

    it('falls back to raw handle when chatId message enrichment times out', async () => {
      mockReadChatMessages.mockResolvedValue([
        {
          id: 'msg1',
          text: 'Hello',
          sender: '+15558888888',
          date: '2025-01-01',
          isFromMe: false,
        },
      ]);
      mockResolveBatch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(new Map([['+15558888888', { fullName: 'Too Late' }]])),
              10000,
            ),
          ),
      );

      const result = await handleReadMessages({ action: 'read', chatId: 'c1' });
      expect(result.isError).toBe(false);
      const text = getTextContent(result);
      expect(text).toContain('+15558888888');
      expect(text).not.toContain('Too Late');
    }, 10000);

    it('falls back to raw handle when search message enrichment times out', async () => {
      mockSearchMessages.mockResolvedValue([
        {
          chatId: 'c1',
          chatName: 'Chat',
          id: 'msg1',
          text: 'match',
          sender: '+15557777777',
          date: '2025-01-01',
          isFromMe: false,
        },
      ]);
      mockResolveBatch.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve(new Map([['+15557777777', { fullName: 'Too Late' }]])),
              10000,
            ),
          ),
      );

      const result = await handleReadMessages({
        action: 'read',
        search: 'match',
        searchMessages: true,
      });
      expect(result.isError).toBe(false);
      const text = getTextContent(result);
      expect(text).toContain('+15557777777');
      expect(text).not.toContain('Too Late');
    }, 10000);

    it('caps enrichment at MAX_ENRICHMENT_HANDLES (20) for messages', async () => {
      // Create 25 messages from unique non-isFromMe senders
      const messages = Array.from({ length: 25 }, (_, i) => ({
        id: `msg${i}`,
        text: `Message ${i}`,
        sender: `+1555000${String(i).padStart(4, '0')}`,
        date: '2025-01-01',
        isFromMe: false,
      }));
      mockReadChatMessages.mockResolvedValue(messages);
      mockResolveBatch.mockResolvedValue(new Map());

      await handleReadMessages({ action: 'read', chatId: 'c1' });

      expect(mockResolveBatch).toHaveBeenCalledTimes(1);
      expect(mockResolveBatch.mock.calls[0][0].length).toBeLessThanOrEqual(20);
    });

    it('only enriches non-isFromMe, non-unknown senders', async () => {
      mockReadChatMessages.mockResolvedValue([
        {
          id: 'msg1',
          text: 'From me',
          sender: '+1111',
          date: '2025-01-01',
          isFromMe: true,
        },
        {
          id: 'msg2',
          text: 'Unknown',
          sender: 'unknown',
          date: '2025-01-01',
          isFromMe: false,
        },
        {
          id: 'msg3',
          text: 'Real sender',
          sender: '+15551234567',
          date: '2025-01-01',
          isFromMe: false,
        },
        {
          id: 'msg4',
          text: 'Another',
          sender: '+15559876543',
          date: '2025-01-01',
          isFromMe: false,
        },
      ]);
      mockResolveBatch.mockResolvedValue(new Map());

      await handleReadMessages({ action: 'read', chatId: 'c1' });

      // Only the two non-isFromMe, non-unknown senders should be enriched
      expect(mockResolveBatch).toHaveBeenCalledTimes(1);
      const handles = mockResolveBatch.mock.calls[0][0];
      expect(handles).toContain('+15551234567');
      expect(handles).toContain('+15559876543');
      expect(handles).not.toContain('+1111');
      expect(handles).not.toContain('unknown');
    });

    it('skips enrichment when enrichContacts is false', async () => {
      mockListChats.mockResolvedValue([
        {
          id: 'c1',
          name: '+15551234567',
          participants: ['+15551234567'],
          lastMessage: 'Hi',
          lastDate: '2025-01-01',
        },
      ]);

      await handleReadMessages({
        action: 'read',
        enrichContacts: false,
      });
      expect(mockResolveBatch).not.toHaveBeenCalled();
    });

    it('handles SQLite non-permission error on chatId path', async () => {
      mockReadChatMessages.mockRejectedValue(
        new MockSqliteAccessError('database is locked', false),
      );

      const result = await handleReadMessages({
        action: 'read',
        chatId: 'c1',
      });
      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('database is locked');
    });

    it('handles SQLite permission error on search messages path', async () => {
      mockSearchMessages.mockRejectedValue(
        new MockSqliteAccessError('authorization denied', true),
      );

      const result = await handleReadMessages({
        action: 'read',
        search: 'test',
        searchMessages: true,
      });
      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Full Disk Access');
    });

    it('handles SQLite permission error on readMessagesByHandles path', async () => {
      mockResolveNameToHandles.mockResolvedValue({
        phones: ['+15551234567'],
        emails: [],
      });
      mockReadMessagesByHandles.mockRejectedValue(
        new MockSqliteAccessError('authorization denied', true),
      );

      const result = await handleReadMessages({
        action: 'read',
        contact: 'John',
      });
      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Full Disk Access');
    });

    it('re-throws non-ContactSearchError from contact resolver', async () => {
      mockResolveNameToHandles.mockRejectedValue(new Error('unexpected'));

      const result = await handleReadMessages({
        action: 'read',
        contact: 'Broken',
      });
      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('unexpected');
    });
  });

  describe('handleCreateMessage', () => {
    let handleCreateMessage: typeof import('./handlers/messagesHandlers.js').handleCreateMessage;

    beforeAll(async () => {
      const mod = await import('./handlers/messagesHandlers.js');
      handleCreateMessage = mod.handleCreateMessage;
    });

    it('sends message to chat via JXA', async () => {
      mockExecuteJxa.mockResolvedValue({ sent: true });

      const result = await handleCreateMessage({
        action: 'create',
        chatId: 'iMessage;-;+1234',
        text: 'Hello!',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain('Successfully sent message');
      expect(mockExecuteJxa).toHaveBeenCalled();
    });

    it('sends message to phone/email via AppleScript', async () => {
      const mockExecuteAppleScript = jest.requireMock('../utils/jxaExecutor.js')
        .executeAppleScript as jest.Mock;
      mockExecuteAppleScript.mockResolvedValue('');

      const result = await handleCreateMessage({
        action: 'create',
        to: '+15551234567',
        text: 'Hello!',
      });
      expect(result.isError).toBe(false);
      expect(getTextContent(result)).toContain(
        'Successfully sent message to +15551234567',
      );
      expect(mockExecuteAppleScript).toHaveBeenCalled();
    });

    it('errors when neither to nor chatId provided', async () => {
      const result = await handleCreateMessage({
        action: 'create',
        text: 'Hello!',
      });
      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('"to" or "chatId" is required');
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

describe('JXA malformed response handling', () => {
  let handleReadNotes: typeof import('./handlers/notesHandlers.js').handleReadNotes;

  beforeAll(async () => {
    const mod = await import('./handlers/notesHandlers.js');
    handleReadNotes = mod.handleReadNotes;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handles non-JSON response from JXA gracefully', async () => {
    mockExecuteJxaWithRetry.mockResolvedValue('not valid json string');

    const result = await handleReadNotes({ action: 'read', id: 'n1' });
    // Should not crash — the handler receives the raw string value
    expect(result.isError).toBe(false);
  });

  it('handles undefined response from JXA', async () => {
    mockExecuteJxaWithRetry.mockResolvedValue(undefined);

    const result = await handleReadNotes({ action: 'read', id: 'missing' });
    expect(getTextContent(result)).toContain('not found');
  });

  it('handles empty array response from JXA', async () => {
    mockExecuteJxaWithRetry.mockResolvedValue([]);

    const result = await handleReadNotes({ action: 'read' });
    expect(result.isError).toBe(false);
    expect(getTextContent(result)).toContain('No notes found');
  });
});

describe('Error logging integration', () => {
  let handleReadNotes: typeof import('./handlers/notesHandlers.js').handleReadNotes;

  beforeAll(async () => {
    const mod = await import('./handlers/notesHandlers.js');
    handleReadNotes = mod.handleReadNotes;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns isError true for JXA permission errors', async () => {
    const { JxaError } = jest.requireActual(
      '../utils/jxaExecutor.js',
    ) as typeof import('../utils/jxaExecutor.js');
    mockExecuteJxaWithRetry.mockRejectedValue(
      new JxaError('Notes not allowed', 'Notes', true, 'not allowed'),
    );

    const result = await handleReadNotes({ action: 'read' });
    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain('not allowed');
  });

  it('returns isError true for JXA timeout errors', async () => {
    mockExecuteJxaWithRetry.mockRejectedValue(
      new Error('JXA execution failed for Notes: timed out'),
    );

    const result = await handleReadNotes({ action: 'read' });
    expect(result.isError).toBe(true);
    expect(getTextContent(result)).toContain('timed out');
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
