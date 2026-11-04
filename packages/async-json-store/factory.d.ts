import type { AsyncJsonRecordStore } from "./index.mjs";
export interface AsyncJsonRecordStoreOptions {
  service: string;
  mode?: "sqlite" | "turso";
  databasePath?: string;
  url?: string;
  authToken?: string;
}
export declare function scopeAsyncJsonRecordStore(store: AsyncJsonRecordStore, service: string): AsyncJsonRecordStore;
export declare function createAsyncJsonRecordStore(options: AsyncJsonRecordStoreOptions): AsyncJsonRecordStore;
