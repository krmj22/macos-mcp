/**
 * @fileoverview HTTP middleware for rate limiting, logging, and CORS
 * @module server/transports/http/middleware
 * @description Express middleware stack for the HTTP transport
 */

import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';

/**
 * Extended request type with timing and auth info
 */
export interface TimedRequest extends Request {
  /** Request start time for duration calculation */
  startTime?: number;
  /** Verified Cloudflare Access email */
  cfAccessEmail?: string;
}

/**
 * Log entry for request logging
 */
interface RequestLogEntry {
  timestamp: string;
  method: string;
  path: string;
  status: number;
  duration: number;
  user?: string;
  ip: string;
}

/**
 * Creates a rate limiter middleware
 * Default: 100 requests per minute per IP
 *
 * @param maxRequests - Maximum requests per window (default: 100)
 * @param windowMs - Window size in milliseconds (default: 60000 = 1 minute)
 * @returns Express rate limiting middleware
 */
export function createRateLimiter(
  maxRequests = 100,
  windowMs = 60000,
): ReturnType<typeof rateLimit> {
  return rateLimit({
    windowMs,
    max: maxRequests,
    // Suppress ERR_ERL_KEY_GEN_IPV6 ValidationError — we're behind Cloudflare
    // Tunnel which always provides X-Forwarded-For, so IPv6 validation is irrelevant
    validate: { keyGeneratorIpFallback: false },
    message: {
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowMs / 1000} seconds.`,
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Use X-Forwarded-For header if behind proxy (Cloudflare Tunnel)
    keyGenerator: (req: Request): string => {
      const forwarded = req.headers['x-forwarded-for'];
      if (typeof forwarded === 'string') {
        // Take the first IP if there are multiple
        return forwarded.split(',')[0].trim();
      }
      return req.ip ?? req.socket.remoteAddress ?? 'unknown';
    },
    // Skip rate limiting for health checks
    skip: (req: Request): boolean => {
      return req.path === '/health' || req.path === '/health/ready';
    },
  });
}

/**
 * Request timing middleware
 * Adds startTime to request for duration calculation
 *
 * @returns Express middleware function
 */
export function requestTiming(): (
  req: TimedRequest,
  res: Response,
  next: NextFunction,
) => void {
  return (req: TimedRequest, _res: Response, next: NextFunction): void => {
    req.startTime = Date.now();
    next();
  };
}

/**
 * Request logging middleware
 * Logs request details after response is sent
 *
 * @returns Express middleware function
 */
export function requestLogging(): (
  req: TimedRequest,
  res: Response,
  next: NextFunction,
) => void {
  return (req: TimedRequest, res: Response, next: NextFunction): void => {
    // Log after response is finished
    res.on('finish', () => {
      const duration = req.startTime ? Date.now() - req.startTime : 0;

      const logEntry: RequestLogEntry = {
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        ip:
          (typeof req.headers['x-forwarded-for'] === 'string'
            ? req.headers['x-forwarded-for'].split(',')[0].trim()
            : undefined) ??
          req.ip ??
          req.socket.remoteAddress ??
          'unknown',
      };

      // Add user if available from Cloudflare Access
      if (req.cfAccessEmail) {
        logEntry.user = req.cfAccessEmail;
      }

      // Log to stderr to avoid interfering with stdio transport
      // Use structured JSON for easy parsing
      process.stderr.write(`${JSON.stringify(logEntry)}\n`);
    });

    next();
  };
}

/**
 * CORS middleware for handling preflight requests
 * Configured for Cloudflare Tunnel / Access
 *
 * @returns Express middleware function
 */
export function corsMiddleware(): (
  req: Request,
  res: Response,
  next: NextFunction,
) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Allow requests from same origin or Cloudflare
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Cf-Access-Jwt-Assertion, Mcp-Session-Id, Last-Event-Id',
    );
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    res.setHeader('Access-Control-Max-Age', '86400');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  };
}

/**
 * Error handling middleware
 * Catches unhandled errors and returns appropriate response
 *
 * @returns Express error handling middleware
 */
export function errorHandler(): (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) => void {
  return (
    err: Error,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ): void => {
    // Log error to stderr
    process.stderr.write(
      `${JSON.stringify({ timestamp: new Date().toISOString(), error: err.message, stack: err.stack })}\n`,
    );

    // Send error response if not already sent
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal Server Error',
        message:
          process.env.NODE_ENV === 'production'
            ? 'An unexpected error occurred'
            : err.message,
      });
    }
  };
}
