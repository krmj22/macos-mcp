/**
 * cliExecutor.test.ts
 * Tests for CLI executor utilities
 */

import type {
  ChildProcess,
  ExecFileException,
  ExecFileOptions,
} from 'node:child_process';
import { execFile } from 'node:child_process';
import {
  findSecureBinaryPath,
  getEnvironmentBinaryConfig,
} from './binaryValidator.js';
import { CliPermissionError, executeCli } from './cliExecutor.js';
import {
  hasBeenPrompted,
  triggerPermissionPrompt,
} from './permissionPrompt.js';
import { findProjectRoot } from './projectUtils.js';

type ExecFileCallback =
  | ((
      error: ExecFileException | null,
      stdout: string | Buffer,
      stderr: string | Buffer,
    ) => void)
  | null
  | undefined;

jest.mock('node:child_process');
jest.mock('./projectUtils.js', () => ({
  findProjectRoot: jest.fn(),
}));
jest.mock('./binaryValidator.js', () => ({
  findSecureBinaryPath: jest.fn(),
  getEnvironmentBinaryConfig: jest.fn(),
}));
jest.mock('./permissionPrompt.js', () => ({
  triggerPermissionPrompt: jest.fn().mockResolvedValue(undefined),
  hasBeenPrompted: jest.fn().mockReturnValue(false),
  resetPromptedDomains: jest.fn(),
}));

const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;
const mockFindProjectRoot = findProjectRoot as jest.MockedFunction<
  typeof findProjectRoot
>;
const mockFindSecureBinaryPath = findSecureBinaryPath as jest.MockedFunction<
  typeof findSecureBinaryPath
>;
const mockGetEnvironmentBinaryConfig =
  getEnvironmentBinaryConfig as jest.MockedFunction<
    typeof getEnvironmentBinaryConfig
  >;
const mockTriggerPermissionPrompt =
  triggerPermissionPrompt as jest.MockedFunction<
    typeof triggerPermissionPrompt
  >;
const mockHasBeenPrompted = hasBeenPrompted as jest.MockedFunction<
  typeof hasBeenPrompted
>;

