#!/usr/bin/env node

/**
 * index.ts
 * Entry point for the macOS MCP server
 *
 * Supports multiple transport modes:
 * - stdio: Standard input/output (default, for Claude Desktop)
 * - http: HTTP/SSE transport (for remote access via Cloudflare Tunnel)
 * - both: Run both transports simultaneously
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type FullServerConfig, loadConfig } from './config/index.js';
import { createServer } from './server/server.js';
import type { HttpTransportInstance } from './server/transports/http/index.js';

/** Active HTTP transport instance for cleanup */
let httpTransport: HttpTransportInstance | null = null;

/**
 * Graceful shutdown handler
 * Stops HTTP server if running and exits cleanly
 */
async function shutdown(): Promise<void> {
  process.stderr.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), event: 'shutdown_initiated' })}\n`,
  );

  if (httpTransport) {
    await httpTransport.stop();
  }

  process.exit(0);
}

/**
 * Main entry point
 * Loads configuration and starts appropriate transport(s)
 */
async function main(): Promise<void> {
  const config: FullServerConfig = loadConfig();
  const server = createServer(config);

  // Register graceful shutdown handlers
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // Start stdio transport if configured
  if (config.transport === 'stdio' || config.transport === 'both') {
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
  }

  // Start HTTP transport if configured
  if (config.transport === 'http' || config.transport === 'both') {
    if (!config.http?.enabled) {
      throw new Error('HTTP transport requested but http.enabled is false');
    }

    // Dynamic import to avoid loading express when not needed
    const { createHttpTransport } = await import(
      './server/transports/http/index.js'
    );
    httpTransport = createHttpTransport(server, config, config.http);
    await httpTransport.start();
  }
}

// Handle --check flag for preflight validation
if (process.argv.includes('--check')) {
  import('./utils/preflight.js').then(async ({ runPreflight, formatResults }) => {
    const results = await runPreflight();
    process.stdout.write(`${formatResults(results)}\n`);
    const hasFailure = results.some((r) => r.status === 'FAIL');
    process.exit(hasFailure ? 1 : 0);
  });
} else {
  // Start the application
  main().catch((error: unknown) => {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${JSON.stringify({ timestamp: new Date().toISOString(), error: 'fatal', message: errorMessage })}\n`,
    );
    process.exit(1);
  });
}
