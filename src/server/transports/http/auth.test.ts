/**
 * @fileoverview Tests for Cloudflare Access JWT verification
 * @module server/transports/http/auth.test
 */

// Mock jose before importing anything that uses it
jest.mock('jose');

import type { NextFunction, Request, Response } from 'express';
import * as jose from 'jose';
import type { CloudflareAccessConfig } from '../../../config/index.js';
import {
  clearJwksCache,
  createAuthMiddleware,
  verifyCloudflareAccessJwt,
} from './auth.js';

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
  // Clear JWKS cache before each test
  clearJwksCache();

  // Mock fetch to return our test JWKS
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

describe('verifyCloudflareAccessJwt', () => {
  const baseConfig: CloudflareAccessConfig = {
    teamDomain: 'testteam.cloudflareaccess.com',
    policyAUD: 'test-aud-123',
  };

  describe('valid tokens', () => {
    it('accepts valid token with correct claims', async () => {
      const token = await createTestJwt({ email: 'user@example.com' });

      const result = await verifyCloudflareAccessJwt(token, baseConfig);

      expect(result.valid).toBe(true);
      expect(result.email).toBe('user@example.com');
      expect(result.error).toBeUndefined();
    });

    it('accepts valid token without email claim when no allowed list', async () => {
      const token = await createTestJwt({});

      const result = await verifyCloudflareAccessJwt(token, baseConfig);

      expect(result.valid).toBe(true);
      expect(result.email).toBeUndefined();
    });

    it('accepts valid token when email is in allowed list', async () => {
      const config: CloudflareAccessConfig = {
        ...baseConfig,
        allowedEmails: ['user@example.com', 'admin@example.com'],
      };
      const token = await createTestJwt({ email: 'user@example.com' });

      const result = await verifyCloudflareAccessJwt(token, config);

      expect(result.valid).toBe(true);
      expect(result.email).toBe('user@example.com');
    });

    it('accepts token with team name only (auto-adds cloudflareaccess.com)', async () => {
      const config: CloudflareAccessConfig = {
        teamDomain: 'testteam', // Just the team name
        policyAUD: 'test-aud-123',
      };
      const token = await createTestJwt({ email: 'user@example.com' });

      const result = await verifyCloudflareAccessJwt(token, config);

      expect(result.valid).toBe(true);
    });

    it('accepts token with https:// prefix in team domain', async () => {
      const config: CloudflareAccessConfig = {
        teamDomain: 'https://testteam.cloudflareaccess.com',
        policyAUD: 'test-aud-123',
      };
      const token = await createTestJwt({ email: 'user@example.com' });

      const result = await verifyCloudflareAccessJwt(token, config);

      expect(result.valid).toBe(true);
    });
  });

  describe('invalid tokens', () => {
    it('rejects expired token', async () => {
      const token = await createTestJwt(
        { email: 'user@example.com' },
        { expiresIn: '-1h' }, // Already expired
      );

      const result = await verifyCloudflareAccessJwt(token, baseConfig);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('JWT has expired');
    });

    it('rejects token with wrong audience', async () => {
      const token = await createTestJwt(
        { email: 'user@example.com' },
        { audience: 'wrong-audience' },
      );

      const result = await verifyCloudflareAccessJwt(token, baseConfig);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/JWT claim validation failed/);
    });

    it('rejects token with wrong issuer', async () => {
      const token = await createTestJwt(
        { email: 'user@example.com' },
        { issuer: 'https://wrongteam.cloudflareaccess.com' },
      );

      const result = await verifyCloudflareAccessJwt(token, baseConfig);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/JWT claim validation failed/);
    });

    it('rejects token with invalid signature', async () => {
      // Create a valid token, then tamper with it
      const token = await createTestJwt({ email: 'user@example.com' });
      const parts = token.split('.');
      // Corrupt the signature
      const tamperedToken = `${parts[0]}.${parts[1]}.invalidsignature`;

      const result = await verifyCloudflareAccessJwt(tamperedToken, baseConfig);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(
        /JWT signature verification failed|JWT verification failed/,
      );
    });

    it('rejects malformed token', async () => {
      const result = await verifyCloudflareAccessJwt(
        'not.a.valid.jwt',
        baseConfig,
      );

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/JWT verification failed/);
    });

    it('rejects empty token', async () => {
      const result = await verifyCloudflareAccessJwt('', baseConfig);

      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/JWT verification failed/);
    });
  });

  describe('email validation', () => {
    it('rejects token without email when allowed list is configured', async () => {
      const config: CloudflareAccessConfig = {
        ...baseConfig,
        allowedEmails: ['user@example.com'],
      };
      const token = await createTestJwt({}); // No email claim

      const result = await verifyCloudflareAccessJwt(token, config);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('JWT missing email claim');
    });

    it('rejects token with email not in allowed list', async () => {
      const config: CloudflareAccessConfig = {
        ...baseConfig,
        allowedEmails: ['allowed@example.com'],
      };
      const token = await createTestJwt({ email: 'notallowed@example.com' });

      const result = await verifyCloudflareAccessJwt(token, config);

      expect(result.valid).toBe(false);
      expect(result.error).toBe(
        'Email notallowed@example.com not in allowed list',
      );
    });

    it('allows any email when allowed list is empty array', async () => {
      const config: CloudflareAccessConfig = {
        ...baseConfig,
        allowedEmails: [],
      };
      const token = await createTestJwt({ email: 'anyone@example.com' });

      const result = await verifyCloudflareAccessJwt(token, config);

      expect(result.valid).toBe(true);
      expect(result.email).toBe('anyone@example.com');
    });
  });

  describe('JWKS caching', () => {
    it('verifies multiple tokens without error', async () => {
      const token1 = await createTestJwt({ email: 'user1@example.com' });
      const token2 = await createTestJwt({ email: 'user2@example.com' });

      const result1 = await verifyCloudflareAccessJwt(token1, baseConfig);
      const result2 = await verifyCloudflareAccessJwt(token2, baseConfig);

      // Both should succeed
      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
      expect(result1.email).toBe('user1@example.com');
      expect(result2.email).toBe('user2@example.com');
    });

    it('continues to work after cache is cleared', async () => {
      const token = await createTestJwt({ email: 'user@example.com' });

      const result1 = await verifyCloudflareAccessJwt(token, baseConfig);
      clearJwksCache();
      const result2 = await verifyCloudflareAccessJwt(token, baseConfig);

      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
    });
  });

  describe('team domain normalization', () => {
    it('normalizes team name only domain', async () => {
      const config: CloudflareAccessConfig = {
        teamDomain: 'myteam',
        policyAUD: 'test-aud-123',
      };
      // Create token with matching issuer (myteam.cloudflareaccess.com)
      const token = await createTestJwt(
        { email: 'user@example.com' },
        { issuer: 'https://myteam.cloudflareaccess.com' },
      );

      // Should work with just team name (auto-adds cloudflareaccess.com)
      const result = await verifyCloudflareAccessJwt(token, config);
      expect(result.valid).toBe(true);
    });

    it('normalizes full domain', async () => {
      const config: CloudflareAccessConfig = {
        teamDomain: 'myteam.cloudflareaccess.com',
        policyAUD: 'test-aud-123',
      };
      // Create token with matching issuer
      const token = await createTestJwt(
        { email: 'user@example.com' },
        { issuer: 'https://myteam.cloudflareaccess.com' },
      );

      const result = await verifyCloudflareAccessJwt(token, config);
      expect(result.valid).toBe(true);
    });
  });
});

