/**
 * jxaExecutor.test.ts
 * Tests for JXA executor utility functions: sanitizeForJxa, buildScript,
 * detectPermissionError, executeJxa, and executeJxaWithRetry.
 */

import type { ExecFileException } from 'node:child_process';
import { execFile } from 'node:child_process';
import {
  buildScript,
  detectPermissionError,
  executeJxa,
  executeJxaWithRetry,
  JxaError,
  sanitizeForJxa,
} from './jxaExecutor.js';

jest.mock('node:child_process');

type ExecFileCallback =
  | ((
      error: ExecFileException | null,
      stdout: string | Buffer,
      stderr: string | Buffer,
    ) => void)
  | null
  | undefined;

const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;

describe('sanitizeForJxa', () => {
  it.each([
    ['path\\to\\file', 'path\\\\to\\\\file', 'backslashes'],
    ["O'Brien", "O\\'Brien", 'single quotes'],
    ['He said "hello"', 'He said \\"hello\\"', 'double quotes'],
    ['`code`', '\\`code\\`', 'backticks'],
    ['$100', '\\$100', 'dollar signs'],
    ['line1\nline2', 'line1\\nline2', 'newlines'],
    ['line1\rline2', 'line1\\rline2', 'carriage returns'],
    ['col1\tcol2', 'col1\\tcol2', 'tabs'],
    ['before\0after', 'beforeafter', 'null bytes'],
    ['text\u2028more', 'text\\u2028more', 'U+2028'],
    ['text\u2029more', 'text\\u2029more', 'U+2029'],
    ['', '', 'empty string'],
    ['Hello 世界 🌍', 'Hello 世界 🌍', 'unicode preservation'],
  ])('escapes %s → %s (%s)', (input, expected) => {
    expect(sanitizeForJxa(input)).toBe(expected);
  });

  it('handles combined special characters', () => {
    const input = `He said "it's $100\\n"`;
    const result = sanitizeForJxa(input);
    expect(result).toContain('\\"');
    expect(result).toContain("\\'");
    expect(result).toContain('\\$');
    expect(result).toContain('\\\\');
  });

  it('handles very long strings without error', () => {
    const longStr = 'a'.repeat(100_000);
    const result = sanitizeForJxa(longStr);
    expect(result.length).toBe(100_000);
  });
});

describe('buildScript', () => {
  it('replaces single placeholder', () => {
    const result = buildScript('Hello {{name}}!', { name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('replaces multiple placeholders', () => {
    const result = buildScript('{{a}} and {{b}}', { a: 'X', b: 'Y' });
    expect(result).toBe('X and Y');
  });

  it('replaces repeated placeholders', () => {
    const result = buildScript('{{x}} + {{x}}', { x: '1' });
    expect(result).toBe('1 + 1');
  });

  it('sanitizes values during replacement', () => {
    const result = buildScript('name: "{{name}}"', { name: "O'Brien" });
    expect(result).toContain("O\\'Brien");
  });

  it('leaves unmatched placeholders intact', () => {
    const result = buildScript('{{a}} {{b}}', { a: 'X' });
    expect(result).toBe('X {{b}}');
  });

  it('handles empty params', () => {
    const result = buildScript('no params here', {});
    expect(result).toBe('no params here');
  });
});

describe('detectPermissionError', () => {
  it('returns JxaError for "not allowed" pattern', () => {
    const err = detectPermissionError('Operation not allowed', 'Notes');
    expect(err).toBeInstanceOf(JxaError);
    expect(err?.isPermissionError).toBe(true);
    expect(err?.app).toBe('Notes');
  });

  it('returns JxaError for "permission" pattern', () => {
    const err = detectPermissionError(
      'User has not given permission',
      'Mail',
    );
    expect(err).toBeInstanceOf(JxaError);
    expect(err?.isPermissionError).toBe(true);
  });

  it('returns JxaError for "not authorized" pattern', () => {
    const err = detectPermissionError(
      'Application is not authorized',
      'Notes',
    );
    expect(err).not.toBeNull();
    expect(err?.isPermissionError).toBe(true);
  });

  it('returns JxaError for "AppleEvent handler failed" pattern', () => {
    const err = detectPermissionError(
      'AppleEvent handler failed',
      'Mail',
    );
    expect(err).not.toBeNull();
  });

  it('returns JxaError for Messages error code 1002', () => {
    const err = detectPermissionError('Error: 1002', 'Messages');
    expect(err).not.toBeNull();
    expect(err?.isPermissionError).toBe(true);
  });

  it('returns null for non-permission errors', () => {
    const err = detectPermissionError('Syntax error in script', 'Notes');
    expect(err).toBeNull();
  });

  it('returns null for empty stderr', () => {
    const err = detectPermissionError('', 'Notes');
    expect(err).toBeNull();
  });

  it('uses Notes patterns as fallback for unknown apps', () => {
    const err = detectPermissionError('not allowed to access', 'UnknownApp');
    expect(err).not.toBeNull();
    expect(err?.isPermissionError).toBe(true);
  });

  it('is case-insensitive for "not allowed"', () => {
    expect(detectPermissionError('NOT ALLOWED', 'Notes')).not.toBeNull();
    expect(detectPermissionError('Not Allowed', 'Notes')).not.toBeNull();
  });

  it('stores original stderr on the JxaError', () => {
    const stderr = 'Some permission denied message';
    const err = detectPermissionError(stderr, 'Notes');
    expect(err?.stderr).toBe(stderr);
  });
});

describe('JxaError', () => {
  it('stores app, isPermissionError, and stderr', () => {
    const err = new JxaError('msg', 'Notes', true, 'stderr text');
    expect(err.name).toBe('JxaError');
    expect(err.message).toBe('msg');
    expect(err.app).toBe('Notes');
    expect(err.isPermissionError).toBe(true);
    expect(err.stderr).toBe('stderr text');
  });

  it('defaults stderr to undefined', () => {
    const err = new JxaError('msg', 'Mail', false);
    expect(err.stderr).toBeUndefined();
  });
});

describe('executeJxa', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: mock returns a child-like object with on()
    mockExecFile.mockImplementation((..._args: unknown[]) => {
      return { on: jest.fn() } as unknown as ReturnType<typeof execFile>;
    });
  });

  it('returns parsed JSON on successful execution', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[3] as ExecFileCallback;
      cb?.(null, '{"result": "ok"}', '');
      return { on: jest.fn() } as unknown as ReturnType<typeof execFile>;
    });

    const result = await executeJxa<{ result: string }>(
      'JSON.stringify({result: "ok"})',
      10000,
      'Notes',
    );
    expect(result).toEqual({ result: 'ok' });
  });

  it('returns undefined for empty stdout', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[3] as ExecFileCallback;
      cb?.(null, '  \n  ', '');
      return { on: jest.fn() } as unknown as ReturnType<typeof execFile>;
    });

    const result = await executeJxa('somescript', 10000, 'Notes');
    expect(result).toBeUndefined();
  });

  it('returns raw string for non-JSON output', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[3] as ExecFileCallback;
      cb?.(null, 'plain text output', '');
      return { on: jest.fn() } as unknown as ReturnType<typeof execFile>;
    });

    const result = await executeJxa<string>('somescript', 10000, 'Notes');
    expect(result).toBe('plain text output');
  });

  it('rejects with JxaError on execution error', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[3] as ExecFileCallback;
      cb?.(new Error('Command failed') as ExecFileException, '', 'syntax error');
      return { on: jest.fn() } as unknown as ReturnType<typeof execFile>;
    });

    await expect(executeJxa('bad script', 10000, 'Notes')).rejects.toThrow(
      /JXA execution failed for Notes/,
    );
  });

  it('rejects with permission JxaError when stderr indicates permission error', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[3] as ExecFileCallback;
      cb?.(
        new Error('failed') as ExecFileException,
        '',
        'not allowed to send Apple events',
      );
      return { on: jest.fn() } as unknown as ReturnType<typeof execFile>;
    });

    try {
      await executeJxa('script', 10000, 'Notes');
      fail('Expected JxaError');
    } catch (err) {
      expect(err).toBeInstanceOf(JxaError);
      expect((err as JxaError).isPermissionError).toBe(true);
    }
  });

  it('rejects when child process emits error event', async () => {
    mockExecFile.mockImplementation((..._args: unknown[]) => {
      const handlers: Record<string, Function> = {};
      const child = {
        on: (event: string, handler: Function) => {
          handlers[event] = handler;
          // Fire error immediately for the 'error' event listener
          if (event === 'error') {
            setTimeout(() => handler(new Error('spawn ENOENT')), 0);
          }
        },
      };
      return child as unknown as ReturnType<typeof execFile>;
    });

    await expect(executeJxa('script', 10000, 'Notes')).rejects.toThrow(
      /Failed to start osascript/,
    );
  });
});

