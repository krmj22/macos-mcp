/**
 * @fileoverview Configuration schema definitions for macos-mcp server
 * @module config/schema
 * @description Zod schemas for transport mode, HTTP settings, and Cloudflare Access configuration
 */

import { z } from 'zod/v3';

/**
 * Cloudflare Access configuration schema for JWT verification
 * Required when using Cloudflare Tunnel for secure remote access
 */
export const CloudflareAccessConfigSchema = z.object({
  /** Cloudflare Access team domain (e.g., "myteam.cloudflareaccess.com") */
  teamDomain: z.string().min(1, 'Team domain is required'),
  /** Application Audience (AUD) tag from Cloudflare Access policy */
  policyAUD: z.string().min(1, 'Policy AUD is required'),
  /** Optional list of allowed email addresses for additional verification */
  allowedEmails: z.array(z.string().email('Invalid email format')).optional(),
});

/**
 * HTTP transport configuration schema
 */
export const HttpConfigSchema = z.object({
  /** Whether HTTP transport is enabled */
  enabled: z.boolean().default(false),
  /** Host to bind the HTTP server to */
  host: z.string().default('127.0.0.1'),
  /** Port for the HTTP server (1-65535) */
  port: z.number().int().min(1).max(65535).default(3847),
  /** Cloudflare Access configuration for JWT verification */
  cloudflareAccess: CloudflareAccessConfigSchema.optional(),
});

/**
 * Full server configuration schema
 */
export const ServerConfigSchema = z.object({
  /** Server name (auto-populated from package.json) */
  name: z.string(),
  /** Server version (auto-populated from package.json) */
  version: z.string(),
  /** Transport mode: stdio (default), http, or both */
  transport: z.enum(['stdio', 'http', 'both']).default('stdio'),
  /** HTTP transport configuration (required when transport includes http) */
  http: HttpConfigSchema.optional(),
});

/** Cloudflare Access configuration type */
export type CloudflareAccessConfig = z.infer<
  typeof CloudflareAccessConfigSchema
>;

/** HTTP transport configuration type */
export type HttpConfig = z.infer<typeof HttpConfigSchema>;

/** Full server configuration type */
export type FullServerConfig = z.infer<typeof ServerConfigSchema>;
