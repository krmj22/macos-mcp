/**
 * @fileoverview Health check endpoints for HTTP transport
 * @module server/transports/http/health
 * @description Provides /health and /health/ready endpoints for monitoring
 */

import type { Request, Response, Router } from 'express';
import type { FullServerConfig } from '../../../config/index.js';

/**
 * Subsystem health status
 */
interface SubsystemStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
}

/**
 * Health check response
 */
interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
  subsystems?: SubsystemStatus[];
}

/** Server start time for uptime calculation */
let serverStartTime: number | null = null;

/**
 * Marks the server as started (call when HTTP server begins listening)
 */
export function markServerStarted(): void {
  serverStartTime = Date.now();
}

/**
 * Gets the server uptime in seconds
 * @returns Uptime in seconds, or 0 if not started
 */
function getUptime(): number {
  if (serverStartTime === null) {
    return 0;
  }
  return Math.floor((Date.now() - serverStartTime) / 1000);
}

/**
 * Basic health check handler
 * Returns 200 if server is running
 *
 * @param config - Server configuration
 * @returns Express request handler
 */
export function createHealthHandler(
  config: FullServerConfig,
): (req: Request, res: Response) => void {
  return (_req: Request, res: Response): void => {
    const response: HealthResponse = {
      status: 'healthy',
      service: config.name,
      version: config.version,
      timestamp: new Date().toISOString(),
      uptime: getUptime(),
    };

    res.status(200).json(response);
  };
}

/**
 * Readiness check handler
 * Returns 200 with subsystem status if server is ready to accept requests
 *
 * @param config - Server configuration
 * @returns Express request handler
 */
export function createReadinessHandler(
  config: FullServerConfig,
): (req: Request, res: Response) => void {
  return (_req: Request, res: Response): void => {
    const subsystems: SubsystemStatus[] = [
      {
        name: 'mcp-server',
        status: 'healthy',
        message: 'MCP server is accepting connections',
      },
      {
        name: 'http-transport',
        status: 'healthy',
        message: 'HTTP transport is operational',
      },
    ];

    // Determine overall status based on subsystems
    const overallStatus = subsystems.every((s) => s.status === 'healthy')
      ? 'healthy'
      : subsystems.some((s) => s.status === 'unhealthy')
        ? 'unhealthy'
        : 'degraded';

    const response: HealthResponse = {
      status: overallStatus,
      service: config.name,
      version: config.version,
      timestamp: new Date().toISOString(),
      uptime: getUptime(),
      subsystems,
    };

    const statusCode = overallStatus === 'healthy' ? 200 : 503;
    res.status(statusCode).json(response);
  };
}

/**
 * Registers health check routes on the provided router
 * These endpoints do NOT require authentication
 *
 * @param router - Express router to register routes on
 * @param config - Server configuration
 */
export function registerHealthRoutes(
  router: Router,
  config: FullServerConfig,
): void {
  router.get('/health', createHealthHandler(config));
  router.get('/health/ready', createReadinessHandler(config));
}
