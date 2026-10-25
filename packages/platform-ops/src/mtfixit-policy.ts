import type { OperationsLogV1 } from "@spmt/contracts";

/**
 * Apollo-native MtFixIt policy.
 *
 * This module deliberately decides whether a repair may advance; it never
 * performs deployment or writes provider infrastructure. Callers persist the
 * returned decision through the shared operations/job contracts.
 */
export const MTVFIXIT_DEFAULT_CONFIDENCE_THRESHOLD = 80;
export const MTVFIXIT_MAX_FAILED_ATTEMPTS = 3;

export type MtFixItGateReasonV1 =
  | "blacklisted"
  | "proven-fix-code-tests-required"
  | "confidence-below-threshold"
  | "confidence-missing"
  | "checks-pending"
  | "checks-failed"
  | "eligible-for-review";

export interface MtFixItEvidenceV1 {
  fingerprint: string;
  confidencePercent?: number;
  failedAttempts: number;
  blacklisted: boolean;
  provenPatchId?: string;
  codeChecks: "pending" | "passed" | "failed";
  sandboxChecks: "pending" | "passed" | "failed" | "skipped";
}

export interface MtFixItGateDecisionV1 {
  allowed: boolean;
  requiresOwnerApproval: boolean;
  shouldRunSandbox: boolean;
  reason: MtFixItGateReasonV1;
  confidenceThreshold: number;
}

export function evaluateMtFixItGate(
  evidence: MtFixItEvidenceV1,
  threshold = MTVFIXIT_DEFAULT_CONFIDENCE_THRESHOLD,
): MtFixItGateDecisionV1 {
  const safeThreshold = Number.isFinite(threshold) ? Math.max(0, Math.min(100, threshold)) : MTVFIXIT_DEFAULT_CONFIDENCE_THRESHOLD;
  if (evidence.blacklisted || evidence.failedAttempts >= MTVFIXIT_MAX_FAILED_ATTEMPTS) {
    return { allowed: false, requiresOwnerApproval: true, shouldRunSandbox: false, reason: "blacklisted", confidenceThreshold: safeThreshold };
  }
  if (evidence.codeChecks === "failed") {
    return { allowed: false, requiresOwnerApproval: false, shouldRunSandbox: false, reason: "checks-failed", confidenceThreshold: safeThreshold };
  }
  if (evidence.codeChecks !== "passed") {
    return { allowed: false, requiresOwnerApproval: false, shouldRunSandbox: false, reason: "checks-pending", confidenceThreshold: safeThreshold };
  }
  if (evidence.provenPatchId) {
    return {
      allowed: evidence.sandboxChecks === "skipped" || evidence.sandboxChecks === "passed",
      requiresOwnerApproval: false,
      shouldRunSandbox: false,
      reason: "proven-fix-code-tests-required",
      confidenceThreshold: safeThreshold,
    };
  }
  if (evidence.confidencePercent === undefined || !Number.isFinite(evidence.confidencePercent)) {
    return { allowed: false, requiresOwnerApproval: true, shouldRunSandbox: true, reason: "confidence-missing", confidenceThreshold: safeThreshold };
  }
  if (evidence.confidencePercent < safeThreshold) {
    return { allowed: false, requiresOwnerApproval: true, shouldRunSandbox: true, reason: "confidence-below-threshold", confidenceThreshold: safeThreshold };
  }
  if (evidence.sandboxChecks === "failed") {
    return { allowed: false, requiresOwnerApproval: true, shouldRunSandbox: true, reason: "checks-failed", confidenceThreshold: safeThreshold };
  }
  if (evidence.sandboxChecks !== "passed") {
    return { allowed: false, requiresOwnerApproval: false, shouldRunSandbox: true, reason: "checks-pending", confidenceThreshold: safeThreshold };
  }
  return { allowed: true, requiresOwnerApproval: false, shouldRunSandbox: true, reason: "eligible-for-review", confidenceThreshold: safeThreshold };
}

export interface MtFixItIncidentFingerprintV1 {
  sourceAppId: string;
  level: string;
  message: string;
  route?: string;
  code?: string;
}

/** Stable, bounded fingerprint; omit volatile IDs, timestamps, and secrets. */
export function createMtFixItFingerprint(input: MtFixItIncidentFingerprintV1): string {
  const normalize = (value: string) => value
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, "<uuid>")
    .replace(/\b\d{10,}\b/g, "<number>")
    .replace(/\b(?:bearer|token|secret|password)\s+[^\s,;]+/gi, "[credential] <redacted>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return [input.sourceAppId, input.level, input.code ?? "", input.route ?? "", normalize(input.message)].join("|");
}

/** Log intake is intentionally a pure mapper; persistence and job creation stay in SPMT. */
export function mtFixItIncidentFromOperationsLog(log: OperationsLogV1): MtFixItIncidentFingerprintV1 {
  return {
    sourceAppId: log.sourceAppId,
    level: log.level,
    message: `${log.kind}: ${log.summary}${log.detail ? ` — ${log.detail}` : ""}`,
    ...(log.labels.length ? { route: log.labels.find((label) => label.startsWith("route:"))?.slice(6) } : {}),
    ...(log.labels.length ? { code: log.labels.find((label) => label.startsWith("code:"))?.slice(5) } : {}),
  };
}

/** Build an evidence-only coder draft; it does not authorize a merge or deploy. */
export function mtFixItCoderPrompt(input: {
  incident: MtFixItIncidentFingerprintV1;
  evidence: string[];
  attempt: number;
}): string {
  const evidence = input.evidence.slice(0, 20).map((line) => line.replace(/(?:bearer\s+|token[=: ]+)[^\s,;]+/gi, "[credential-redacted]").slice(0, 1000));
  return [
    "Investigate this Apollo MtFixIt incident using only the supplied, redacted evidence.",
    "Find the root cause before proposing a patch. Do not hide, suppress, or merely restart away recurring errors.",
    "Make the smallest behavior-preserving code change and add regression tests.",
    "Report a numeric line exactly as: Athena confidence: NN%. Explain evidence and uncertainty.",
    "All code tests must pass before sandbox validation. New patches require sandbox validation and confidence threshold.",
    "A proven patch may skip sandbox only after code tests pass and the fingerprint matches exactly.",
    "Never merge, deploy, mutate production, or access provider secrets autonomously.",
    `Incident fingerprint: ${createMtFixItFingerprint(input.incident)}`,
    `Attempt: ${Math.max(1, Math.floor(input.attempt))} of ${MTVFIXIT_MAX_FAILED_ATTEMPTS}`,
    "Evidence:",
    ...evidence.map((line) => `- ${line}`),
  ].join("\n");
}
