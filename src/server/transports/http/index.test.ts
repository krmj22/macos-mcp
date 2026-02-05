/**
 * @fileoverview Tests for HTTP transport layer
 * @module server/transports/http/index.test
 */

// Mock jose before importing anything that uses it
jest.mock('jose');

import express from 'express';
import * as jose from 'jose';
import request from 'supertest';
import type { FullServerConfig } from '../../../config/index.js';
import { clearJwksCache } from './auth.js';
import {
  corsMiddleware,
  createRateLimiter,
  errorHandler,
  requestLogging,
  requestTiming,
} from './middleware.js';
import {
  createHealthHandler,
  createReadinessHandler,
  markServerStarted,
  registerHealthRoutes,
} from './health.js';

// Test key pair for signing JWTs
let testKeyPair: Awaited<ReturnType<typeof jose.generateKeyPair>>;
let testJwks: jose.JWK;

// Mock fetch for JWKS endpoint
const originalFetch = global.fetch;

beforeAll(async () => {
  // Generate RS256 key pair for testing (mocked)
  testKeyPair = await jose.generateKeyPair('RS256');
  testJwks = await jose.exportJWK(testKeyPair.publicKey);
  testJwks.kid = 'test-key-id';
  testJwks.alg = 'RS256';
  testJwks.use = 'sig';
});

beforeEach(() => {
  clearJwksCache();

  // Mock fetch for JWKS
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url.includes('/cdn-cgi/access/certs')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            keys: [testJwks],
          }),
      });
    }
    return Promise.reject(new Error(`Unexpected fetch to ${url}`));
  }) as jest.Mock;
});

afterEach(() => {
  global.fetch = originalFetch;
});

/**
 * Helper function to create a signed JWT for testing
 */
async function createTestJwt(
  claims: Record<string, unknown>,
  options: {
    expiresIn?: string;
    issuer?: string;
    audience?: string;
  } = {},
): Promise<string> {
  const {
    expiresIn = '1h',
    issuer = 'https://testteam.cloudflareaccess.com',
    audience = 'test-aud-123',
  } = options;

  return new jose.SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-id' })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(expiresIn)
    .sign(testKeyPair.privateKey);
}

describe('Health Endpoints', () => {
  const testConfig: FullServerConfig = {
    name: 'test-server',
    version: '1.0.0',
    transport: 'http',
    http: {
      enabled: true,
      host: '127.0.0.1',
      port: 3847,
    },
  };

  let app: express.Express;

  beforeEach(() => {
    app = express();
    const router = express.Router();
    markServerStarted();
    registerHealthRoutes(router, testConfig);
    app.use(router);
  });

  describe('GET /health', () => {
    it('returns 200 with healthy status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.service).toBe('test-server');
      expect(response.body.version).toBe('1.0.0');
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.uptime).toBeGreaterThanOrEqual(0);
    });

    it('does not require authentication', async () => {
      // No auth header provided
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
    });
  });

  describe('GET /health/ready', () => {
    it('returns 200 with subsystem status', async () => {
      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.subsystems).toHaveLength(2);
      expect(response.body.subsystems[0].name).toBe('mcp-server');
      expect(response.body.subsystems[1].name).toBe('http-transport');
    });
  });

  describe('createHealthHandler', () => {
    it('creates a handler that returns correct response', async () => {
      const handler = createHealthHandler(testConfig);
      const mockReq = {} as express.Request;
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as express.Response;

      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'healthy',
          service: 'test-server',
        }),
      );
    });
  });

  describe('createReadinessHandler', () => {
    it('creates a handler that returns subsystems', async () => {
      const handler = createReadinessHandler(testConfig);
      const mockReq = {} as express.Request;
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as express.Response;

      handler(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          subsystems: expect.arrayContaining([
            expect.objectContaining({ name: 'mcp-server' }),
          ]),
        }),
      );
    });
  });
});

