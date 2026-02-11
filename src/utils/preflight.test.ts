/**
 * preflight.test.ts
 * Tests for startup preflight validation checks.
 * All OS/filesystem calls are mocked — no real system access.
 */

import {
  type CheckResult,
  checkMailFda,
  checkMessagesFda,
  checkNodeVersion,
  checkPlatform,
  checkSwiftBinary,
  formatResults,
} from './preflight.js';

// Mock os module
jest.mock('node:os', () => ({
  platform: jest.fn(() => 'darwin'),
  release: jest.fn(() => '24.1.0'),
  homedir: jest.fn(() => '/tmp/mock-home'),
}));

// Mock fs module
jest.mock('node:fs', () => ({
  accessSync: jest.fn(),
  constants: { R_OK: 4, X_OK: 1 },
}));

// Mock projectUtils
jest.mock('./projectUtils.js', () => ({
  findProjectRoot: jest.fn(() => '/test/project'),
}));

import { platform, release } from 'node:os';
import { accessSync } from 'node:fs';

const mockPlatform = platform as jest.MockedFunction<typeof platform>;
const mockRelease = release as jest.MockedFunction<typeof release>;
const mockAccessSync = accessSync as jest.MockedFunction<typeof accessSync>;

describe('preflight checks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatform.mockReturnValue('darwin');
    mockRelease.mockReturnValue('24.1.0');
  });

  describe('checkPlatform', () => {
    it('passes on macOS Sequoia (Darwin 24.x)', () => {
      const result = checkPlatform();
      expect(result.status).toBe('PASS');
      expect(result.message).toContain('24.1.0');
    });

    it('passes on macOS Sonoma (Darwin 23.x)', () => {
      mockRelease.mockReturnValue('23.4.0');
      const result = checkPlatform();
      expect(result.status).toBe('PASS');
    });

    it('warns on pre-Sonoma (Darwin 22.x)', () => {
      mockRelease.mockReturnValue('22.6.0');
      const result = checkPlatform();
      expect(result.status).toBe('WARN');
      expect(result.message).toContain('pre-Sonoma');
    });

    it('fails on non-macOS platform', () => {
      mockPlatform.mockReturnValue('linux');
      const result = checkPlatform();
      expect(result.status).toBe('FAIL');
      expect(result.message).toContain('linux');
    });
  });

  describe('checkNodeVersion', () => {
    it('passes on current Node.js version', () => {
      const result = checkNodeVersion();
      expect(result.status).toBe('PASS');
      expect(result.message).toContain(process.versions.node);
    });
  });

  describe('checkSwiftBinary', () => {
    it('passes when binary exists and is executable', () => {
      mockAccessSync.mockImplementation(() => undefined);
      const result = checkSwiftBinary();
      expect(result.status).toBe('PASS');
      expect(result.message).toContain('EventKitCLI');
    });

    it('fails when binary is not found', () => {
      mockAccessSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });
      const result = checkSwiftBinary();
      expect(result.status).toBe('FAIL');
      expect(result.message).toContain('pnpm build');
    });
  });

  describe('checkMessagesFda', () => {
    it('passes when Messages database is readable', () => {
      mockAccessSync.mockImplementation(() => undefined);
      const result = checkMessagesFda();
      expect(result.status).toBe('PASS');
    });

    it('warns when Messages database is not readable', () => {
      mockAccessSync.mockImplementation(() => {
        throw new Error('EACCES');
      });
      const result = checkMessagesFda();
      expect(result.status).toBe('WARN');
      expect(result.message).toContain('Full Disk Access');
    });
  });

  describe('checkMailFda', () => {
    it('passes when Mail database is readable', () => {
      mockAccessSync.mockImplementation(() => undefined);
      const result = checkMailFda();
      expect(result.status).toBe('PASS');
    });

    it('warns when Mail database is not readable', () => {
      mockAccessSync.mockImplementation(() => {
        throw new Error('EACCES');
      });
      const result = checkMailFda();
      expect(result.status).toBe('WARN');
      expect(result.message).toContain('Full Disk Access');
    });
  });

  describe('formatResults', () => {
    it('formats all-pass results', () => {
      const results: CheckResult[] = [
        { name: 'Test 1', status: 'PASS', message: 'OK' },
        { name: 'Test 2', status: 'PASS', message: 'OK' },
      ];
      const output = formatResults(results);
      expect(output).toContain('[PASS]');
      expect(output).toContain('All checks passed');
    });

    it('formats results with warnings', () => {
      const results: CheckResult[] = [
        { name: 'Test 1', status: 'PASS', message: 'OK' },
        { name: 'Test 2', status: 'WARN', message: 'Missing' },
      ];
      const output = formatResults(results);
      expect(output).toContain('1 warning(s)');
    });

    it('formats results with failures', () => {
      const results: CheckResult[] = [
        { name: 'Test 1', status: 'FAIL', message: 'Bad' },
        { name: 'Test 2', status: 'PASS', message: 'OK' },
      ];
      const output = formatResults(results);
      expect(output).toContain('FAIL');
      expect(output).toContain('fix the issues');
    });
  });
});
