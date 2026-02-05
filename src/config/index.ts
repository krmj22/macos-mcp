/**
 * @fileoverview Configuration loading and management for macos-mcp server
 * @module config
 * @description Loads configuration from file and environment variables with auto-injection of package.json metadata
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot } from '../utils/projectUtils.js';
import {
  type CloudflareAccessConfig,
  type FullServerConfig,
  type HttpConfig,
  ServerConfigSchema,
} from './schema.js';

/** Configuration file name */
const CONFIG_FILENAME = 'macos-mcp.config.json';

/**
 * Loads server configuration from file and environment variables
 *
 * Configuration is loaded in the following priority (highest to lowest):
 * 1. Environment variables (MCP_TRANSPORT, MCP_HTTP_*, CF_ACCESS_*)
 * 2. Configuration file (macos-mcp.config.json in project root)
 * 3. Default values from schema
 *
 * Name and version are always auto-injected from package.json
 *
 * @returns Validated server configuration
 * @throws Error if configuration is invalid
 *
 * @example
 * // Basic usage
 * const config = loadConfig();
 * console.log(config.transport); // 'stdio' (default)
 *
 * @example
 * // With environment variables
 * // MCP_TRANSPORT=http
 * // MCP_HTTP_ENABLED=true
 * // MCP_HTTP_PORT=8080
 * const config = loadConfig();
 * console.log(config.transport); // 'http'
 * console.log(config.http?.port); // 8080
 */
export function loadConfig(): FullServerConfig {
  const projectRoot = findProjectRoot();
  const configPath = join(projectRoot, CONFIG_FILENAME);

  // Load file configuration if it exists
  let fileConfig: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    const fileContent = readFileSync(configPath, 'utf-8');
    fileConfig = JSON.parse(fileContent) as Record<string, unknown>;
  }

  // Build environment variable configuration
  const envConfig = buildEnvConfig();

  // Deep merge file config with env config (env takes precedence)
  const merged = deepMerge(fileConfig, envConfig);

  // Load package.json for name and version
  const packageJsonPath = join(projectRoot, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
    name: string;
    version: string;
  };

  // Parse and validate configuration
  return ServerConfigSchema.parse({
    name: packageJson.name,
    version: packageJson.version,
    ...merged,
  });
}

/**
 * Builds configuration object from environment variables
 * @returns Partial configuration from environment variables
 */
function buildEnvConfig(): Record<string, unknown> {
  const config: Record<string, unknown> = {};

  // Transport mode
  if (process.env.MCP_TRANSPORT) {
    config.transport = process.env.MCP_TRANSPORT;
  }

  // HTTP configuration (only if explicitly enabled)
  if (process.env.MCP_HTTP_ENABLED === 'true') {
    const httpConfig: Record<string, unknown> = {
      enabled: true,
    };

    if (process.env.MCP_HTTP_HOST) {
      httpConfig.host = process.env.MCP_HTTP_HOST;
    }

    if (process.env.MCP_HTTP_PORT) {
      const port = Number.parseInt(process.env.MCP_HTTP_PORT, 10);
      if (!Number.isNaN(port)) {
        httpConfig.port = port;
      }
    }

    // Cloudflare Access configuration
    if (process.env.CF_ACCESS_TEAM_DOMAIN && process.env.CF_ACCESS_POLICY_AUD) {
      const cfConfig: Record<string, unknown> = {
        teamDomain: process.env.CF_ACCESS_TEAM_DOMAIN,
        policyAUD: process.env.CF_ACCESS_POLICY_AUD,
      };

      if (process.env.CF_ACCESS_ALLOWED_EMAILS) {
        cfConfig.allowedEmails = process.env.CF_ACCESS_ALLOWED_EMAILS.split(
          ',',
        ).map((e) => e.trim());
      }

      httpConfig.cloudflareAccess = cfConfig;
    }

    config.http = httpConfig;
  }

  return config;
}

/**
 * Deep merges two objects, with source taking precedence
 * @param target - Base object
 * @param source - Object to merge in (takes precedence)
 * @returns Merged object
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      );
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue;
    }
  }

  return result;
}

// Re-export types for convenience
export type { CloudflareAccessConfig, FullServerConfig, HttpConfig };
export {
  CloudflareAccessConfigSchema,
  HttpConfigSchema,
  ServerConfigSchema,
} from './schema.js';
