/**
 * @fileoverview Mock for jose library in Jest tests
 * @module server/transports/http/__mocks__/jose
 */

// Simulated key pair for testing
interface MockKeyPair {
  publicKey: { type: 'public' };
  privateKey: { type: 'private' };
}

const mockKeyPair: MockKeyPair = {
  publicKey: { type: 'public' },
  privateKey: { type: 'private' },
};

// Store for signed tokens and their payloads (for verification)
const tokenStore = new Map<string, { payload: Record<string, unknown>; exp: number }>();

// Mock JWK for export
const mockJwk = {
  kty: 'RSA',
  n: 'mock-n',
  e: 'AQAB',
  kid: 'test-key-id',
  alg: 'RS256',
  use: 'sig',
};

/**
 * Mock generateKeyPair function
 */
export async function generateKeyPair(_algorithm: string): Promise<MockKeyPair> {
  return mockKeyPair;
}

/**
 * Mock exportJWK function
 */
export async function exportJWK(_key: unknown): Promise<typeof mockJwk> {
  return { ...mockJwk };
}

/**
 * Mock createRemoteJWKSet - returns a function that resolves to the mock key
 */
export function createRemoteJWKSet(_url: URL): () => Promise<{ type: 'public' }> {
  return async () => mockKeyPair.publicKey;
}

/**
 * Mock SignJWT class
 */
export class SignJWT {
  private header: Record<string, unknown> = {};
  private payload: Record<string, unknown>;
  private expTime: string = '1h';

  constructor(payload: Record<string, unknown>) {
    this.payload = { ...payload };
  }

  setProtectedHeader(header: Record<string, unknown>): this {
    this.header = header;
    return this;
  }

  setIssuedAt(): this {
    this.payload.iat = Math.floor(Date.now() / 1000);
    return this;
  }

  setIssuer(issuer: string): this {
    this.payload.iss = issuer;
    return this;
  }

  setAudience(audience: string): this {
    this.payload.aud = audience;
    return this;
  }

  setExpirationTime(exp: string): this {
    this.expTime = exp;
    return this;
  }

  async sign(_key: unknown): Promise<string> {
    // Calculate expiration based on expTime
    const now = Math.floor(Date.now() / 1000);
    let expSeconds = now + 3600; // Default 1 hour

    if (this.expTime.startsWith('-')) {
      // Negative time means already expired
      const value = parseInt(this.expTime.slice(1), 10);
      expSeconds = now - value * 3600;
    } else if (this.expTime.endsWith('h')) {
      const hours = parseInt(this.expTime, 10);
      expSeconds = now + hours * 3600;
    }

    this.payload.exp = expSeconds;

    // Create a mock token
    const token = `mock.${Buffer.from(JSON.stringify(this.payload)).toString('base64url')}.signature`;

    // Store for verification
    tokenStore.set(token, { payload: this.payload, exp: expSeconds });

    return token;
  }
}

// Mock error classes
export const errors = {
  JWTExpired: class JWTExpired extends Error {
    constructor(message = 'JWT has expired') {
      super(message);
      this.name = 'JWTExpired';
    }
  },
  JWTClaimValidationFailed: class JWTClaimValidationFailed extends Error {
    constructor(message = 'JWT claim validation failed') {
      super(message);
      this.name = 'JWTClaimValidationFailed';
    }
  },
  JWSSignatureVerificationFailed: class JWSSignatureVerificationFailed extends Error {
    constructor(message = 'JWT signature verification failed') {
      super(message);
      this.name = 'JWSSignatureVerificationFailed';
    }
  },
};

interface JwtVerifyOptions {
  audience?: string;
  issuer?: string;
}

/**
 * Mock jwtVerify function
 */
export async function jwtVerify(
  token: string,
  _jwks: unknown,
  options: JwtVerifyOptions = {},
): Promise<{ payload: Record<string, unknown> }> {
  // Check for tampering
  if (token.includes('invalidsignature')) {
    throw new errors.JWSSignatureVerificationFailed('JWT signature verification failed');
  }

  // Check for malformed tokens
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) {
    throw new Error('JWT verification failed: Invalid token format');
  }

  // Try to decode payload
  let payload: Record<string, unknown>;
  try {
    const decoded = Buffer.from(parts[1], 'base64url').toString();
    payload = JSON.parse(decoded);
  } catch {
    throw new Error('JWT verification failed: Invalid payload');
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && typeof payload.exp === 'number' && payload.exp < now) {
    throw new errors.JWTExpired('JWT has expired');
  }

  // Check audience
  if (options.audience && payload.aud !== options.audience) {
    throw new errors.JWTClaimValidationFailed(
      `JWT claim validation failed: Expected aud to be ${options.audience}`,
    );
  }

  // Check issuer
  if (options.issuer && payload.iss !== options.issuer) {
    throw new errors.JWTClaimValidationFailed(
      `JWT claim validation failed: Expected iss to be ${options.issuer}`,
    );
  }

  return { payload };
}

// Export types for compatibility
export type JWK = typeof mockJwk & Record<string, unknown>;
