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
import { createServer } from '../../server.js';
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
  /** Start listening on configured host:port */
  start: () => Promise<void>;
  /** Stop the HTTP server */
  stop: () => Promise<void>;
}

/**
 * Creates an HTTP transport for the MCP server
 *
 * SDK 1.26.0 requires stateless transports to be created fresh per request.
 * Each POST creates a new MCP Server + StreamableHTTPServerTransport pair,
 * handles the request, then cleans up on response close.
 *
 * @param _mcpServer - Unused (kept for API compatibility). Per-request servers are created internally.
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
  _mcpServer: McpServer,
  config: FullServerConfig,
  httpConfig: HttpConfig,
): HttpTransportInstance {
  const app = express();

  // Trust proxy for rate limiting behind Cloudflare Tunnel
  app.set('trust proxy', true);

  // Apply global middleware
  // express.json() is required to pre-parse the body for the SDK's parsedBody parameter.
  // SDK 1.26.0 explicitly supports this pattern: transport.handleRequest(req, res, req.body)
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

  // MCP endpoint handler — creates a fresh server + transport per request
  // SDK 1.26.0 stateless mode throws "Stateless transport cannot be reused across requests"
  // if a transport with sessionIdGenerator=undefined handles more than one request.
  // The official SDK pattern (simpleStatelessStreamableHttp.ts) creates new instances per request.
  const mcpHandler = async (req: Request, res: Response): Promise<void> => {
    const perRequestServer = createServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    // Log transport-level errors to stderr for visibility
    transport.onerror = (error: Error) => {
      process.stderr.write(
        `${JSON.stringify({ timestamp: new Date().toISOString(), error: 'MCP transport error', message: error.message, stack: error.stack })}\n`,
      );
    };

    try {
      await perRequestServer.connect(transport);
      await transport.handleRequest(req, res, req.body);

      // Clean up when the response closes
      res.on('close', () => {
        transport.close().catch(() => {});
        perRequestServer.close().catch(() => {});
      });
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

    async start(): Promise<void> {
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
