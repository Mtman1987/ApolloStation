import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { guestConfigFrom, readCookie, signSessionClaims, verifySessionClaims, type SessionSigningConfig } from './guest-session.js';

// Twitch login for HearMeOut (HMO-001). The donor hands the OAuth exchange to DSH. Apollo
// has no DSH, so the exchange runs here. The client secret stays in this process.
// The state value is checked against a short-lived HttpOnly cookie. The session is a signed
// cookie using the same secret and tenant as guest sessions. Off (404) unless Twitch
// credentials and the guest signing config are set. The Twitch access token is discarded.

export const TWITCH_SESSION_COOKIE = 'hmo_twitch';
export const TWITCH_STATE_COOKIE = 'hmo_twitch_state';
export const TWITCH_SESSION_TTL_SECONDS = 12 * 60 * 60;
const STATE_TTL_SECONDS = 600;
const SUBJECT_PREFIX = 'twitch_';

export interface TwitchLoginConfig extends SessionSigningConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function twitchLoginConfigFrom(environment: NodeJS.ProcessEnv): TwitchLoginConfig | undefined {
  const guest = guestConfigFrom(environment);
  const clientId = (environment.TWITCH_CLIENT_ID ?? '').trim();
  const clientSecret = (environment.TWITCH_CLIENT_SECRET ?? '').trim();
  const redirectUri = (environment.TWITCH_REDIRECT_URI ?? '').trim();
  if (!guest || !clientId || !clientSecret || !redirectUri) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return undefined;
  }
  // The redirect must be https, or plain http only for a loopback development host.
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) return undefined;
  return { ...guest, clientId, clientSecret, redirectUri };
}

export interface TwitchLoginDeps {
  fetchImpl?: typeof fetch;
  now?: number;
}

// Routes: GET /api/auth/twitch starts the flow. GET /api/auth/twitch/callback finishes it.
export async function handleTwitchLoginRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  config: TwitchLoginConfig | undefined,
  deps: TwitchLoginDeps = {},
): Promise<boolean> {
  if (url.pathname !== '/api/auth/twitch' && url.pathname !== '/api/auth/twitch/callback') return false;
  if (!config) {
    sendJson(response, 404, { error: 'Not found' });
    return true;
  }
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return true;
  }
  const now = deps.now ?? Date.now();
  const secure = url.protocol === 'https:' || request.headers['x-forwarded-proto'] === 'https';
  const cookieAttributes = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

  if (url.pathname === '/api/auth/twitch') {
    const state = randomBytes(24).toString('base64url');
    const authorize = new URL('https://id.twitch.tv/oauth2/authorize');
    authorize.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'user:read:email',
      state,
    }).toString();
    response.setHeader('set-cookie', `${TWITCH_STATE_COOKIE}=${state}; Max-Age=${STATE_TTL_SECONDS}; ${cookieAttributes}`);
    response.writeHead(302, { location: authorize.toString(), 'cache-control': 'no-store' });
    response.end();
    return true;
  }

  // Callback. The state cookie is cleared on every outcome, so it cannot be replayed.
  const clearState = `${TWITCH_STATE_COOKIE}=; Max-Age=0; ${cookieAttributes}`;
  const fail = (code: string) => {
    response.setHeader('set-cookie', clearState);
    redirect(response, `/?login_error=${encodeURIComponent(code)}`);
    return true;
  };

  if (url.searchParams.get('error')) return fail('twitch_denied');
  const code = url.searchParams.get('code') ?? '';
  const queryState = url.searchParams.get('state') ?? '';
  const cookieState = readCookie(request, TWITCH_STATE_COOKIE) ?? '';
  if (!code || !queryState || !cookieState || !safeEqual(queryState, cookieState)) return fail('twitch_state');

  const fetchImpl = deps.fetchImpl ?? fetch;
  let user: { id: string; login: string; displayName: string };
  try {
    user = await exchangeAndFetchUser(code, config, fetchImpl);
  } catch {
    return fail('twitch_exchange');
  }
  const cookie = signSessionClaims(`${SUBJECT_PREFIX}${user.id}`, user.displayName || user.login, config, TWITCH_SESSION_TTL_SECONDS, now);
  response.setHeader('set-cookie', [
    clearState,
    `${TWITCH_SESSION_COOKIE}=${cookie}; Max-Age=${TWITCH_SESSION_TTL_SECONDS}; ${cookieAttributes}`,
  ]);
  redirect(response, '/');
  return true;
}

// Reads a Twitch session cookie. Returns undefined unless the signature, tenant, and
// expiry all check out and the subject is a Twitch subject.
export function verifyTwitchSessionCookie(cookieValue: string | undefined, config: TwitchLoginConfig, now: number = Date.now()) {
  const claims = verifySessionClaims(cookieValue, config, SUBJECT_PREFIX, now);
  if (!claims) return undefined;
  return { tenantId: claims.tenantId, userId: claims.userId, displayName: claims.name, roles: ['member'] as ['member'] };
}

async function exchangeAndFetchUser(code: string, config: TwitchLoginConfig, fetchImpl: typeof fetch) {
  const tokenResponse = await fetchImpl('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error('token exchange failed');
  const tokens = await tokenResponse.json() as { access_token?: unknown };
  if (typeof tokens.access_token !== 'string' || !tokens.access_token) throw new Error('no access token');

  const userResponse = await fetchImpl('https://api.twitch.tv/helix/users', {
    headers: { 'Client-ID': config.clientId, Authorization: `Bearer ${tokens.access_token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!userResponse.ok) throw new Error('user lookup failed');
  const body = await userResponse.json() as { data?: Array<{ id?: unknown; login?: unknown; display_name?: unknown }> };
  const first = body.data?.[0];
  if (!first || typeof first.id !== 'string' || !/^\d{1,20}$/.test(first.id)) throw new Error('invalid user');
  return {
    id: first.id,
    login: typeof first.login === 'string' ? first.login.slice(0, 64) : first.id,
    displayName: typeof first.display_name === 'string' ? first.display_name.slice(0, 64) : '',
  };
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location, 'cache-control': 'no-store' });
  response.end();
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
