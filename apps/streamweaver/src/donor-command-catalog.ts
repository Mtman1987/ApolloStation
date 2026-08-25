export type StreamWeaverDonorCommandFamilyV1 =
  | "economy"
  | "social"
  | "links"
  | "twitch"
  | "moderation"
  | "community"
  | "watchtime"
  | "music"
  | "redeem"
  | "system"
  | "persona"
  | "pokemon"
  | "secret";

export interface StreamWeaverDonorCommandV1 {
  donorId: string;
  trigger: string;
  family: StreamWeaverDonorCommandFamilyV1;
  cooldownSeconds: number;
  aliasFor?: string;
  matcher?: "command" | "regex" | "bare";
}

/**
 * Frozen from Mtman1987/streamweaver@387acf70552f9a6a557a83e8804c328245932961
 * SPMT_COMMAND_CATALOG.md. Duplicate donor definitions are intentionally kept:
 * preservation counts definitions, while routing de-duplicates equivalent work.
 */
export const STREAMWEAVER_DONOR_COMMANDS: readonly StreamWeaverDonorCommandV1[] = [
  { donorId:"accept", trigger:"!accept", family:"community", cooldownSeconds:0 },
  { donorId:"add-points", trigger:"!addpoints", family:"economy", cooldownSeconds:0 },
  { donorId:"add-to-all", trigger:"!addtoall", family:"economy", cooldownSeconds:0 },
  { donorId:"bic", trigger:"!bic", family:"community", cooldownSeconds:5 },
  { donorId:"bitsleader", trigger:"!bitsleader", family:"community", cooldownSeconds:0 },
  { donorId:"bleader", trigger:"!bleader", family:"community", cooldownSeconds:0 },
  { donorId:"boop", trigger:"!boop", family:"social", cooldownSeconds:2 },
  { donorId:"brb", trigger:"!brb", family:"moderation", cooldownSeconds:0 },
  { donorId:"cleader", trigger:"!cleader", family:"community", cooldownSeconds:0 },
  { donorId:"clip", trigger:"!clip", family:"twitch", cooldownSeconds:0 },
  { donorId:"coinflip", trigger:"!coinflip", family:"social", cooldownSeconds:2 },
  { donorId:"commands-chat", trigger:"!commands", family:"system", cooldownSeconds:120 },
  { donorId:"commands-system", trigger:"!commands", family:"system", cooldownSeconds:10 },
  { donorId:"cuddle", trigger:"!cuddle", family:"social", cooldownSeconds:2 },
  { donorId:"dance", trigger:"!dance", family:"social", cooldownSeconds:2 },
  { donorId:"discord", trigger:"!discord", family:"links", cooldownSeconds:0 },
  { donorId:"fistbump", trigger:"!fistbump", family:"social", cooldownSeconds:2 },
  { donorId:"followage", trigger:"!followage", family:"twitch", cooldownSeconds:5 },
  { donorId:"followed", trigger:"!followed", family:"twitch", cooldownSeconds:4 },
  { donorId:"followers", trigger:"!followers", family:"twitch", cooldownSeconds:0 },
  { donorId:"gamble", trigger:"!gamble", family:"economy", cooldownSeconds:10 },
  { donorId:"gambel", trigger:"!gambel", family:"economy", cooldownSeconds:10, aliasFor:"!gamble" },
  { donorId:"givepoints", trigger:"!givepoints", family:"economy", cooldownSeconds:0 },
  { donorId:"headpat", trigger:"!headpat", family:"social", cooldownSeconds:2 },
  { donorId:"highfive", trigger:"!highfive", family:"social", cooldownSeconds:2 },
  { donorId:"hover", trigger:"!hover", family:"links", cooldownSeconds:0 },
  { donorId:"hug", trigger:"!hug", family:"social", cooldownSeconds:2 },
  { donorId:"hydrate", trigger:"!hydrate", family:"redeem", cooldownSeconds:0 },
  { donorId:"instagram", trigger:"!instagram", family:"links", cooldownSeconds:0 },
  { donorId:"leader", trigger:"!leader", family:"community", cooldownSeconds:0 },
  { donorId:"love", trigger:"!love", family:"social", cooldownSeconds:2 },
  { donorId:"lurk-chat", trigger:"!lurk", family:"social", cooldownSeconds:60 },
  { donorId:"lurk-automation", trigger:"!lurk", family:"persona", cooldownSeconds:60 },
  { donorId:"merch", trigger:"!merch", family:"links", cooldownSeconds:0 },
  { donorId:"no", trigger:"!no", family:"community", cooldownSeconds:0 },
  { donorId:"pleader", trigger:"!pleader", family:"economy", cooldownSeconds:0 },
  { donorId:"points", trigger:"!points", family:"economy", cooldownSeconds:0 },
  { donorId:"raidmessage", trigger:"!raidmessage", family:"moderation", cooldownSeconds:0 },
  { donorId:"reset-all-points", trigger:"!resetallpoints", family:"economy", cooldownSeconds:0 },
  { donorId:"roll", trigger:"!roll", family:"economy", cooldownSeconds:2 },
  { donorId:"setgame", trigger:"!setgame", family:"moderation", cooldownSeconds:0 },
  { donorId:"set-points", trigger:"!setpoints", family:"economy", cooldownSeconds:0 },
  { donorId:"settitle", trigger:"!settitle", family:"moderation", cooldownSeconds:0 },
  { donorId:"set-to-all", trigger:"!settoall", family:"economy", cooldownSeconds:0 },
  { donorId:"show", trigger:"!show", family:"social", cooldownSeconds:0 },
  { donorId:"so", trigger:"!so", family:"moderation", cooldownSeconds:0 },
  { donorId:"sr", trigger:"!sr", family:"music", cooldownSeconds:5 },
  { donorId:"stats", trigger:"!stats", family:"community", cooldownSeconds:0 },
  { donorId:"stealpoints", trigger:"!stealpoints", family:"economy", cooldownSeconds:0 },
  { donorId:"stretch", trigger:"!stretch", family:"redeem", cooldownSeconds:0 },
  { donorId:"translate", trigger:"!t", family:"community", cooldownSeconds:0 },
  { donorId:"tickle", trigger:"!tickle", family:"social", cooldownSeconds:2 },
  { donorId:"tiktok", trigger:"!tiktok", family:"links", cooldownSeconds:0 },
  { donorId:"time", trigger:"!time", family:"community", cooldownSeconds:0 },
  { donorId:"twitter", trigger:"!twitter", family:"links", cooldownSeconds:0 },
  { donorId:"unlurk", trigger:"!unlurk", family:"social", cooldownSeconds:60 },
  { donorId:"uptime", trigger:"!uptime", family:"twitch", cooldownSeconds:0 },
  { donorId:"watchtime", trigger:"!watchtime", family:"watchtime", cooldownSeconds:0 },
  { donorId:"webpage", trigger:"!webpage", family:"links", cooldownSeconds:0 },
  { donorId:"welcomemode", trigger:"!welcomemode", family:"system", cooldownSeconds:0 },
  { donorId:"wleader", trigger:"!wleader", family:"watchtime", cooldownSeconds:0 },
  { donorId:"yes", trigger:"!yes", family:"community", cooldownSeconds:0 },
  { donorId:"youtube", trigger:"!youtube", family:"links", cooldownSeconds:0 },
  { donorId:"yup", trigger:"!yup", family:"community", cooldownSeconds:0 },
  { donorId:"secret-bird", trigger:"(?i).*@?bird.*", family:"secret", cooldownSeconds:0, matcher:"regex" },
  { donorId:"secret-stickers", trigger:"(?i).*@?stickers.*", family:"secret", cooldownSeconds:0, matcher:"regex" },
  { donorId:"secret-konami", trigger:"(?i).*@?UUDDLRLRAB.*", family:"secret", cooldownSeconds:0, matcher:"regex" },
  { donorId:"persona-chat-call", trigger:"(?i).*@?{{BOT_NAME}}.*", family:"persona", cooldownSeconds:0, matcher:"regex" },
  { donorId:"persona-athenacall", trigger:"(?i).*@?{{BOT_NAME}}.*", family:"persona", cooldownSeconds:0, matcher:"regex" },
  { donorId:"persona-chat-call-bot", trigger:"(?i).*@?{{BOT_NAME}}.*", family:"persona", cooldownSeconds:0, matcher:"regex" },
  { donorId:"pokemon-pack", trigger:"pack", family:"pokemon", cooldownSeconds:0, matcher:"bare" },
] as const;

export const STREAMWEAVER_DONOR_DEFINITION_COUNT = 70;

export function donorCommandsByFamily(family: StreamWeaverDonorCommandFamilyV1) {
  return STREAMWEAVER_DONOR_COMMANDS.filter((command) => command.family === family);
}

export function canonicalDonorCommandTrigger(trigger: string) {
  const normalized = trigger.trim().toLowerCase();
  return STREAMWEAVER_DONOR_COMMANDS.find((command) => command.trigger.toLowerCase() === normalized)?.aliasFor ?? normalized;
}