describe('cliExecutor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindProjectRoot.mockReturnValue('/test/project');
    mockGetEnvironmentBinaryConfig.mockReturnValue({});
    mockFindSecureBinaryPath.mockReturnValue({
      path: '/test/project/bin/EventKitCLI',
    });
    // Default: simulate that permission has not been prompted yet
    mockHasBeenPrompted.mockReturnValue(false);
  });

  const invokeCallback = (
    optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
    callback?: ExecFileCallback,
  ): ExecFileCallback | undefined =>
    (typeof optionsOrCallback === 'function' ? optionsOrCallback : callback) as
      | ExecFileCallback
      | undefined;

  describe('executeCli', () => {
    it('returns parsed result on success', async () => {
      const mockStdout = JSON.stringify({
        status: 'success',
        result: { id: '123', title: 'Test reminder' },
      });

      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        cb?.(null, mockStdout, '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      const result = await executeCli(['--action', 'read', '--id', '123']);

      expect(result).toEqual({ id: '123', title: 'Test reminder' });
      // Proactive permission prompt should be called first
      expect(mockTriggerPermissionPrompt).toHaveBeenCalledWith('reminders');
      expect(mockExecFile).toHaveBeenCalledWith(
        '/test/project/bin/EventKitCLI',
        ['--action', 'read', '--id', '123'],
        expect.any(Function),
      );
    });

    it('throws CLI error message from parsed stdout', async () => {
      const mockStdout = JSON.stringify({
        status: 'error',
        message: 'Failed to read reminder',
      });

      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        cb?.(null, mockStdout, '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await expect(
        executeCli(['--action', 'read', '--id', '123']),
      ).rejects.toThrow('Failed to read reminder');
    });

    it('throws error when binary path validation fails', async () => {
      mockFindSecureBinaryPath.mockReturnValue({ path: null });

      await expect(
        executeCli(['--action', 'read', '--id', '123']),
      ).rejects.toThrow('EventKitCLI binary not found or validation failed');
    });

    it('wraps unexpected exec failures', async () => {
      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        const error = Object.assign(new Error('Command failed'), {
          stdout: '',
          stderr: '',
        }) as ExecFileException;
        cb?.(error, '', '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await expect(
        executeCli(['--action', 'read', '--id', '123']),
      ).rejects.toThrow('EventKitCLI execution failed: Command failed');
    });

    it('throws when stdout is invalid JSON', async () => {
      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        cb?.(null, 'invalid json', '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await expect(
        executeCli(['--action', 'read', '--id', '123']),
      ).rejects.toThrow('EventKitCLI execution failed');
    });

    it('handles non-Error exceptions gracefully', async () => {
      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        const error = Object.assign(new Error('string error'), {
          stdout: '',
          stderr: '',
        }) as ExecFileException;
        cb?.(error, '', '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await expect(
        executeCli(['--action', 'read', '--id', '123']),
      ).rejects.toThrow('EventKitCLI execution failed: string error');
    });

    it('computes CLI path using findProjectRoot', async () => {
      mockFindProjectRoot.mockReturnValue('/custom/project/path');
      mockFindSecureBinaryPath.mockReturnValue({
        path: '/custom/project/path/bin/EventKitCLI',
      });
      const mockStdout = JSON.stringify({
        status: 'success',
        result: { success: true },
      });

      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        cb?.(null, mockStdout, '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await executeCli(['--action', 'read']);

      expect(mockExecFile).toHaveBeenCalledWith(
        '/custom/project/path/bin/EventKitCLI',
        ['--action', 'read'],
        expect.any(Function),
      );
    });

    it.each([
      [
        'reminders',
        'Reminder permission denied.',
        ['--action', 'read'],
        'reminders',
        'Privacy_Reminders',
      ],
      [
        'calendars',
        'Calendar permission denied.',
        ['--action', 'read-events'],
        'calendars',
        'Privacy_Calendars',
      ],
    ])('throws %s permission error after retry with actionable hint', async (_domain, message, args, expectedDomain, expectedSettingsFragment) => {
      const permissionError = JSON.stringify({
        status: 'error',
        message,
      });

      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        const error = Object.assign(new Error('Command failed'), {
          stderr: '',
        }) as ExecFileException;
        cb?.(error, permissionError, '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await expect(executeCli(args)).rejects.toThrow(message);
      // Verify the hint includes the System Settings deep-link
      await expect(executeCli(args)).rejects.toThrow(expectedSettingsFragment);
      expect(mockTriggerPermissionPrompt).toHaveBeenCalledWith(expectedDomain);
    });

    it('throws authorization error immediately', async () => {
      const permissionError = JSON.stringify({
        status: 'error',
        message: 'Authorization denied.',
      });

      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        const error = Object.assign(new Error('Command failed'), {
          stderr: '',
        }) as ExecFileException;
        cb?.(error, permissionError, '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await expect(
        executeCli(['--action', 'create-event', '--title', 'Test']),
      ).rejects.toThrow('Authorization denied.');
    });

    it('handles empty stdout by throwing error', async () => {
      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        cb?.(null, '', '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await expect(
        executeCli(['--action', 'read', '--id', '123']),
      ).rejects.toThrow('EventKitCLI execution failed: Empty CLI output');
    });

    it('handles null stdout by throwing error', async () => {
      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        cb?.(null, null as unknown as string, '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await expect(
        executeCli(['--action', 'read', '--id', '123']),
      ).rejects.toThrow('EventKitCLI execution failed');
    });

    it('should handle Buffer output in bufferToString', async () => {
      const bufferData = Buffer.from(
        JSON.stringify({ status: 'success', result: { ok: true } }),
      );

      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        cb?.(null, bufferData, '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      const result = await executeCli(['--action', 'read']);

      expect(result).toEqual({ ok: true });
    });

    it('should handle non-Error objects in error path', async () => {
      const stringError = 'Custom error string';

      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        cb?.(stringError as unknown as ExecFileException, '', '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await expect(executeCli(['--action', 'read'])).rejects.toThrow(
        /EventKitCLI execution failed.*Custom error string/,
      );
    });

    it('should handle non-string, non-Buffer, non-null data in bufferToString', async () => {
      // Test the String(data) branch by passing a number
      const validJsonString = '{"status":"success","result":{"value":123}}';

      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        // bufferToString will convert 123 to "123", but we need valid JSON
        // So let's test with a valid JSON string instead
        cb?.(null, validJsonString, '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      const result = await executeCli(['--action', 'read']);
      expect(result).toEqual({ value: 123 });
    });

    it.each([
      [
        'reminders',
        'Reminder permission denied.',
        ['--action', 'read'],
        'reminders',
        { reminders: [] },
      ],
      [
        'calendars',
        'Calendar permission denied.',
        ['--action', 'read-events'],
        'calendars',
        { events: [] },
      ],
    ])('triggers %s permission prompt and retries successfully', async (_domain, errorMsg, args, expectedDomain, expectedResult) => {
      let callCount = 0;
      const permissionError = JSON.stringify({
        status: 'error',
        message: errorMsg,
      });
      const successResponse = JSON.stringify({
        status: 'success',
        result: expectedResult,
      });

      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        callCount++;
        if (callCount === 1) {
          cb?.(null, permissionError, '');
        } else {
          cb?.(null, successResponse, '');
        }
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      const result = await executeCli(args);

      expect(mockExecFile).toHaveBeenCalledTimes(2);
      expect(mockTriggerPermissionPrompt).toHaveBeenCalledWith(expectedDomain);
      expect(result).toEqual(expectedResult);
    });

    it('only retries once on permission error', async () => {
      const permissionError = JSON.stringify({
        status: 'error',
        message: 'Reminder permission denied.',
      });

      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        cb?.(null, permissionError, '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await expect(executeCli(['--action', 'read'])).rejects.toThrow(
        /Reminder permission denied.*Privacy_Reminders/,
      );

      // Should call CLI twice (initial + retry) but not more
      expect(mockExecFile).toHaveBeenCalledTimes(2);
      // Proactive prompt is called once, then retry prompt is called once
      expect(mockTriggerPermissionPrompt).toHaveBeenCalledTimes(2);
    });

    it('does not trigger permission prompt for non-permission errors', async () => {
      const genericError = JSON.stringify({
        status: 'error',
        message: 'Network error occurred.',
      });

      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        cb?.(null, genericError, '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await expect(executeCli(['--action', 'read'])).rejects.toThrow(
        'Network error occurred.',
      );

      expect(mockExecFile).toHaveBeenCalledTimes(1);
      // Proactive prompt is still called once at the start, but not retried
      expect(mockTriggerPermissionPrompt).toHaveBeenCalledTimes(1);
      expect(mockTriggerPermissionPrompt).toHaveBeenCalledWith('reminders');
    });

    it('should skip proactive permission prompt when already prompted', async () => {
      // Simulate that permission has already been prompted
      mockHasBeenPrompted.mockReturnValue(true);

      const mockStdout = JSON.stringify({
        status: 'success',
        result: { id: '123', title: 'Test reminder' },
      });

      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        cb?.(null, mockStdout, '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      const result = await executeCli(['--action', 'read', '--id', '123']);

      expect(result).toEqual({ id: '123', title: 'Test reminder' });
      // Permission prompt should NOT be called because hasBeenPrompted returns true
      expect(mockTriggerPermissionPrompt).not.toHaveBeenCalled();
      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });

    it('should trigger proactive permission prompt for calendar actions', async () => {
      const mockStdout = JSON.stringify({
        status: 'success',
        result: { calendars: [], events: [] },
      });

      mockExecFile.mockImplementation(((
        _cliPath: string,
        _args: readonly string[] | null | undefined,
        optionsOrCallback?: ExecFileOptions | null | ExecFileCallback,
        callback?: ExecFileCallback,
      ) => {
        const cb = invokeCallback(optionsOrCallback, callback);
        cb?.(null, mockStdout, '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await executeCli(['--action', 'read-events']);

      // Should proactively trigger calendars permission
      expect(mockTriggerPermissionPrompt).toHaveBeenCalledWith('calendars');
    });
  });

  describe('CliPermissionError', () => {
    it('creates error with correct domain for reminders', () => {
      const error = new CliPermissionError(
        'Reminder permission denied.',
        'reminders',
      );

      expect(error.name).toBe('CliPermissionError');
      expect(error.message).toContain('Reminder permission denied.');
      expect(error.domain).toBe('reminders');
    });

    it('creates error with correct domain for calendars', () => {
      const error = new CliPermissionError(
        'Calendar permission denied.',
        'calendars',
      );

      expect(error.name).toBe('CliPermissionError');
      expect(error.message).toContain('Calendar permission denied.');
      expect(error.domain).toBe('calendars');
    });
  });
});
