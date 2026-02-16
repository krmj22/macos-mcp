/**
 * config.test.ts
 * Tests for configuration schema validation and loading
 */

import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot } from '../utils/projectUtils.js';
import {
  CloudflareAccessConfigSchema,
  HttpConfigSchema,
  loadConfig,
  ServerConfigSchema,
} from './index.js';

// Mock projectUtils to avoid import.meta.url issues in Jest
jest.mock('../utils/projectUtils.js', () => ({
  findProjectRoot: jest.fn(),
}));

const mockFindProjectRoot = findProjectRoot as jest.MockedFunction<
  typeof findProjectRoot
>;

describe('Configuration System', () => {
  describe('CloudflareAccessConfigSchema', () => {
    it('should validate valid Cloudflare Access config', () => {
      const validConfig = {
        teamDomain: 'myteam.cloudflareaccess.com',
        policyAUD: 'abc123def456',
      };

      const result = CloudflareAccessConfigSchema.parse(validConfig);

      expect(result.teamDomain).toBe('myteam.cloudflareaccess.com');
      expect(result.policyAUD).toBe('abc123def456');
    });

    it('should validate config with allowed emails', () => {
      const validConfig = {
        teamDomain: 'myteam.cloudflareaccess.com',
        policyAUD: 'abc123def456',
        allowedEmails: ['user@example.com', 'admin@example.com'],
      };

      const result = CloudflareAccessConfigSchema.parse(validConfig);

      expect(result.allowedEmails).toEqual([
        'user@example.com',
        'admin@example.com',
      ]);
    });

    it('should reject empty teamDomain', () => {
      const invalidConfig = {
        teamDomain: '',
        policyAUD: 'abc123',
      };

      expect(() => CloudflareAccessConfigSchema.parse(invalidConfig)).toThrow();
    });

    it('should reject empty policyAUD', () => {
      const invalidConfig = {
        teamDomain: 'myteam.cloudflareaccess.com',
        policyAUD: '',
      };

      expect(() => CloudflareAccessConfigSchema.parse(invalidConfig)).toThrow();
    });

    it('should reject invalid email format in allowedEmails', () => {
      const invalidConfig = {
        teamDomain: 'myteam.cloudflareaccess.com',
        policyAUD: 'abc123',
        allowedEmails: ['not-an-email'],
      };

      expect(() => CloudflareAccessConfigSchema.parse(invalidConfig)).toThrow();
    });
  });

  describe('HttpConfigSchema', () => {
    it('should apply defaults for minimal config', () => {
      const result = HttpConfigSchema.parse({});

      expect(result.enabled).toBe(false);
      expect(result.host).toBe('127.0.0.1');
      expect(result.port).toBe(3847);
    });

    it('should validate full HTTP config', () => {
      const validConfig = {
        enabled: true,
        host: '0.0.0.0',
        port: 8080,
        cloudflareAccess: {
          teamDomain: 'myteam.cloudflareaccess.com',
          policyAUD: 'abc123',
        },
      };

      const result = HttpConfigSchema.parse(validConfig);

      expect(result.enabled).toBe(true);
      expect(result.host).toBe('0.0.0.0');
      expect(result.port).toBe(8080);
      expect(result.cloudflareAccess?.teamDomain).toBe(
        'myteam.cloudflareaccess.com',
      );
    });

    it('should reject invalid port (too low)', () => {
      const invalidConfig = {
        enabled: true,
        port: 0,
      };

      expect(() => HttpConfigSchema.parse(invalidConfig)).toThrow();
    });

    it('should reject invalid port (too high)', () => {
      const invalidConfig = {
        enabled: true,
        port: 65536,
      };

      expect(() => HttpConfigSchema.parse(invalidConfig)).toThrow();
    });

    it('should reject non-integer port', () => {
      const invalidConfig = {
        enabled: true,
        port: 3847.5,
      };

      expect(() => HttpConfigSchema.parse(invalidConfig)).toThrow();
    });
  });

  describe('ServerConfigSchema', () => {
    it('should apply default transport (stdio) for minimal config', () => {
      const result = ServerConfigSchema.parse({
        name: 'test-server',
        version: '1.0.0',
      });

      expect(result.transport).toBe('stdio');
    });

    it('should validate http transport mode', () => {
      const result = ServerConfigSchema.parse({
        name: 'test-server',
        version: '1.0.0',
        transport: 'http',
      });

      expect(result.transport).toBe('http');
    });

    it('should validate both transport mode', () => {
      const result = ServerConfigSchema.parse({
        name: 'test-server',
        version: '1.0.0',
        transport: 'both',
      });

      expect(result.transport).toBe('both');
    });

    it('should reject invalid transport mode', () => {
      expect(() =>
        ServerConfigSchema.parse({
          name: 'test-server',
          version: '1.0.0',
          transport: 'invalid',
        }),
      ).toThrow();
    });

    it('should validate full server config with HTTP', () => {
      const result = ServerConfigSchema.parse({
        name: 'test-server',
        version: '1.0.0',
        transport: 'both',
        http: {
          enabled: true,
          host: '0.0.0.0',
          port: 8080,
        },
      });

      expect(result.name).toBe('test-server');
      expect(result.version).toBe('1.0.0');
      expect(result.transport).toBe('both');
      expect(result.http?.enabled).toBe(true);
      expect(result.http?.port).toBe(8080);
    });

    it('should require name field', () => {
      expect(() =>
        ServerConfigSchema.parse({
          version: '1.0.0',
        }),
      ).toThrow();
    });

    it('should require version field', () => {
      expect(() =>
        ServerConfigSchema.parse({
          name: 'test-server',
        }),
      ).toThrow();
    });
  });

  describe('loadConfig', () => {
    const originalEnv = { ...process.env };
    const testProjectRoot = '/tmp/macos-mcp-test';
    let configPath: string;
    let packageJsonPath: string;

    beforeEach(() => {
      // Reset environment to original state
      process.env = { ...originalEnv };
      // Clear any config-related env vars
      delete process.env.MCP_TRANSPORT;
      delete process.env.MCP_HTTP_ENABLED;
      delete process.env.MCP_HTTP_HOST;
      delete process.env.MCP_HTTP_PORT;
      delete process.env.CF_ACCESS_TEAM_DOMAIN;
      delete process.env.CF_ACCESS_POLICY_AUD;
      delete process.env.CF_ACCESS_ALLOWED_EMAILS;

      // Setup mock project root
      mockFindProjectRoot.mockReturnValue(testProjectRoot);
      configPath = join(testProjectRoot, 'macos-mcp.config.json');
      packageJsonPath = join(testProjectRoot, 'package.json');

      // Create test directory and package.json
      const fs = require('node:fs');
      fs.mkdirSync(testProjectRoot, { recursive: true });
      fs.writeFileSync(
        packageJsonPath,
        JSON.stringify({ name: 'mcp-macos', version: '2.0.0' }),
      );

      // Remove any existing config file
      if (existsSync(configPath)) {
        unlinkSync(configPath);
      }
    });

    afterEach(() => {
      // Restore original environment
      process.env = originalEnv;

      // Clean up test files
      const fs = require('node:fs');
      if (existsSync(configPath)) {
        try {
          unlinkSync(configPath);
        } catch {
          // Ignore cleanup errors
        }
      }
      if (existsSync(packageJsonPath)) {
        try {
          unlinkSync(packageJsonPath);
        } catch {
          // Ignore cleanup errors
        }
      }
      try {
        fs.rmdirSync(testProjectRoot);
      } catch {
        // Ignore cleanup errors
      }
    });

    it('should load default configuration', () => {
      const config = loadConfig();

      expect(config.name).toBe('mcp-macos');
      expect(config.version).toBeDefined();
      expect(config.transport).toBe('stdio');
    });

    it('should auto-inject name and version from package.json', () => {
      const config = loadConfig();

      expect(config.name).toBe('mcp-macos');
      expect(config.version).toBe('2.0.0');
    });

    it('should override transport via environment variable', () => {
      process.env.MCP_TRANSPORT = 'http';

      const config = loadConfig();

      expect(config.transport).toBe('http');
    });

    it('should load HTTP config from environment variables', () => {
      process.env.MCP_HTTP_ENABLED = 'true';
      process.env.MCP_HTTP_HOST = '0.0.0.0';
      process.env.MCP_HTTP_PORT = '8080';

      const config = loadConfig();

      expect(config.http?.enabled).toBe(true);
      expect(config.http?.host).toBe('0.0.0.0');
      expect(config.http?.port).toBe(8080);
    });

    it('should load Cloudflare Access config from environment variables', () => {
      process.env.MCP_HTTP_ENABLED = 'true';
      process.env.CF_ACCESS_TEAM_DOMAIN = 'myteam.cloudflareaccess.com';
      process.env.CF_ACCESS_POLICY_AUD = 'abc123';

      const config = loadConfig();

      expect(config.http?.cloudflareAccess?.teamDomain).toBe(
        'myteam.cloudflareaccess.com',
      );
      expect(config.http?.cloudflareAccess?.policyAUD).toBe('abc123');
    });

    it('should parse comma-separated allowed emails', () => {
      process.env.MCP_HTTP_ENABLED = 'true';
      process.env.CF_ACCESS_TEAM_DOMAIN = 'myteam.cloudflareaccess.com';
      process.env.CF_ACCESS_POLICY_AUD = 'abc123';
      process.env.CF_ACCESS_ALLOWED_EMAILS =
        'user1@example.com, user2@example.com';

      const config = loadConfig();

      expect(config.http?.cloudflareAccess?.allowedEmails).toEqual([
        'user1@example.com',
        'user2@example.com',
      ]);
    });

    it('should ignore invalid port in environment variable', () => {
      process.env.MCP_HTTP_ENABLED = 'true';
      process.env.MCP_HTTP_PORT = 'not-a-number';

      const config = loadConfig();

      // Should fall back to default port
      expect(config.http?.port).toBe(3847);
    });

    it('should load configuration from file', () => {
      const fileConfig = {
        transport: 'http',
        http: {
          enabled: true,
          port: 9000,
        },
      };
      writeFileSync(configPath, JSON.stringify(fileConfig));

      const config = loadConfig();

      expect(config.transport).toBe('http');
      expect(config.http?.enabled).toBe(true);
      expect(config.http?.port).toBe(9000);
    });

    it('should prefer environment variables over file config', () => {
      const fileConfig = {
        transport: 'stdio',
        http: {
          port: 9000,
        },
      };
      writeFileSync(configPath, JSON.stringify(fileConfig));
      process.env.MCP_TRANSPORT = 'http';
      process.env.MCP_HTTP_ENABLED = 'true';
      process.env.MCP_HTTP_PORT = '8080';

      const config = loadConfig();

      expect(config.transport).toBe('http');
      expect(config.http?.port).toBe(8080);
    });

    it('should deep merge file and env configs', () => {
      const fileConfig = {
        http: {
          host: '192.168.1.1',
          port: 9000,
        },
      };
      writeFileSync(configPath, JSON.stringify(fileConfig));
      process.env.MCP_HTTP_ENABLED = 'true';
      process.env.MCP_HTTP_PORT = '8080';

      const config = loadConfig();

      // Port from env should override, but host from file should remain
      expect(config.http?.host).toBe('192.168.1.1');
      expect(config.http?.port).toBe(8080);
      expect(config.http?.enabled).toBe(true);
    });

    it('should not include Cloudflare config if team domain is missing', () => {
      process.env.MCP_HTTP_ENABLED = 'true';
      process.env.CF_ACCESS_POLICY_AUD = 'abc123';
      // Note: CF_ACCESS_TEAM_DOMAIN is not set

      const config = loadConfig();

      expect(config.http?.cloudflareAccess).toBeUndefined();
    });

    it('should not include Cloudflare config if policy AUD is missing', () => {
      process.env.MCP_HTTP_ENABLED = 'true';
      process.env.CF_ACCESS_TEAM_DOMAIN = 'myteam.cloudflareaccess.com';
      // Note: CF_ACCESS_POLICY_AUD is not set

      const config = loadConfig();

      expect(config.http?.cloudflareAccess).toBeUndefined();
    });

    it('should not process HTTP env vars if MCP_HTTP_ENABLED is not true', () => {
      process.env.MCP_HTTP_HOST = '0.0.0.0';
      process.env.MCP_HTTP_PORT = '8080';
      // Note: MCP_HTTP_ENABLED is not set to 'true'

      const config = loadConfig();

      expect(config.http).toBeUndefined();
    });
  });
});
