/**
 * logging.test.ts
 * Tests for structured logging utilities
 */

import { logToolError } from './logging.js';

describe('logToolError', () => {
  let stderrSpy: jest.SpyInstance;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDebug = process.env.DEBUG;

  beforeEach(() => {
    stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    delete process.env.DEBUG;
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.env.NODE_ENV = originalNodeEnv;
    if (originalDebug !== undefined) {
      process.env.DEBUG = originalDebug;
    } else {
      delete process.env.DEBUG;
    }
  });

  it('logs Error instances with tool name and args', () => {
    const error = new Error('JXA timeout');

    logToolError('messages_chat', { action: 'read', chatId: 'abc' }, error);

    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const logEntry = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(logEntry.level).toBe('error');
    expect(logEntry.event).toBe('tool_execution_error');
    expect(logEntry.tool).toBe('messages_chat');
    expect(logEntry.args).toEqual({ action: 'read', chatId: 'abc' });
    expect(logEntry.error).toBe('JXA timeout');
    expect(logEntry.errorType).toBe('Error');
    expect(logEntry.timestamp).toBeDefined();
  });

  it('logs string errors', () => {
    logToolError('reminders_tasks', { action: 'create' }, 'Something failed');

    const logEntry = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(logEntry.error).toBe('Something failed');
    expect(logEntry.errorType).toBeUndefined();
  });

  it('logs unknown error types', () => {
    logToolError('notes_items', { action: 'read' }, { code: 42 });

    const logEntry = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(logEntry.error).toBe('Unknown error');
  });

  it('handles undefined args', () => {
    logToolError('calendar_calendars', undefined, new Error('fail'));

    const logEntry = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(logEntry.args).toBeUndefined();
    expect(logEntry.tool).toBe('calendar_calendars');
  });

  it('handles null args', () => {
    logToolError('mail_messages', null, new Error('fail'));

    const logEntry = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(logEntry.args).toBeNull();
  });

  it('sanitizes text field in args to avoid logging message content', () => {
    logToolError(
      'messages_chat',
      {
        action: 'create',
        text: 'Hello this is a private message',
        chatId: 'c1',
      },
      new Error('send failed'),
    );

    const logEntry = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(logEntry.args.text).toBe('[31 chars]');
    expect(logEntry.args.chatId).toBe('c1');
    expect(logEntry.args.action).toBe('create');
  });

  it('omits stack trace in production mode', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DEBUG;
    const error = new Error('production error');

    logToolError('reminders_tasks', { action: 'read' }, error);

    const logEntry = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(logEntry.stack).toBeUndefined();
  });

  it('includes stack trace in development mode', () => {
    process.env.NODE_ENV = 'development';
    const error = new Error('dev error');

    logToolError('reminders_tasks', { action: 'read' }, error);

    const logEntry = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(logEntry.stack).toBeDefined();
    expect(logEntry.stack).toContain('dev error');
  });

  it('includes stack trace when DEBUG is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEBUG = '1';
    const error = new Error('debug error');

    logToolError('reminders_tasks', { action: 'read' }, error);

    const logEntry = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(logEntry.stack).toBeDefined();
    expect(logEntry.stack).toContain('debug error');
  });

  it('preserves custom error class names in errorType', () => {
    class SqliteAccessError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'SqliteAccessError';
      }
    }
    const error = new SqliteAccessError('permission denied');

    logToolError('messages_chat', { action: 'read' }, error);

    const logEntry = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(logEntry.errorType).toBe('SqliteAccessError');
  });

  it('outputs valid JSON terminated with newline', () => {
    logToolError('contacts_people', { action: 'read' }, new Error('test'));

    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output.endsWith('\n')).toBe(true);
    // Should not throw
    JSON.parse(output);
  });
});
