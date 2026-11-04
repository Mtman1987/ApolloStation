export interface AsyncJsonRecordView {
  get<T = unknown>(namespace: string, tenantId: string, recordKey: string): Promise<T | undefined>;
  put<T = unknown>(namespace: string, tenantId: string, recordKey: string, value: T): Promise<void>;
  delete(namespace: string, tenantId: string, recordKey: string): Promise<number>;
  list<T = unknown>(namespace: string, tenantId: string): Promise<Array<{ key: string; value: T }>>;
}
export interface AsyncJsonRecordStore extends AsyncJsonRecordView {
  initialize(): Promise<void>;
  health(): Promise<{ ready: boolean }>;
  transaction<T>(work: (tx: AsyncJsonRecordView) => Promise<T>): Promise<T>;
  close(): Promise<void> | void;
}
export declare class TursoJsonRecordStore implements AsyncJsonRecordStore {
  constructor(adapter: import("@spmt/turso-http").TursoHttpAdapter);
  initialize(): Promise<void>;
  health(): Promise<{ ready: boolean }>;
  get<T = unknown>(namespace: string, tenantId: string, recordKey: string): Promise<T | undefined>;
  put<T = unknown>(namespace: string, tenantId: string, recordKey: string, value: T): Promise<void>;
  delete(namespace: string, tenantId: string, recordKey: string): Promise<number>;
  list<T = unknown>(namespace: string, tenantId: string): Promise<Array<{ key: string; value: T }>>;
  transaction<T>(work: (tx: AsyncJsonRecordView) => Promise<T>): Promise<T>;
  close(): void;
}
export declare class SqliteJsonRecordStore implements AsyncJsonRecordStore {
  constructor(path: string);
  initialize(): Promise<void>;
  health(): Promise<{ ready: boolean }>;
  get<T = unknown>(namespace: string, tenantId: string, recordKey: string): Promise<T | undefined>;
  put<T = unknown>(namespace: string, tenantId: string, recordKey: string, value: T): Promise<void>;
  delete(namespace: string, tenantId: string, recordKey: string): Promise<number>;
  list<T = unknown>(namespace: string, tenantId: string): Promise<Array<{ key: string; value: T }>>;
  transaction<T>(work: (tx: AsyncJsonRecordView) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
