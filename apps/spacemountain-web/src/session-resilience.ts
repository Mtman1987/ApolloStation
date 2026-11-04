export type SpaceMountainSessionFailureV1 = "auth-rejected" | "temporarily-unavailable" | "invalid-response";
export function classifySpaceMountainSessionFailure(error: unknown): SpaceMountainSessionFailureV1 { const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: unknown }).status) : 0; if (status === 401 || status === 403) return "auth-rejected"; if (!status || status >= 500) return "temporarily-unavailable"; return "invalid-response"; }
export class SpaceMountainSessionRecoveryGate {
  private attempted = false;
  private explicitLogout = false;
  beginLogout() { this.explicitLogout = true; }
  authenticated() { this.attempted = false; this.explicitLogout = false; }
  canRecover(error: unknown) { if (this.explicitLogout || this.attempted || classifySpaceMountainSessionFailure(error) !== "auth-rejected") return false; this.attempted = true; return true; }
  snapshot() { return { schemaVersion: 1 as const, attempted: this.attempted, explicitLogout: this.explicitLogout }; }
}
