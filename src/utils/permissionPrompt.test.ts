/**
 * permissionPrompt.test.ts
 * Tests for AppleScript-based permission prompting
 */

import type { ChildProcess, ExecFileException } from 'node:child_process';
import { execFile } from 'node:child_process';
import {
  hasBeenPrompted,
  resetPromptedDomains,
  triggerPermissionPrompt,
} from './permissionPrompt.js';

type ExecFileCallback =
  | ((
      error: ExecFileException | null,
      stdout: string | Buffer,
      stderr: string | Buffer,
    ) => void)
  | null
  | undefined;

jest.mock('node:child_process');

const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;

describe('permissionPrompt', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetPromptedDomains();
  });

  describe('triggerPermissionPrompt', () => {
    it('triggers AppleScript for reminders permission', async () => {
      mockExecFile.mockImplementation(((
        _command: string,
        _args: readonly string[] | null | undefined,
        callback?: ExecFileCallback,
      ) => {
        callback?.(null, '', '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await triggerPermissionPrompt('reminders');

      expect(mockExecFile).toHaveBeenCalledWith(
        'osascript',
        ['-e', 'tell application "Reminders" to get the name of every list'],
        expect.any(Function),
      );
    });

    it('triggers AppleScript for calendars permission', async () => {
      mockExecFile.mockImplementation(((
        _command: string,
        _args: readonly string[] | null | undefined,
        callback?: ExecFileCallback,
      ) => {
        callback?.(null, '', '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await triggerPermissionPrompt('calendars');

      expect(mockExecFile).toHaveBeenCalledWith(
        'osascript',
        ['-e', 'tell application "Calendar" to get the name of every calendar'],
        expect.any(Function),
      );
    });

    it('skips duplicate prompts for the same domain in a session', async () => {
      mockExecFile.mockImplementation(((
        _command: string,
        _args: readonly string[] | null | undefined,
        callback?: ExecFileCallback,
      ) => {
        callback?.(null, '', '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await triggerPermissionPrompt('reminders');
      await triggerPermissionPrompt('reminders');
      await triggerPermissionPrompt('reminders');

      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });

    it('allows prompts for different domains', async () => {
      mockExecFile.mockImplementation(((
        _command: string,
        _args: readonly string[] | null | undefined,
        callback?: ExecFileCallback,
      ) => {
        callback?.(null, '', '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await triggerPermissionPrompt('reminders');
      await triggerPermissionPrompt('calendars');

      expect(mockExecFile).toHaveBeenCalledTimes(2);
    });

    it('marks domain as prompted even on AppleScript failure', async () => {
      mockExecFile.mockImplementation(((
        _command: string,
        _args: readonly string[] | null | undefined,
        callback?: ExecFileCallback,
      ) => {
        const error = new Error('Permission denied') as ExecFileException;
        callback?.(error, '', '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await triggerPermissionPrompt('reminders');

      expect(hasBeenPrompted('reminders')).toBe(true);
      expect(mockExecFile).toHaveBeenCalledTimes(1);

      // Second call should be skipped
      await triggerPermissionPrompt('reminders');
      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('hasBeenPrompted', () => {
    it('returns false for unprompted domain', () => {
      expect(hasBeenPrompted('reminders')).toBe(false);
      expect(hasBeenPrompted('calendars')).toBe(false);
    });

    it('returns true after domain has been prompted', async () => {
      mockExecFile.mockImplementation(((
        _command: string,
        _args: readonly string[] | null | undefined,
        callback?: ExecFileCallback,
      ) => {
        callback?.(null, '', '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await triggerPermissionPrompt('reminders');

      expect(hasBeenPrompted('reminders')).toBe(true);
      expect(hasBeenPrompted('calendars')).toBe(false);
    });
  });

  describe('resetPromptedDomains', () => {
    it('clears the prompted domains cache', async () => {
      mockExecFile.mockImplementation(((
        _command: string,
        _args: readonly string[] | null | undefined,
        callback?: ExecFileCallback,
      ) => {
        callback?.(null, '', '');
        return {} as ChildProcess;
      }) as unknown as typeof execFile);

      await triggerPermissionPrompt('reminders');
      await triggerPermissionPrompt('calendars');

      expect(hasBeenPrompted('reminders')).toBe(true);
      expect(hasBeenPrompted('calendars')).toBe(true);

      resetPromptedDomains();

      expect(hasBeenPrompted('reminders')).toBe(false);
      expect(hasBeenPrompted('calendars')).toBe(false);
    });
  });
});
