import type { ExecutionTargetV1 } from "@spmt/contracts";

export const STELLAR_CHAT_CAPABILITY_ID = "stellar-core.ai-chat.v1";
export const STELLAR_CHAT_REQUEST_KIND = "stellar-chat-request.v1";
export const STELLAR_CHAT_RESULT_KIND = "stellar-chat-result.v1";
export type StellarRoutingPreferenceV1 = "automatic" | "hosted" | "companion";
export interface StellarRouteDecisionV1 { executionTarget: ExecutionTargetV1; meteringTarget: "hosted" | "companion"; fallbackReason?: string; }
