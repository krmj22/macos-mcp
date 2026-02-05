/**
 * @fileoverview HTTP transport layer using MCP SDK's StreamableHTTPServerTransport
 * @module server/transports/http
 * @description Express server providing HTTP transport for MCP protocol messages
 */

import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, {
  type Express,
  type Request,
  type Response,
  Router,
} from 'express';
import type { FullServerConfig, HttpConfig } from '../../../config/index.js';
import { createAuthMiddleware } from './auth.js';
import { markServerStarted, registerHealthRoutes } from './health.js';
import {
  corsMiddleware,
  createRateLimiter,
  errorHandler,
  requestLogging,
  requestTiming,
} from './middleware.js';

/**
 * HTTP transport instance
 */
export interface HttpTransportInstance {
  /** Express application */
  app: Express;
  /** StreamableHTTPServerTransport for MCP protocol */
  transport: StreamableHTTPServerTransport;
  /** Start listening on configured host:port */
  start: () => Promise<void>;
  /** Stop the HTTP server */
  stop: () => Promise<void>;
}

/**
 * Creates an HTTP transport for the MCP server
 *
 * @param mcpServer - MCP server instance to connect
 * @param config - Full server configuration
 * @param httpConfig - HTTP-specific configuration
 * @returns HTTP transport instance
 *
 * @example
 * ```typescript
 * const config = loadConfig();
 * const mcpServer = createServer(config);
 * const httpTransport = createHttpTransport(mcpServer, config, config.http!);
 * await httpTransport.start();
 * ```
 */
export function createHttpTransport(
  mcpServer: McpServer,
  config: FullServerConfig,
  httpConfig: HttpConfig,
): HttpTransportInstance {
  const app = express();

  // Trust proxy for rate limiting behind Cloudflare Tunnel
  app.set('trust proxy', true);

  // Create MCP transport in STATELESS mode for multi-client support
  // Each request is independent - no session tracking
  // This is required for Claude.ai which serves multiple users
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless mode - no session tracking
    enableJsonResponse: true, // Allow JSON responses for clients that don't support SSE
  });

  // Apply global middleware
  app.use(express.json());
  app.use(corsMiddleware());
  app.use(requestTiming());
  app.use(requestLogging());
  app.use(createRateLimiter());

  // Register health endpoints (no auth required)
  const healthRouter = Router();
  registerHealthRoutes(healthRouter, config);
  app.use(healthRouter);

  // Apply auth middleware to MCP endpoint if Cloudflare Access is configured
  if (httpConfig.cloudflareAccess) {
    app.use('/mcp', createAuthMiddleware(httpConfig.cloudflareAccess));
  }

  // MCP endpoint handler
  const mcpHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      process.stderr.write(
        `${JSON.stringify({ timestamp: new Date().toISOString(), error: 'MCP request failed', message: errorMessage })}\n`,
      );

      if (!res.headersSent) {
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'MCP request processing failed',
        });
      }
    }
  };

  // Register MCP routes - handle all methods for session management
  // Support both /mcp (explicit) and root / (Claude.ai expects this)
  app.all('/mcp', mcpHandler);
  app.all('/', mcpHandler);

  // Error handler must be last
  app.use(errorHandler());

  // HTTP server reference for cleanup
  let server: ReturnType<typeof app.listen> | null = null;

  return {
    app,
    transport,

    async start(): Promise<void> {
      // Connect MCP server to transport
      await mcpServer.connect(transport);

      return new Promise((resolve, reject) => {
        try {
          server = app.listen(httpConfig.port, httpConfig.host, () => {
            markServerStarted();
            process.stderr.write(
              `${JSON.stringify({
                timestamp: new Date().toISOString(),
                event: 'http_server_started',
                host: httpConfig.host,
                port: httpConfig.port,
                authEnabled: !!httpConfig.cloudflareAccess,
              })}\n`,
            );
            resolve();
          });

          server.on('error', (error: Error) => {
            process.stderr.write(
              `${JSON.stringify({ timestamp: new Date().toISOString(), error: 'HTTP server error', message: error.message })}\n`,
            );
            reject(error);
          });
        } catch (error) {
          reject(error);
        }
      });
    },

    async stop(): Promise<void> {
      if (server) {
        return new Promise((resolve, reject) => {
          server?.close((error?: Error) => {
            if (error) {
              reject(error);
            } else {
              process.stderr.write(
                `${JSON.stringify({ timestamp: new Date().toISOString(), event: 'http_server_stopped' })}\n`,
              );
              resolve();
            }
          });
        });
      }
    },
  };
}

// Re-export components for testing and extensibility
export { createAuthMiddleware, verifyCloudflareAccessJwt } from './auth.js';
export {
  createHealthHandler,
  createReadinessHandler,
  registerHealthRoutes,
} from './health.js';
export {
  corsMiddleware,
  createRateLimiter,
  errorHandler,
  requestLogging,
  requestTiming,
} from './middleware.js';