describe('executeJxaWithRetry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns result on first successful attempt', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[3] as ExecFileCallback;
      cb?.(null, '{"ok":true}', '');
      return { on: jest.fn() } as unknown as ReturnType<typeof execFile>;
    });

    const result = await executeJxaWithRetry<{ ok: boolean }>(
      'script',
      10000,
      'Notes',
      2,
      10,
    );
    expect(result).toEqual({ ok: true });
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('retries on transient error and succeeds', async () => {
    let calls = 0;
    mockExecFile.mockImplementation((...args: unknown[]) => {
      calls++;
      const cb = args[3] as ExecFileCallback;
      if (calls === 1) {
        cb?.(
          new Error('connection invalid') as ExecFileException,
          '',
          'connection invalid',
        );
      } else {
        cb?.(null, '{"retried":true}', '');
      }
      return { on: jest.fn() } as unknown as ReturnType<typeof execFile>;
    });

    const result = await executeJxaWithRetry<{ retried: boolean }>(
      'script',
      10000,
      'Notes',
      2,
      10,
    );
    expect(result).toEqual({ retried: true });
    expect(calls).toBe(2);
  });

  it('does not retry permission errors', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[3] as ExecFileCallback;
      cb?.(new Error('failed') as ExecFileException, '', 'not allowed');
      return { on: jest.fn() } as unknown as ReturnType<typeof execFile>;
    });

    try {
      await executeJxaWithRetry('script', 10000, 'Notes', 2, 10);
      fail('Expected permission error');
    } catch (err) {
      expect(err).toBeInstanceOf(JxaError);
      expect((err as JxaError).isPermissionError).toBe(true);
    }
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('throws after max retries exhausted on transient errors', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[3] as ExecFileCallback;
      cb?.(
        new Error('connection invalid') as ExecFileException,
        '',
        'connection invalid',
      );
      return { on: jest.fn() } as unknown as ReturnType<typeof execFile>;
    });

    await expect(
      executeJxaWithRetry('script', 10000, 'Notes', 1, 10),
    ).rejects.toThrow(/JXA execution failed/);
    // 1 initial + 1 retry = 2 calls
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it('throws immediately for non-transient errors', async () => {
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[3] as ExecFileCallback;
      cb?.(
        new Error('syntax error in script') as ExecFileException,
        '',
        'syntax error',
      );
      return { on: jest.fn() } as unknown as ReturnType<typeof execFile>;
    });

    await expect(
      executeJxaWithRetry('script', 10000, 'Notes', 2, 10),
    ).rejects.toThrow(/JXA execution failed/);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });
});
