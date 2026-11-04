export type TursoValue = null | string | number | bigint | Uint8Array;
export interface TursoStatement { sql: string; args?: TursoValue[]; wantRows?: boolean; }
export interface TursoStatementResult { rows: unknown[][]; affectedRows: number; }
export interface TursoTransaction {
  execute(sql: string, args?: TursoValue[], wantRows?: boolean): Promise<TursoStatementResult>;
  pipeline(statements: TursoStatement[]): Promise<TursoStatementResult[]>;
}
export interface TursoHttpAdapterOptions { url: string; authToken: string; fetchImpl?: typeof fetch; }
export declare function encodeHranaValue(value: TursoValue | undefined): Record<string, unknown>;
export declare function decodeHranaValue(value: Record<string, unknown>): unknown;
export declare function normalizeTursoUrl(value: string): string;
export declare class TursoHttpAdapter {
  constructor(options: TursoHttpAdapterOptions);
  pipeline(statements: TursoStatement[]): Promise<TursoStatementResult[]>;
  execute(sql: string, args?: TursoValue[], wantRows?: boolean): Promise<TursoStatementResult>;
  transaction<T>(work: (tx: TursoTransaction) => Promise<T>, options?: { mode?: "deferred" | "immediate" | "exclusive" }): Promise<T>;
}
