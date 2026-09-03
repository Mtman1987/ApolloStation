export const DSH_BOT_ACTIONS = ["dsh.shoutouts.active.read", "dsh.shoutouts.live.read", "dsh.shoutouts.post", "dsh.message.delete", "dsh.calendar.read", "dsh.calendar.captain.read", "dsh.calendar.captain.create", "dsh.calendar.event.create", "dsh.calendar.deploy", "dsh.calendar.refresh", "dsh.applications.read", "dsh.applications.deploy", "dsh.applications.decide"] as const;
export type DshBotActionIdV1 = typeof DSH_BOT_ACTIONS[number];
export interface DshBotActionRequestV1 { action: DshBotActionIdV1; tenantId: string; actorUserId?: string; actorRole: "guest" | "member" | "moderator" | "admin" | "owner"; args: Record<string, string>; idempotencyKey: string; }
export interface DshBotActionOperationsV1 {
  readShoutouts(input: DshBotActionRequestV1, liveOnly: boolean): Promise<Record<string, unknown>>;
  postShoutout(input: DshBotActionRequestV1): Promise<Record<string, unknown>>;
  deleteMessage?(input: DshBotActionRequestV1): Promise<Record<string, unknown>>;
  readCalendar(input: DshBotActionRequestV1, captainsLogOnly: boolean): Promise<Record<string, unknown>>;
  createCalendarEntry(input: DshBotActionRequestV1): Promise<Record<string, unknown>>;
  deployCalendar(input: DshBotActionRequestV1): Promise<Record<string, unknown>>;
  refreshCalendar(input: DshBotActionRequestV1): Promise<Record<string, unknown>>;
  readApplications(input: DshBotActionRequestV1): Promise<Record<string, unknown>>;
  deployApplications(input: DshBotActionRequestV1): Promise<Record<string, unknown>>;
  decideApplication(input: DshBotActionRequestV1): Promise<Record<string, unknown>>;
}

/** Keeps provider credentials and mutations inside DSH's app-owned operations. */
export class DshBotActionAdapter {
  constructor(private readonly operations: DshBotActionOperationsV1) {}
  execute(input: DshBotActionRequestV1): Promise<Record<string, unknown>> {
    if (!(DSH_BOT_ACTIONS as readonly string[]).includes(input.action)) throw new Error("Unsupported Discord Stream Hub bot action");
    const minimum = DSH_BOT_ACTION_MINIMUM_ROLE[input.action];
    if (roleLevel(input.actorRole) < roleLevel(minimum)) throw new Error(`${input.action} requires ${minimum} access`);
    if (input.action === "dsh.shoutouts.active.read" || input.action === "dsh.shoutouts.live.read") return this.operations.readShoutouts(input, input.action.endsWith(".live.read"));
    if (input.action === "dsh.shoutouts.post") return this.operations.postShoutout(input);
    if (input.action === "dsh.message.delete") { if (!this.operations.deleteMessage) throw new Error("DSH message deletion is unavailable"); return this.operations.deleteMessage(input); }
    if (input.action === "dsh.calendar.read" || input.action === "dsh.calendar.captain.read") return this.operations.readCalendar(input, input.action.endsWith(".captain.read"));
    if (input.action === "dsh.calendar.captain.create" || input.action === "dsh.calendar.event.create") return this.operations.createCalendarEntry(input);
    if (input.action === "dsh.calendar.deploy") return this.operations.deployCalendar(input);
    if (input.action === "dsh.calendar.refresh") return this.operations.refreshCalendar(input);
    if (input.action === "dsh.applications.read") return this.operations.readApplications(input);
    if (input.action === "dsh.applications.deploy") return this.operations.deployApplications(input);
    return this.operations.decideApplication(input);
  }
}

const DSH_BOT_ACTION_MINIMUM_ROLE: Record<DshBotActionIdV1, DshBotActionRequestV1["actorRole"]> = {
  "dsh.shoutouts.active.read": "member", "dsh.shoutouts.live.read": "member", "dsh.shoutouts.post": "moderator",
  "dsh.message.delete": "admin",
  "dsh.calendar.read": "member", "dsh.calendar.captain.read": "member", "dsh.calendar.captain.create": "member", "dsh.calendar.event.create": "admin", "dsh.calendar.deploy": "admin", "dsh.calendar.refresh": "admin",
  "dsh.applications.read": "admin", "dsh.applications.deploy": "admin", "dsh.applications.decide": "owner",
};
function roleLevel(role: DshBotActionRequestV1["actorRole"]): number { return { guest: 0, member: 1, moderator: 2, admin: 3, owner: 4 }[role]; }