describe('Middleware', () => {
  describe('CORS Middleware', () => {
    let app: express.Express;

    beforeEach(() => {
      app = express();
      app.use(corsMiddleware());
      app.get('/test', (_req, res) => res.json({ ok: true }));
    });

    it('sets CORS headers on response', async () => {
      const response = await request(app).get('/test');

      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-methods']).toBe(
        'GET, POST, DELETE, OPTIONS',
      );
      expect(response.headers['access-control-allow-headers']).toContain(
        'Cf-Access-Jwt-Assertion',
      );
      expect(response.headers['access-control-expose-headers']).toBe(
        'Mcp-Session-Id',
      );
    });

    it('handles OPTIONS preflight request', async () => {
      const response = await request(app).options('/test');

      expect(response.status).toBe(204);
    });
  });

  describe('Rate Limiter', () => {
    let app: express.Express;

    beforeEach(() => {
      app = express();
      app.set('trust proxy', true);
      // Very low limit for testing
      app.use(createRateLimiter(3, 60000));
      app.get('/test', (_req, res) => res.json({ ok: true }));
      app.get('/health', (_req, res) => res.json({ status: 'healthy' }));
    });

    it('allows requests under the limit', async () => {
      const response = await request(app).get('/test');

      expect(response.status).toBe(200);
    });

    it('returns 429 when rate limit exceeded', async () => {
      // Make requests up to and past the limit
      await request(app).get('/test');
      await request(app).get('/test');
      await request(app).get('/test');
      const response = await request(app).get('/test');

      expect(response.status).toBe(429);
      expect(response.body.error).toBe('Too Many Requests');
    });

    it('skips rate limiting for health endpoints', async () => {
      // Make many requests to health endpoint
      for (let i = 0; i < 10; i++) {
        const response = await request(app).get('/health');
        expect(response.status).toBe(200);
      }
    });

    it('includes rate limit headers', async () => {
      const response = await request(app).get('/test');

      expect(response.headers['ratelimit-limit']).toBeDefined();
      expect(response.headers['ratelimit-remaining']).toBeDefined();
    });

    it('uses X-Forwarded-For for rate limiting', async () => {
      // First IP
      await request(app)
        .get('/test')
        .set('X-Forwarded-For', '1.2.3.4');
      await request(app)
        .get('/test')
        .set('X-Forwarded-For', '1.2.3.4');
      await request(app)
        .get('/test')
        .set('X-Forwarded-For', '1.2.3.4');
      const response1 = await request(app)
        .get('/test')
        .set('X-Forwarded-For', '1.2.3.4');

      // Second IP should not be rate limited
      const response2 = await request(app)
        .get('/test')
        .set('X-Forwarded-For', '5.6.7.8');

      expect(response1.status).toBe(429);
      expect(response2.status).toBe(200);
    });
  });

  describe('Request Timing', () => {
    it('adds startTime to request', () => {
      const middleware = requestTiming();
      const mockReq = {} as express.Request & { startTime?: number };
      const mockRes = {} as express.Response;
      const mockNext = jest.fn();

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.startTime).toBeDefined();
      expect(typeof mockReq.startTime).toBe('number');
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Request Logging', () => {
    it('logs request after response finishes', () => {
      const middleware = requestLogging();
      const mockReq = {
        method: 'GET',
        path: '/test',
        headers: {},
        ip: '127.0.0.1',
        socket: { remoteAddress: '127.0.0.1' },
        startTime: Date.now(),
      } as unknown as express.Request;

      const finishHandlers: (() => void)[] = [];
      const mockRes = {
        statusCode: 200,
        on: jest.fn((event: string, handler: () => void) => {
          if (event === 'finish') {
            finishHandlers.push(handler);
          }
        }),
      } as unknown as express.Response;
      const mockNext = jest.fn();

      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();

      // Simulate response finish
      finishHandlers.forEach((handler) => handler());

      expect(stderrSpy).toHaveBeenCalled();
      const logEntry = JSON.parse(
        stderrSpy.mock.calls[0][0] as string,
      );
      expect(logEntry.method).toBe('GET');
      expect(logEntry.path).toBe('/test');
      expect(logEntry.status).toBe(200);

      stderrSpy.mockRestore();
    });
  });

  describe('Error Handler', () => {
    let app: express.Express;

    beforeEach(() => {
      app = express();
      app.get('/error', () => {
        throw new Error('Test error');
      });
      app.use(errorHandler());
    });

    it('catches errors and returns 500', async () => {
      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      const response = await request(app).get('/error');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');

      stderrSpy.mockRestore();
    });

    it('shows error message in non-production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      const response = await request(app).get('/error');

      expect(response.body.message).toBe('Test error');

      process.env.NODE_ENV = originalEnv;
      stderrSpy.mockRestore();
    });

    it('hides error message in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      const response = await request(app).get('/error');

      expect(response.body.message).toBe('An unexpected error occurred');

      process.env.NODE_ENV = originalEnv;
      stderrSpy.mockRestore();
    });
  });
});

