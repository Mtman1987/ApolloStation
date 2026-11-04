import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Apollo-owned guest session for HearMeOut (owner-approved, 2026-10-28).
// It is a signed, expiring cookie. It is disabled unless HEARMEOUT_GUEST_SECRET and
// HEARMEOUT_GUEST_TENANT are both set. Each guest gets a fresh random id. The donor's
// shared dev_local_user is never ported. Guests have no SPMT scopes, so no admin path.

export const GUEST_COOKIE = 'hmo_guest';
export const GUEST_TTL_SECONDS = 12 * 60 * 60;
const MIN_SECRET_LENGTH = 32;

export interface GuestConfig {
  secret: string;
  tenantId: string;
}

export interface GuestPrincipal {
  tenantId: string;
  userId: string;
  displayName: string;
  roles: ['member'];
}

export function guestConfigFrom(environment: NodeJS.ProcessEnv): GuestConfig | undefined {
  const secret = (environment.HEARMEOUT_GUEST_SECRET ?? '').trim();
  const tenantId = (environment.HEARMEOUT_GUEST_TENANT ?? '').trim();
  if (secret.length < MIN_SECRET_LENGTH || !tenantId) return undefined;
  return { secret, tenantId };
}

function b64url(value: Buffer | string): string {
  return Buffer.from(value).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createGuestCookieValue(config: GuestConfig, now: number = Date.now()): string {
  const userId = `guest_${randomBytes(12).toString('base64url')}`;
  const payload = b64url(JSON.stringify({ sub: userId, tid: config.tenantId, exp: Math.floor(now / 1000) + GUEST_TTL_SECONDS }));
  return `${payload}.${sign(payload, config.secret)}`;
}

export function verifyGuestCookieValue(value: string | undefined, config: GuestConfig, now: number = Date.now()): GuestPrincipal | undefined {
  if (!value) return undefined;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra !== undefined) return undefined;
  const expected = Buffer.from(sign(payload, config.secret));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  let claims: { sub?: unknown; tid?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof claims.sub !== 'string' || !claims.sub.startsWith('guest_')) return undefined;
  if (claims.tid !== config.tenantId) return undefined;
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return undefined;
  return { tenantId: config.tenantId, userId: claims.sub, displayName: 'Guest', roles: ['member'] };
}

export function readCookie(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

// Routes: POST /api/auth/guest starts a guest session. POST /api/auth/guest/logout ends it.
// Both are off (404) unless guestConfig is set. Both require a same-origin request.
export async function handleGuestAuthRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  config: GuestConfig | undefined,
  now: number = Date.now(),
): Promise<boolean> {
  if (url.pathname !== '/api/auth/guest' && url.pathname !== '/api/auth/guest/logout') return false;
  if (!config) {
    sendJson(response, 404, { error: 'Not found' });
    return true;
  }
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return true;
  }
  if (!sameOrigin(request)) {
    sendJson(response, 403, { error: 'Cross-origin request refused' });
    return true;
  }
  const secure = url.protocol === 'https:' || request.headers['x-forwarded-proto'] === 'https';
  const attributes = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  if (url.pathname === '/api/auth/guest/logout') {
    response.setHeader('set-cookie', `${GUEST_COOKIE}=; Max-Age=0; ${attributes}`);
    sendJson(response, 200, { success: true });
    return true;
  }
  const value = createGuestCookieValue(config, now);
  response.setHeader('set-cookie', `${GUEST_COOKIE}=${value}; Max-Age=${GUEST_TTL_SECONDS}; ${attributes}`);
  sendJson(response, 200, { success: true });
  return true;
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return false;
  const host = request.headers.host ?? '';
  return origin === `https://${host}` || origin === `http://${host}`;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.byteLength,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

// Generic signed session claims, shared by Twitch login. The guest functions above
// are unchanged so their tests still pin the same behavior.
export interface SessionSigningConfig {
  secret: string;
  tenantId: string;
}

export function signSessionClaims(subject: string, name: string, config: SessionSigningConfig, ttlSeconds: number, now: number = Date.now()): string {
  const payload = b64url(JSON.stringify({
    sub: subject,
    tid: config.tenantId,
    name: name.slice(0, 64),
    exp: Math.floor(now / 1000) + ttlSeconds,
  }));
  return `${payload}.${sign(payload, config.secret)}`;
}

export function verifySessionClaims(
  value: string | undefined,
  config: SessionSigningConfig,
  subjectPrefix: string,
  now: number = Date.now(),
): { userId: string; name: string; tenantId: string } | undefined {
  if (!value) return undefined;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra !== undefined) return undefined;
  const expected = Buffer.from(sign(payload, config.secret));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  let claims: { sub?: unknown; tid?: unknown; name?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof claims.sub !== 'string' || !claims.sub.startsWith(subjectPrefix)) return undefined;
  if (claims.tid !== config.tenantId) return undefined;
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return undefined;
  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, 64) : claims.sub;
  return { userId: claims.sub, name, tenantId: config.tenantId };
}
