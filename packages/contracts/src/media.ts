/** Shared media bytes live in SPMT storage; jobs and app state carry these references. */
export const MEDIA_ASSET_MAX_BYTES = 8 * 1024 * 1024;
export type MediaAssetPurposeV1 = "recording" | "speech" | "image" | "avatar" | "attachment" | "video";
export interface MediaAssetV1 {
  schemaVersion: 1;
  id: string;
  tenantId: string;
  ownerUserId: string;
  sourceAppId: string;
  purpose: MediaAssetPurposeV1;
  name: string;
  contentType: string;
  byteLength: number;
  sha256: string;
  createdAt: string;
  expiresAt?: string;
  jobId?: string;
  /** Opaque, explicitly published URL. Deleting publication revokes it immediately. */
  publicUrl?: string;
}
export interface MediaAssetUploadV1 {
  name: string;
  contentType: string;
  purpose: MediaAssetPurposeV1;
  expiresInSeconds?: number;
}
export interface MediaAssetJobContextV1 { jobId: string; leaseId: string; fencingEpoch: number; }
export interface MediaAssetListV1 { assets: MediaAssetV1[]; nextCursor?: string; usedBytes: number; limitBytes: number; }