describe('HTTP Transport Integration', () => {
  const testConfig: FullServerConfig = {
    name: 'test-server',
    version: '1.0.0',
    transport: 'http',
    http: {
      enabled: true,
      host: '127.0.0.1',
      port: 3847,
      cloudflareAccess: {
        teamDomain: 'testteam.cloudflareaccess.com',
        policyAUD: 'test-aud-123',
      },
    },
  };

  describe('Authentication required endpoints', () => {
    let app: express.Express;

    beforeEach(async () => {
      // Import dynamically to ensure clean state
      const { createAuthMiddleware } = await import('./auth.js');

      app = express();
      app.use(express.json());
      app.use(corsMiddleware());

      // Health endpoints (no auth)
      const healthRouter = express.Router();
      registerHealthRoutes(healthRouter, testConfig);
      app.use(healthRouter);

      // MCP endpoint (with auth)
      app.use(
        '/mcp',
        createAuthMiddleware(testConfig.http!.cloudflareAccess!),
      );
      app.post('/mcp', (req, res) => {
        res.json({ result: 'ok', method: req.method });
      });
    });

    it('allows health endpoint without auth', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
    });

    it('returns 401 on /mcp without auth', async () => {
      const response = await request(app).post('/mcp').send({ test: true });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
    });

    it('allows /mcp with valid auth token', async () => {
      const validToken = await createTestJwt({ email: 'user@example.com' });

      const response = await request(app)
        .post('/mcp')
        .set('Cf-Access-Jwt-Assertion', validToken)
        .send({ test: true });

      expect(response.status).toBe(200);
      expect(response.body.result).toBe('ok');
    });

    it('returns 401 on /mcp with expired token', async () => {
      const expiredToken = await createTestJwt(
        { email: 'user@example.com' },
        { expiresIn: '-1h' },
      );

      const response = await request(app)
        .post('/mcp')
        .set('Cf-Access-Jwt-Assertion', expiredToken)
        .send({ test: true });

      expect(response.status).toBe(401);
      expect(response.body.message).toBe('JWT has expired');
    });
  });

  describe('Without Cloudflare Access configured', () => {
    let app: express.Express;

    beforeEach(() => {
      const configNoAuth: FullServerConfig = {
        name: 'test-server',
        version: '1.0.0',
        transport: 'http',
        http: {
          enabled: true,
          host: '127.0.0.1',
          port: 3847,
          // No cloudflareAccess
        },
      };

      app = express();
      app.use(express.json());

      // Health endpoints
      const healthRouter = express.Router();
      registerHealthRoutes(healthRouter, configNoAuth);
      app.use(healthRouter);

      // MCP endpoint without auth middleware
      app.post('/mcp', (_req, res) => {
        res.json({ result: 'ok' });
      });
    });

    it('allows /mcp without auth when not configured', async () => {
      const response = await request(app).post('/mcp').send({ test: true });

      expect(response.status).toBe(200);
    });
  });
});

describe('createRateLimiter custom configuration', () => {
  it('accepts custom maxRequests and windowMs', async () => {
    const app = express();
    app.use(createRateLimiter(2, 1000)); // 2 requests per second
    app.get('/test', (_req, res) => res.json({ ok: true }));

    // First two should succeed
    const r1 = await request(app).get('/test');
    const r2 = await request(app).get('/test');
    // Third should be rate limited
    const r3 = await request(app).get('/test');

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.body.message).toContain('2 requests per 1 seconds');
  });
});
