/**
 * errorHandling.test.ts
 * Tests for error handling utilities
 */

import { ValidationError } from '../validation/schemas.js';
import {
  createCliPermissionHint,
  createFdaHint,
  handleAsyncOperation,
  SYSTEM_SETTINGS,
} from './errorHandling.js';
import { JxaError } from './jxaExecutor.js';

describe('ErrorHandling', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('handleAsyncOperation', () => {
    it('should return success response on successful operation', async () => {
      const mockOperation = jest.fn().mockResolvedValue('Success message');

      const result = await handleAsyncOperation(
        mockOperation,
        'test operation',
      );

      expect(mockOperation).toHaveBeenCalled();
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Success message' }],
        isError: false,
      });
    });

    it('should return error response on failed operation', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValue(new Error('Operation failed'));

      const result = await handleAsyncOperation(
        mockOperation,
        'test operation',
      );

      expect(mockOperation).toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.content[0]).toHaveProperty('type', 'text');
      expect(
        (result.content[0] as { type: 'text'; text: string }).text,
      ).toContain('Failed to test operation');
    });

    it('should handle ValidationError specially', async () => {
      const validationError = new ValidationError('Validation failed', {
        field1: ['Required field'],
      });

      const mockOperation = jest.fn().mockRejectedValue(validationError);

      const result = await handleAsyncOperation(mockOperation, 'validate');

      expect(result.isError).toBe(true);
      expect(result.content[0]).toHaveProperty('type', 'text');
      expect((result.content[0] as { type: 'text'; text: string }).text).toBe(
        'Validation failed',
      );
    });

    it.each([
      ['create reminder', 'Failed to create reminder'],
      ['update reminder', 'Failed to update reminder'],
      ['delete reminder', 'Failed to delete reminder'],
    ])('should format error message for "%s"', async (operationName, expectedText) => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Failed'));

      const result = await handleAsyncOperation(mockOperation, operationName);

      expect(result.content[0]).toHaveProperty('type', 'text');
      expect(
        (result.content[0] as { type: 'text'; text: string }).text,
      ).toContain(expectedText);
    });

    it('should show detailed error in development mode', async () => {
      process.env.NODE_ENV = 'development';

      const mockOperation = jest
        .fn()
        .mockRejectedValue(new Error('Detailed error'));

      const result = await handleAsyncOperation(
        mockOperation,
        'test operation',
      );

      expect(result.content[0]).toHaveProperty('type', 'text');
      expect((result.content[0] as { type: 'text'; text: string }).text).toBe(
        'Failed to test operation: Detailed error',
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('should show Error.message in production mode', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalDebug = process.env.DEBUG;
      delete process.env.DEBUG;
      process.env.NODE_ENV = 'production';

      const mockOperation = jest
        .fn()
        .mockRejectedValue(new Error('Detailed error'));

      const result = await handleAsyncOperation(
        mockOperation,
        'test operation',
      );

      expect(result.content[0]).toHaveProperty('type', 'text');
      expect((result.content[0] as { type: 'text'; text: string }).text).toBe(
        'Failed to test operation: Detailed error',
      );

      process.env.NODE_ENV = originalNodeEnv;
      if (originalDebug) process.env.DEBUG = originalDebug;
    });

    it.each([
      ['String error', 'string error'],
      [{ code: 'ERROR' }, { code: 'ERROR' }],
    ])('should handle non-Error exceptions: %s', async (errorValue, _description) => {
      const mockOperation = jest.fn().mockRejectedValue(errorValue);

      const result = await handleAsyncOperation(
        mockOperation,
        'test operation',
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]).toHaveProperty('type', 'text');
      expect((result.content[0] as { type: 'text'; text: string }).text).toBe(
        'Failed to test operation: System error occurred',
      );
    });

    it('should show Error.message regardless of DEBUG env', async () => {
      process.env.DEBUG = '1';
      process.env.NODE_ENV = 'production';

      const mockOperation = jest
        .fn()
        .mockRejectedValue(new Error('Debug error'));

      const result = await handleAsyncOperation(
        mockOperation,
        'test operation',
      );

      expect(result.content[0]).toHaveProperty('type', 'text');
      expect((result.content[0] as { type: 'text'; text: string }).text).toBe(
        'Failed to test operation: Debug error',
      );

      delete process.env.DEBUG;
      process.env.NODE_ENV = originalEnv;
    });

    it('should never leak stack traces', async () => {
      process.env.NODE_ENV = 'production';

      const error = new Error('Something broke');
      error.stack =
        'Error: Something broke\n    at Object.<anonymous> (/app/src/handlers.ts:42:11)';
      const mockOperation = jest.fn().mockRejectedValue(error);

      const result = await handleAsyncOperation(
        mockOperation,
        'test operation',
      );

      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toBe('Failed to test operation: Something broke');
      expect(text).not.toContain('at Object');
      expect(text).not.toContain('.ts:');
      expect(text).not.toContain('handlers');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('JxaError hints', () => {
    it('provides timeout hint when JxaError message contains "timed out"', async () => {
      const result = await handleAsyncOperation(async () => {
        throw new JxaError('timed out', 'Notes', false, 'osascript timed out');
      }, 'read notes');
      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('did not respond in time');
    });

    it('provides connection invalid hint', async () => {
      const result = await handleAsyncOperation(async () => {
        throw new JxaError(
          'connection invalid',
          'Mail',
          false,
          'connection invalid',
        );
      }, 'read mail');
      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Lost connection to Mail');
    });

    it('provides not running hint for "not running" pattern', async () => {
      const result = await handleAsyncOperation(async () => {
        throw new JxaError('not running', 'Notes', false);
      }, 'read notes');
      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('does not appear to be running');
    });

    it('provides not running hint for "Can\'t get application" pattern', async () => {
      const result = await handleAsyncOperation(async () => {
        throw new JxaError("Can't get application", 'Notes', false);
      }, 'read notes');
      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('does not appear to be running');
    });

    it('falls back to generic message for unrecognized JxaError', async () => {
      const result = await handleAsyncOperation(async () => {
        throw new JxaError('syntax error', 'Notes', false, 'some stderr');
      }, 'read notes');
      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('Failed to');
      expect(text).toContain('syntax error');
      expect(text).not.toContain('did not respond');
      expect(text).not.toContain('Lost connection');
    });

    it('provides permission hint when JxaError contains "not authorized"', async () => {
      const result = await handleAsyncOperation(async () => {
        throw new JxaError('not authorized', 'Contacts', false, 'not authorized to send Apple events');
      }, 'read contacts');
      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('automation permission denied');
      expect(text).toContain('Automation');
      expect(text).toContain(SYSTEM_SETTINGS.AUTOMATION);
    });

    it('provides permission hint when JxaError contains "permission"', async () => {
      const result = await handleAsyncOperation(async () => {
        throw new JxaError('permission denied', 'Mail', false);
      }, 'read mail');
      expect(result.isError).toBe(true);
      const text = (result.content[0] as { type: 'text'; text: string }).text;
      expect(text).toContain('automation permission denied');
      expect(text).toContain(SYSTEM_SETTINGS.AUTOMATION);
    });
  });

  describe('SYSTEM_SETTINGS constants', () => {
    it('contains all required deep-link URLs', () => {
      expect(SYSTEM_SETTINGS.AUTOMATION).toContain('Privacy_Automation');
      expect(SYSTEM_SETTINGS.FULL_DISK_ACCESS).toContain('Privacy_AllFiles');
      expect(SYSTEM_SETTINGS.REMINDERS).toContain('Privacy_Reminders');
      expect(SYSTEM_SETTINGS.CALENDARS).toContain('Privacy_Calendars');
      expect(SYSTEM_SETTINGS.CONTACTS).toContain('Privacy_Contacts');
    });
  });

  describe('createCliPermissionHint', () => {
    it('returns reminders hint with correct settings URL', () => {
      const hint = createCliPermissionHint('reminders');
      expect(hint).toContain('Reminders');
      expect(hint).toContain(SYSTEM_SETTINGS.REMINDERS);
    });

    it('returns calendars hint with correct settings URL', () => {
      const hint = createCliPermissionHint('calendars');
      expect(hint).toContain('Calendars');
      expect(hint).toContain(SYSTEM_SETTINGS.CALENDARS);
    });
  });

  describe('createFdaHint', () => {
    it('returns FDA hint with database name and settings URL', () => {
      const hint = createFdaHint('Messages');
      expect(hint).toContain('Full Disk Access');
      expect(hint).toContain('Messages database');
      expect(hint).toContain(SYSTEM_SETTINGS.FULL_DISK_ACCESS);
    });

    it('returns FDA hint for Mail database', () => {
      const hint = createFdaHint('Mail');
      expect(hint).toContain('Mail database');
      expect(hint).toContain(SYSTEM_SETTINGS.FULL_DISK_ACCESS);
    });
  });
});
