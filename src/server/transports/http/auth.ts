/**
 * @fileoverview Cloudflare Access JWT verification for HTTP transport
 * @module server/transports/http/auth
 * @description Verifies JWTs from Cloudflare Access for defense-in-depth security
 */

import type { NextFunction, Request, Response } from 'express';
import * as jose from 'jose';
import type { CloudflareAccessConfig } from '../../../config/index.js';

/** JWT verification result */
interface JwtVerificationResult {
  valid: boolean;
  email?: string;
  error?: string;
}

/** JWKS cache entry */
interface JwksCacheEntry {
  jwks: jose.JWTVerifyGetKey;
  expiresAt: number;
}

/** JWKS cache TTL in milliseconds (1 hour) */
const JWKS_CACHE_TTL = 60 * 60 * 1000;

/** JWKS cache keyed by team domain */
const jwksCache = new Map<string, JwksCacheEntry>();

/**
 * Gets the JWKS URL for a Cloudflare Access team domain
 * @param teamDomain - Cloudflare Access team domain
 * @returns JWKS URL
 */
function getJwksUrl(teamDomain: string): string {
  // Normalize domain - remove protocol if present and ensure .cloudflareaccess.com suffix
  let domain = teamDomain.replace(/^https?:\/\//, '');

  // If just the team name is provided, add the full domain
  if (!domain.includes('.')) {
    domain = `${domain}.cloudflareaccess.com`;
  }

  return `https://${domain}/cdn-cgi/access/certs`;
}

/**
 * Gets or creates a cached JWKS getter for the team domain
 * @param teamDomain - Cloudflare Access team domain
 * @returns JWKS getter function
 */
async function getJwks(teamDomain: string): Promise<jose.JWTVerifyGetKey> {
  const cached = jwksCache.get(teamDomain);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.jwks;
  }

  const jwksUrl = getJwksUrl(teamDomain);
  const jwks = jose.createRemoteJWKSet(new URL(jwksUrl));

  jwksCache.set(teamDomain, {
    jwks,
    expiresAt: Date.now() + JWKS_CACHE_TTL,
  });

  return jwks;
}

/**
 * Verifies a Cloudflare Access JWT
 *
 * @param token - JWT from Cf-Access-Jwt-Assertion header
 * @param config - Cloudflare Access configuration
 * @returns Verification result
 */
export async function verifyCloudflareAccessJwt(
  token: string,
  config: CloudflareAccessConfig,
): Promise<JwtVerificationResult> {
  try {
    const jwks = await getJwks(config.teamDomain);

    // Normalize team domain for issuer validation
    let normalizedDomain = config.teamDomain.replace(/^https?:\/\//, '');
    if (!normalizedDomain.includes('.')) {
      normalizedDomain = `${normalizedDomain}.cloudflareaccess.com`;
    }
    const expectedIssuer = `https://${normalizedDomain}`;

    const { payload } = await jose.jwtVerify(token, jwks, {
      audience: config.policyAUD,
      issuer: expectedIssuer,
    });

    // Extract email from payload
    const email = typeof payload.email === 'string' ? payload.email : undefined;

    // Validate email against allowed list if configured
    if (config.allowedEmails && config.allowedEmails.length > 0) {
      if (!email) {
        return {
          valid: false,
          error: 'JWT missing email claim',
        };
      }

      if (!config.allowedEmails.includes(email)) {
        return {
          valid: false,
          error: `Email ${email} not in allowed list`,
        };
      }
    }

    return {
      valid: true,
      email,
    };
  } catch (error) {
    if (error instanceof jose.errors.JWTExpired) {
      return {
        valid: false,
        error: 'JWT has expired',
      };
    }

    if (error instanceof jose.errors.JWTClaimValidationFailed) {
      return {
        valid: false,
        error: `JWT claim validation failed: ${error.message}`,
      };
    }

    if (error instanceof jose.errors.JWSSignatureVerificationFailed) {
      return {
        valid: false,
        error: 'JWT signature verification failed',
      };
    }

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    return {
      valid: false,
      error: `JWT verification failed: ${errorMessage}`,
    };
  }
}

/**
 * Express middleware that verifies Cloudflare Access JWTs
 * Returns 401 if no valid JWT is present
 *
 * @param config - Cloudflare Access configuration
 * @returns Express middleware function
 */
export function createAuthMiddleware(
  config: CloudflareAccessConfig,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    // Get JWT from Cloudflare Access header
    const token = req.headers['cf-access-jwt-assertion'];

    if (!token || typeof token !== 'string') {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing Cf-Access-Jwt-Assertion header',
      });
      return;
    }

    const result = await verifyCloudflareAccessJwt(token, config);

    if (!result.valid) {
      res.status(401).json({
        error: 'Unauthorized',
        message: result.error ?? 'JWT verification failed',
      });
      return;
    }

    // Attach verified email to request for logging
    (req as Request & { cfAccessEmail?: string }).cfAccessEmail = result.email;

    next();
  };
}

/**
 * Clears the JWKS cache (useful for testing)
 */
export function clearJwksCache(): void {
  jwksCache.clear();
}
