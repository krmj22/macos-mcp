/**
 * errorHandling.test.ts
 * Tests for error handling utilities
 */

import { ValidationError } from '../validation/schemas.js';
import { handleAsyncOperation } from './errorHandling.js';
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
        throw new JxaError('connection invalid', 'Mail', false, 'connection invalid');
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
  });
});
