/**
 * server/server.ts
 * Server configuration and startup logic
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ServerConfig } from '../types/index.js';
import { registerHandlers } from './handlers.js';

// Gracefully exit on EPIPE (broken pipe) when the MCP client disconnects.
// Replaces the `exit-on-epipe` npm package with an inline equivalent.
process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
});

/**
 * Server configuration interface for createServer
 * Accepts either basic ServerConfig or FullServerConfig (which extends it)
 */
interface CreateServerConfig {
  name: string;
  version: string;
}

/**
 * Creates and configures an MCP server instance
 * @param config - Server configuration (basic or full)
 * @returns Configured server instance
 */
export function createServer(config: CreateServerConfig): Server {
  const server = new Server(
    {
      name: config.name,
      version: config.version,
    },
    {
      capabilities: {
        resources: {},
        tools: {},
        prompts: {},
      },
    },
  );

  // Register request handlers
  registerHandlers(server);

  return server;
}

/**
 * Starts the MCP server with stdio transport
 * @deprecated Use index.ts entry point with loadConfig() for multi-transport support
 * @param config - Server configuration
 * @returns A promise that resolves when the server starts
 */
export async function startServer(config: ServerConfig): Promise<void> {
  try {
    const server = createServer(config);
    const transport = new StdioServerTransport();

    // Handle process signals for graceful shutdown
    process.on('SIGINT', () => {
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      process.exit(0);
    });

    await server.connect(transport);
  } catch {
    process.exit(1);
  }
}
