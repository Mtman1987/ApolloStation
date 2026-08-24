export interface NebulaGameV1 { id: string; name: string; commands: string[]; }

export const NEBULA_ARCADE_GAMES: readonly NebulaGameV1[] = Object.freeze([
  ["chat-tag", "Chat Tag", ["join", "leave", "status", "score", "tag", "pass"]],
  ["quackverse", "Quackverse", ["join", "leave", "status", "accept"]],
  ["bingo", "Bingo", ["join", "leave", "status", "accept"]],
  ["chaosmode", "Chaos Mode", ["join", "leave", "status"]],
  ["chatgarden", "Chat Garden", ["join", "leave", "status"]],
  ["chatwars", "Chat Wars", ["join", "leave", "status"]],
  ["chickenroyale", "Chicken Royale", ["join", "leave", "status", "start"]],
  ["colorsymphony", "Color Symphony", ["join", "leave", "status"]],
  ["colorwars", "Color Wars", ["join", "leave", "status"]],
  ["dancingparade", "Dancing Parade", ["join", "leave", "status", "dance"]],
  ["emojirain", "Emoji Rain", ["join", "leave", "status"]],
  ["emojitower", "Emoji Tower", ["join", "leave", "status", "drop"]],
  ["memorylane", "Memory Lane", ["join", "leave", "status"]],
  ["petrace", "Pet Race", ["join", "leave", "status"]],
  ["phraseguess", "Phrase Guess", ["join", "leave", "status"]],
  ["pixelbattle", "Pixel Battle", ["join", "leave", "status"]],
  ["rhythmpulse", "Rhythm Pulse", ["join", "leave", "status"]],
  ["treasurehunt", "Treasure Hunt", ["join", "leave", "status", "accept"]],
  ["wordchain", "Word Chain", ["join", "leave", "status"]],
  ["wordstorm", "Word Storm", ["join", "leave", "status"]],
].map(([id, name, commands]) => ({ id: id as string, name: name as string, commands: commands as string[] })));

export interface NebulaCommandTargetV1 { gameId: string; command: string; args: string[]; }

export function routeNebulaCommand(text: string, enabledGameIds: readonly string[], pendingGameIds: readonly string[] = []): NebulaCommandTargetV1[] {
  const match = /^!(\S+)(?:\s+(.*))?$/i.exec(text.trim());
  if (!match) return [];
  const command = match[1]!.toLowerCase();
  const args = match[2]?.trim().split(/\s+/).filter(Boolean) ?? [];
  const enabled = new Set(enabledGameIds);
  const pending = new Set(pendingGameIds);
  return NEBULA_ARCADE_GAMES
    .filter((game) => enabled.has(game.id) && game.commands.includes(command) && (command !== "accept" || pending.has(game.id)))
    .map((game) => ({ gameId: game.id, command, args }));
}