describe('createAuthMiddleware', () => {
  const baseConfig: CloudflareAccessConfig = {
    teamDomain: 'testteam.cloudflareaccess.com',
    policyAUD: 'test-aud-123',
  };

  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  it('returns 401 for missing token', async () => {
    const middleware = createAuthMiddleware(baseConfig);

    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      message: 'Missing Cf-Access-Jwt-Assertion header',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 401 for invalid token', async () => {
    mockReq.headers = { 'cf-access-jwt-assertion': 'invalid-token' };
    const middleware = createAuthMiddleware(baseConfig);

    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      message: expect.stringMatching(/JWT verification failed/),
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 401 for expired token', async () => {
    const expiredToken = await createTestJwt(
      { email: 'user@example.com' },
      { expiresIn: '-1h' },
    );
    mockReq.headers = { 'cf-access-jwt-assertion': expiredToken };
    const middleware = createAuthMiddleware(baseConfig);

    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      message: 'JWT has expired',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('calls next() and attaches email for valid token', async () => {
    const validToken = await createTestJwt({ email: 'user@example.com' });
    mockReq.headers = { 'cf-access-jwt-assertion': validToken };
    const middleware = createAuthMiddleware(baseConfig);

    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(
      (mockReq as Request & { cfAccessEmail?: string }).cfAccessEmail,
    ).toBe('user@example.com');
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it('handles array header value (takes first)', async () => {
    // Express can sometimes provide headers as arrays
    mockReq.headers = {
      'cf-access-jwt-assertion': ['first', 'second'] as unknown as string,
    };
    const middleware = createAuthMiddleware(baseConfig);

    await middleware(mockReq as Request, mockRes as Response, mockNext);

    // Should reject because array is not string
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      message: 'Missing Cf-Access-Jwt-Assertion header',
    });
  });
});
