import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export interface RecoveryInventoryV1 {
  users: number;
  providerLinks: number;
  workspaces: number;
  xpEvents: number;
  platformEvents: number;
  auditRecords: number;
  serviceIdentities: number;
  tenants: number;
  apps: number;
  appInstalls: number;
  entitlements: number;
  overlayWidgets: number;
  overlayOutputGrants: number;
  runtimeProjections: number;
  usageEvents: number;
  userProfiles: number;
  userCredentials: number;
  oauthClients: number;
  oauthCodes: number;
  commlinkConversations: number;
  commlinkMessages: number;
  commlinkLiveChat: number;
  notifications: number;
  webhooks: number;
  stellarContext: number;
  stellarCapabilities: number;
}

export interface RecoverySnapshotDescriptorV1 {
  format: string;
  authorityEpoch: number;
  journalSequence: number;
  inventory: RecoveryInventoryV1;
  integrity: "ok";
}

export interface RecoverySnapshotSourceV1 {
  createSnapshot(destinationPath: string): Promise<RecoverySnapshotDescriptorV1>;
}

export interface RecoveryPointMetadataV1 extends RecoverySnapshotDescriptorV1 {
  schemaVersion: 1;
  recoveryId: string;
  createdAt: string;
  plaintextSha256: string;
  plaintextBytes: number;
}

export interface RecoveryPointManifestV1 {
  schemaVersion: 1;
  metadata: RecoveryPointMetadataV1;
  encryption: {
    algorithm: "aes-256-gcm";
    iv: string;
    authTag: string;
    ciphertextSha256: string;
    ciphertextBytes: number;
  };
}

export interface RecoveryVerificationV1 {
  recoveryId: string;
  verified: true;
  authorityEpoch: number;
  journalSequence: number;
  inventory: RecoveryInventoryV1;
  plaintextSha256: string;
}

export interface FileRecoveryVaultOptions {
  rootDir: string;
  key: Uint8Array;
  source: RecoverySnapshotSourceV1;
  now?: () => string;
  idFactory?: () => string;
}

export class RecoveryVerificationError extends Error {
  constructor(message: string) { super(message); this.name = "RecoveryVerificationError"; }
}

export class FileRecoveryVault {
  private readonly rootDir: string;
  private readonly key: Buffer;
  private readonly source: RecoverySnapshotSourceV1;
  private readonly now: () => string;
  private readonly idFactory: () => string;

  constructor(options: FileRecoveryVaultOptions) {
    if (!options.rootDir) throw new Error("Recovery vault rootDir is required");
    if (options.key.byteLength !== 32) throw new Error("Recovery vault key must be exactly 32 bytes");
    this.rootDir = options.rootDir;
    this.key = Buffer.from(options.key);
    this.source = options.source;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? (() => `rp_${Date.now().toString(36)}_${randomBytes(8).toString("hex")}`);
  }

