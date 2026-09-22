export class HearMeOutSpotlightBridge {
  constructor(
    private readonly workerOrigin: string,
    private readonly authorization: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const url = new URL(workerOrigin);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Spotlight worker origin is invalid');
    }
    if (!/^Bearer [^\r\n]{16,}$/.test(authorization)) throw new Error('Spotlight worker authorization is invalid');
    this.workerOrigin = url.origin;
  }

  status() {
    return this.json('/spotlight/status', { method: 'GET' });
  }

  start() {
    return this.json('/spotlight/start', { method: 'POST' });
  }

  async media(file: string, range?: string) {
    if (!/^(?:index\.m3u8|spotlight_\d{6}\.ts)$/.test(file)) throw Object.assign(Error('Spotlight media file is invalid'), { status: 404 });
    const response = await this.fetchImpl(new URL('/spotlight/hls/' + encodeURIComponent(file), this.workerOrigin), {
      headers: { authorization: this.authorization, accept: '*/*', ...(range ? { range } : {}) },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok && response.status !== 206) throw Object.assign(Error('Spotlight broadcast is not ready'), { status: response.status });
    return response;
  }

  private async json(path: string, init: { method: 'GET' | 'POST' }) {
    const response = await this.fetchImpl(new URL(path, this.workerOrigin), {
      ...init,
      headers: { authorization: this.authorization, accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) throw Object.assign(Error(String(body?.error || 'Spotlight worker request failed')), { status: response.status });
    return body || {};
  }
}
