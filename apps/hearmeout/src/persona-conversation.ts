export const HEARMEOUT_PERSONA_AUDIO_MAX_BASE64_LENGTH = 16_000_000;

export interface HearMeOutPublicPersonaV1 {
  personaId: string;
  targetTenantId: string;
  displayName: string;
  wakeNames: string[];
  canInvite: boolean;
  canTalk?: boolean;
  transportHealthy: boolean;
  blockedReason?: string;
}

export interface HearMeOutPersonaSpeechV1 {
  audioDataUri?: string;
  voice?: string;
}

export interface HearMeOutPersonaCommandResponseV1 {
  response: string;
  bot: { tenantId: string; name: string };
  tts?: HearMeOutPersonaSpeechV1;
  [key: string]: unknown;
}

export interface HearMeOutPersonaConversationPortsV1 {
  listPublicPersonas(): Promise<HearMeOutPublicPersonaV1[]>;
  inspectWorkerPersona(roomId: string, targetTenantId: string): Promise<{ active: boolean; transportHealthy: boolean; displayName?: string }>;
  transcribe(input: { base64Audio: string }): Promise<{ transcription: string }>;
  invoke(input: { roomId: string; targetTenantId: string; command: string; actorUserId?: string; actorUsername: string; actorDisplayName: string; voice?: string; speak: true }): Promise<HearMeOutPersonaCommandResponseV1>;
  speak(input: { roomId: string; personaId: string; audioDataUri: string }): Promise<{ bytes?: number; transportHealthy: boolean }>;
  controlPersona?(input: { action: "join" | "leave"; roomId: string; persona: HearMeOutPublicPersonaV1; serviceSession: boolean }): Promise<{ transportHealthy?: boolean; [key: string]: unknown }>;
  clearStalePresence?(roomId: string, personaId: string): Promise<void>;
}

export interface HearMeOutPublicActorV1 { userId?: string; username?: string; displayName?: string; }

/**
 * Public room conversation orchestration. The adapter is expected to use the
 * canonical SPMT/StreamWeaver service boundary; browsers never receive a
 * provider token, StreamWeaver secret, or a persona-owner credential.
 */
export class HearMeOutPersonaConversationCoordinator {
  constructor(private readonly ports: HearMeOutPersonaConversationPortsV1) {}

  async gallery() {
    const values = await this.ports.listPublicPersonas();
    return values.map(normalizePersona);
  }

  async transcribe(base64AudioValue: string) {
    const base64Audio = validateAudioBase64(base64AudioValue);
    const result = await this.ports.transcribe({ base64Audio });
    const transcription = message(result.transcription, "transcription", 5_000);
    return { transcription };
  }

  async control(input: { action: "join" | "leave"; roomId: string; persona: HearMeOutPublicPersonaV1 }) {
    const roomId = identifier(input.roomId, "roomId"), persona = normalizePersona(input.persona);
    if (!persona.canInvite) throw new Error(`${persona.displayName} is not shared for HearMeOut room use`);
    if (!this.ports.controlPersona) throw new Error("HearMeOut persona transport is unavailable");
    const worker = await this.ports.controlPersona({ action: input.action, roomId, persona, serviceSession: input.action === "join" });
    if (input.action === "join" && worker.transportHealthy === false) throw new HearMeOutPersonaUnavailableError("Persona joined without a healthy audio transport");
    return { action: input.action, roomId, persona, worker };
  }

