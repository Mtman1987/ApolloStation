
import {DatabaseSync} from 'node:sqlite';

// Durable Watch request state ported from the donor's watch-request-service
// (pendingRecommendations and seriesProgress, previously JSON in watch-state.json).
// Rows are scoped by tenant and user, and recommendations also by session.
// Only stable identifiers and display fields are stored. Playback URLs,
// provider credentials and signed sources are rejected and never persisted.

export type HearMeOutSeriesProgressV1 = {
  provider: 'xtream';
  seriesId: string;
  seriesTitle: string;
  nextSeasonNumber: number;
  nextEpisodeNumber: number;
  updatedAt: number;
};

export type HearMeOutPendingRecommendationV1 = {
  itemId: string;
  title: string;
  kind: 'movie' | 'series' | 'episode' | 'music' | 'live';
  year?: number;
  savedAt: number;
};

export type HearMeOutWatchStateScope = { tenantId: string; userId: string };

const idPattern = /^[A-Za-z0-9_:.-]{1,200}$/;
const forbiddenKeys = ['playbackUrl', 'url', 'token', 'credential', 'authorization', 'password', 'secret'];
const kinds = new Set(['movie', 'series', 'episode', 'music', 'live']);

function cleanId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !idPattern.test(value)) throw Error(`Invalid ${label}`);
  return value;
}

function cleanText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`Invalid ${label}`);
  return value.trim();
}

function cleanInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 100000) throw Error(`Invalid ${label}`);
  return value as number;
}

function rejectSecrets(input: object) {
  for (const key of Object.keys(input)) {
    if (forbiddenKeys.includes(key.toLowerCase())) throw Error('Watch state cannot store playback or credential fields');
  }
}

export class HearMeOutWatchStateStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS hmo_watch_recommendations(' +
        'tenant TEXT NOT NULL,session_id TEXT NOT NULL,user_id TEXT NOT NULL,body TEXT NOT NULL,' +
        'PRIMARY KEY(tenant,session_id,user_id)) STRICT',
    );
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS hmo_watch_series_progress(' +
        'tenant TEXT NOT NULL,user_id TEXT NOT NULL,series_id TEXT NOT NULL,body TEXT NOT NULL,' +
        'PRIMARY KEY(tenant,user_id,series_id)) STRICT',
    );
  }

  close() {
    this.db.close();
  }

  setRecommendation(scope: HearMeOutWatchStateScope, sessionId: string, input: Omit<HearMeOutPendingRecommendationV1, 'savedAt'> & { savedAt?: number }) {
    rejectSecrets(input);
    const sid = cleanId(sessionId, 'session');
    const kind = input.kind;
    if (!kinds.has(kind)) throw Error('Invalid recommendation kind');
    const item: HearMeOutPendingRecommendationV1 = {
      itemId: cleanId(input.itemId, 'recommendation item'),
      title: cleanText(input.title, 'recommendation title', 300),
      kind,
      ...(input.year === undefined ? {} : { year: cleanInteger(input.year, 'recommendation year') }),
      savedAt: input.savedAt ?? Date.now(),
    };
    this.db
      .prepare('INSERT INTO hmo_watch_recommendations(tenant,session_id,user_id,body) VALUES(?,?,?,?) ON CONFLICT(tenant,session_id,user_id) DO UPDATE SET body=excluded.body')
      .run(scope.tenantId, sid, scope.userId, JSON.stringify(item));
    return item;
  }

  // Reading a recommendation consumes it, so accepting twice cannot queue it twice.
  takeRecommendation(scope: HearMeOutWatchStateScope, sessionId: string): HearMeOutPendingRecommendationV1 | undefined {
    const sid = cleanId(sessionId, 'session');
    const row = this.db
      .prepare('SELECT body FROM hmo_watch_recommendations WHERE tenant=? AND session_id=? AND user_id=?')
      .get(scope.tenantId, sid, scope.userId) as { body: string } | undefined;
    if (!row) return undefined;
    this.db.prepare('DELETE FROM hmo_watch_recommendations WHERE tenant=? AND session_id=? AND user_id=?').run(scope.tenantId, sid, scope.userId);
    return JSON.parse(String(row.body)) as HearMeOutPendingRecommendationV1;
  }

  saveSeriesProgress(scope: HearMeOutWatchStateScope, input: Omit<HearMeOutSeriesProgressV1, 'provider' | 'updatedAt'> & { updatedAt?: number }) {
    rejectSecrets(input);
    const seriesId = cleanId(input.seriesId, 'series');
    const progress: HearMeOutSeriesProgressV1 = {
      provider: 'xtream',
      seriesId,
      seriesTitle: cleanText(input.seriesTitle, 'series title', 300),
      nextSeasonNumber: cleanInteger(input.nextSeasonNumber, 'season number'),
      nextEpisodeNumber: cleanInteger(input.nextEpisodeNumber, 'episode number'),
      updatedAt: input.updatedAt ?? Date.now(),
    };
    this.db
      .prepare('INSERT INTO hmo_watch_series_progress(tenant,user_id,series_id,body) VALUES(?,?,?,?) ON CONFLICT(tenant,user_id,series_id) DO UPDATE SET body=excluded.body')
      .run(scope.tenantId, scope.userId, seriesId, JSON.stringify(progress));
    return progress;
  }

  getSeriesProgress(scope: HearMeOutWatchStateScope, seriesId: string): HearMeOutSeriesProgressV1 | undefined {
    const row = this.db
      .prepare('SELECT body FROM hmo_watch_series_progress WHERE tenant=? AND user_id=? AND series_id=?')
      .get(scope.tenantId, scope.userId, cleanId(seriesId, 'series')) as { body: string } | undefined;
    return row ? (JSON.parse(String(row.body)) as HearMeOutSeriesProgressV1) : undefined;
  }
}