  async capture(): Promise<RecoveryPointManifestV1> {
    await mkdir(this.rootDir, { recursive: true });
    const recoveryId = validateRecoveryId(this.idFactory());
    const snapshotTemp = join(this.rootDir, `.${recoveryId}.snapshot.tmp`);
    try {
      const descriptor = await this.source.createSnapshot(snapshotTemp);
      validateDescriptor(descriptor);
      const plaintext = await readFile(snapshotTemp);
      const metadata: RecoveryPointMetadataV1 = {
        schemaVersion: 1,
        recoveryId,
        createdAt: this.now(),
        ...descriptor,
        plaintextSha256: sha256(plaintext),
        plaintextBytes: plaintext.byteLength,
      };
      const aad = Buffer.from(JSON.stringify(metadata));
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.key, iv);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const manifest: RecoveryPointManifestV1 = {
        schemaVersion: 1,
        metadata,
        encryption: {
          algorithm: "aes-256-gcm",
          iv: iv.toString("base64url"),
          authTag: cipher.getAuthTag().toString("base64url"),
          ciphertextSha256: sha256(ciphertext),
          ciphertextBytes: ciphertext.byteLength,
        },
      };
      await atomicWrite(this.cipherPath(recoveryId), ciphertext);
      await atomicWrite(this.manifestPath(recoveryId), Buffer.from(JSON.stringify(manifest, null, 2)));
      await this.verify(recoveryId);
      return manifest;
    } finally {
      await rm(snapshotTemp, { force: true });
    }
  }

  async verify(recoveryId: string): Promise<RecoveryVerificationV1> {
    const manifest = await this.readManifest(recoveryId);
    const ciphertext = await readFile(this.cipherPath(recoveryId));
    if (ciphertext.byteLength !== manifest.encryption.ciphertextBytes) throw new RecoveryVerificationError("Ciphertext size mismatch");
    if (sha256(ciphertext) !== manifest.encryption.ciphertextSha256) throw new RecoveryVerificationError("Ciphertext digest mismatch");
    const plaintext = this.decrypt(manifest, ciphertext);
    if (plaintext.byteLength !== manifest.metadata.plaintextBytes) throw new RecoveryVerificationError("Plaintext size mismatch");
    if (sha256(plaintext) !== manifest.metadata.plaintextSha256) throw new RecoveryVerificationError("Plaintext digest mismatch");
    return {
      recoveryId: manifest.metadata.recoveryId,
      verified: true,
      authorityEpoch: manifest.metadata.authorityEpoch,
      journalSequence: manifest.metadata.journalSequence,
      inventory: { ...manifest.metadata.inventory },
      plaintextSha256: manifest.metadata.plaintextSha256,
    };
  }

  async materialize(recoveryId: string, destinationPath: string): Promise<RecoveryPointManifestV1> {
    if (!destinationPath) throw new Error("Recovery destination path is required");
    const manifest = await this.readManifest(recoveryId);
    const ciphertext = await readFile(this.cipherPath(recoveryId));
    if (sha256(ciphertext) !== manifest.encryption.ciphertextSha256) throw new RecoveryVerificationError("Ciphertext digest mismatch");
    const plaintext = this.decrypt(manifest, ciphertext);
    if (sha256(plaintext) !== manifest.metadata.plaintextSha256) throw new RecoveryVerificationError("Plaintext digest mismatch");
    await atomicWrite(destinationPath, plaintext);
    return manifest;
  }

  private async readManifest(recoveryId: string): Promise<RecoveryPointManifestV1> {
    const safe = validateRecoveryId(recoveryId);
    const parsed = JSON.parse((await readFile(this.manifestPath(safe))).toString("utf8")) as RecoveryPointManifestV1;
    validateManifest(parsed, safe);
    return parsed;
  }

  private decrypt(manifest: RecoveryPointManifestV1, ciphertext: Buffer) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(manifest.encryption.iv, "base64url"));
      decipher.setAAD(Buffer.from(JSON.stringify(manifest.metadata)));
      decipher.setAuthTag(Buffer.from(manifest.encryption.authTag, "base64url"));
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new RecoveryVerificationError("Recovery authentication failed");
    }
  }

  private manifestPath(recoveryId: string) { return join(this.rootDir, `${validateRecoveryId(recoveryId)}.manifest.json`); }
  private cipherPath(recoveryId: string) { return join(this.rootDir, `${validateRecoveryId(recoveryId)}.snapshot.enc`); }
}

function sha256(value: Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
function validateRecoveryId(value: string) {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(value)) throw new Error("Recovery ID is invalid");
  return value;
}
function validateDescriptor(value: RecoverySnapshotDescriptorV1) {
  if (!value || value.integrity !== "ok" || !Number.isSafeInteger(value.authorityEpoch) || value.authorityEpoch < 1 || !Number.isSafeInteger(value.journalSequence) || value.journalSequence < 0) throw new Error("Recovery snapshot descriptor is invalid");
  for (const count of Object.values(value.inventory)) if (!Number.isSafeInteger(count) || count < 0) throw new Error("Recovery inventory is invalid");
}
function validateManifest(value: RecoveryPointManifestV1, recoveryId: string) {
  if (value?.schemaVersion !== 1 || value.metadata?.schemaVersion !== 1 || value.metadata?.recoveryId !== recoveryId || value.encryption?.algorithm !== "aes-256-gcm") throw new RecoveryVerificationError("Recovery manifest is invalid");
  validateDescriptor(value.metadata);
  if (!/^[0-9a-f]{64}$/.test(value.metadata.plaintextSha256) || !/^[0-9a-f]{64}$/.test(value.encryption.ciphertextSha256)) throw new RecoveryVerificationError("Recovery digest is invalid");
}
async function atomicWrite(path: string, bytes: Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  await writeFile(temp, bytes, { flag: "wx" });
  await rename(temp, path);
}