  async command(input: { roomId: string; targetTenantId: string; command: string; actor?: HearMeOutPublicActorV1; voice?: string; speak?: boolean }) {
    const roomId = identifier(input.roomId, "roomId"), targetTenantId = identifier(input.targetTenantId, "targetTenantId"), command = message(input.command, "command", 5_000);
    const live = await this.ports.inspectWorkerPersona(roomId, targetTenantId);
    if (!live.active || !live.transportHealthy) {
      await this.ports.clearStalePresence?.(roomId, targetTenantId).catch(() => undefined);
      throw new HearMeOutPersonaUnavailableError("That persona is not active and healthy in this room");
    }
    const actorUsername = optionalLabel(input.actor?.username, 100) || optionalLabel(input.actor?.displayName, 100) || "Guest";
    const actorDisplayName = optionalLabel(input.actor?.displayName, 100) || actorUsername;
    const actorUserId = optionalIdentifier(input.actor?.userId);
    const voice = optionalLabel(input.voice, 128);
    const response = await this.ports.invoke({ roomId, targetTenantId, command, ...(actorUserId ? { actorUserId } : {}), actorUsername, actorDisplayName, ...(voice ? { voice } : {}), speak: true });
    const reply = message(response.response, "persona response", 20_000), personaId = identifier(response.bot?.tenantId || targetTenantId, "personaId"), botName = optionalLabel(response.bot?.name, 120) || live.displayName || targetTenantId;
    let personaSpeech: { attempted: boolean; ok?: boolean; error?: string; bytes?: number; transportHealthy?: boolean } = { attempted: false };
    const audioDataUri = response.tts?.audioDataUri;
    if (input.speak !== false && audioDataUri) {
      try {
        const audio = validateAudioDataUri(audioDataUri), result = await this.ports.speak({ roomId, personaId, audioDataUri: audio });
        personaSpeech = { attempted: true, ok: result.transportHealthy, ...(result.bytes === undefined ? {} : { bytes: result.bytes }), transportHealthy: result.transportHealthy };
        if (!result.transportHealthy) await this.ports.clearStalePresence?.(roomId, personaId).catch(() => undefined);
      } catch (error) {
        await this.ports.clearStalePresence?.(roomId, personaId).catch(() => undefined);
        personaSpeech = { attempted: true, ok: false, error: safeError(error) };
      }
    }
    return { payload: response, reply, botName, personaSpeech };
  }
}

export class HearMeOutPersonaUnavailableError extends Error {}

function normalizePersona(value: HearMeOutPublicPersonaV1): HearMeOutPublicPersonaV1 { const blockedReason=optionalLabel(value.blockedReason,300);return { personaId: identifier(value.personaId, "personaId"), targetTenantId: identifier(value.targetTenantId, "targetTenantId"), displayName: optionalLabel(value.displayName, 120) || value.personaId, wakeNames: [...new Set((value.wakeNames ?? []).map((item) => optionalLabel(item, 96)).filter((item): item is string => Boolean(item)))].slice(0, 50), canInvite: value.canInvite === true,canTalk:value.canTalk!==false, transportHealthy: value.transportHealthy === true,...(blockedReason?{blockedReason}:{}) }; }
function validateAudioBase64(value: string) { const result = String(value ?? "").trim(); if (!result || result.length > HEARMEOUT_PERSONA_AUDIO_MAX_BASE64_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(result)) throw new Error("HearMeOut recorded audio is invalid or too large"); return result; }
function validateAudioDataUri(value: string) { if (!/^data:audio\/(?:mpeg|mp3|wav|ogg|webm);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 30_000_000) throw new Error("HearMeOut persona speech audio is invalid"); return value; }
function identifier(value: unknown, name: string) { const result = String(value ?? "").trim(); if (!/^[A-Za-z0-9._:@/-]{1,200}$/.test(result)) throw new Error(`HearMeOut ${name} is invalid`); return result; }
function optionalIdentifier(value: unknown) { const result = String(value ?? "").trim(); return result ? identifier(result, "actor user id") : ""; }
function optionalLabel(value: unknown, max: number) { const result = String(value ?? "").trim(); if (!result) return ""; if (result.length > max || /[\r\n\0]/.test(result)) throw new Error("HearMeOut label is invalid"); return result; }
function message(value: unknown, name: string, max: number) { const result = String(value ?? "").trim(); if (!result || result.length > max || /\0/.test(result)) throw new Error(`HearMeOut ${name} is invalid`); return result; }
function safeError(value: unknown) { return (value instanceof Error ? value.message : String(value)).replace(/(?:authorization|token|secret|password|cookie)\s*[:=]?\s*\S+/gi, "$1=[redacted]").slice(0, 500); }
