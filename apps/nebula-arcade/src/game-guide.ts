import { NEBULA_ARCADE_GAMES, parseNebulaMessage } from "./game-hub.js";

export const NEBULA_CONTINUATION_GAMES = new Set(["bingo", "chatgarden", "colorsymphony", "emojirain", "memorylane", "phraseguess", "rhythmpulse", "wordchain", "wordstorm"]);
const details: Record<string, { rules: string; actions?: string[]; answer?: string }> = {
  tag: { rules: "Join the round, then tag or pass to another joined player when eligible. A successful tag normally earns 100 points and costs the tagged player 50; double-points rounds multiply the reward. After tagging you receive 20 minutes of immunity, and immediate tagbacks are blocked. Hold up to three passes and spend at most three per 24 hours. Away or sleeping players are unavailable as targets.", actions: ["join", "leave", "tag @player", "pass @player", "givepass @player", "status", "score", "rank", "away", "sleep", "wake", "players", "live", "more", "pinrank", "mute", "unmute", "optout", "support <message>"] },
  quackverse: { rules: "Open up to four packs per day, collect cards and build a deck of up to 20 owned cards. Claim one of two battle seats and ready at least five cards, including a duck. Both players must join and ready before battling. Deploy, move, attack and end your turn on the A1–G7 board. Moderator reset preserves collections.", actions: ["pack", "quackpack", "collection", "deck", "deck add <card id>", "deck remove <card id>", "join", "ready", "hand", "deploy <card id> <cell>", "move <from> <to>", "attack <from> <to>", "end", "status", "reset"] },
  bingo: { rules: "Each player has a personal 5×5 board: 24 shared phrases and a personal center phrase. Joined players' spmt messages can mark matching phrases; ordinary chat is ignored. Claim a square from 1–25. Complete a row, column or diagonal to win. Moderators may replace the 24 shared phrases or reset progress.", actions: ["join", "card", "center <phrase>", "claim <1–25>", "phrases", "phrases <24 phrases separated by |>", "reset", "leave", "status"], answer: "<phrase>" },
  chaosmode: { rules: "Join the shared chaos display and trigger explosions, glitches, portals or screen shakes. Community activity increases the chaos level." },
  chatgarden: { rules: "Join the garden, then contribute plant words and emoji with spmt. Recognized words grow plants and affect the shared garden; ordinary chat does not enter the game.", answer: "<plant word or emoji>" },
  chatwars: { rules: "Choose red, blue, green or yellow. Your team's contributions compete for territory and power." },
  chickenroyale: { rules: "Join the lobby, then survive the chicken battle and shrinking arena. The last survivor wins. Only a broadcaster or moderator can start or stop the shared game." },
  colorsymphony: { rules: "Join the performance and contribute color words with spmt. Colors create notes and visual effects; consecutive contributions build harmony.", answer: "<color>" },
  colorwars: { rules: "Choose red, blue, green or yellow to paint territory for your team. Native rounds last 120 seconds; the team with the most coverage wins." },
  dancingparade: { rules: "Join the parade and dance to animate your character. The native parade supports up to 30 dancers." },
  emojirain: { rules: "Join and send emoji after spmt to make them fall on the overlay. Repeated emoji build combos and increase the rain intensity.", answer: "<emoji>" },
  emojitower: { rules: "Drop the moving emoji block onto the shared tower. Balance blocks against gravity and wind; unstable blocks can collapse the tower. Drops have a one-second cooldown." },
  memorylane: { rules: "Join the memory wall and share a message after spmt. Keywords and emoji become photo memories with themes and moods.", answer: "<memory message>" },
  petrace: { rules: "Choose a dog, cat, rabbit, turtle or hamster and join the race. Each pet has different speed, stamina and luck. Follow the race to the finish.", actions: ["join", "pet dog", "pet cat", "pet rabbit", "pet turtle", "pet hamster", "race", "start", "stop", "leave", "status"] },
  phraseguess: { rules: "Join and guess the hidden phrase after spmt. Clues reveal more of the phrase over time; matching uses the native game's similarity threshold.", answer: "<guess>" },
  pixelbattle: { rules: "Paint one cell with a supported color and coordinates x 0–19, y 0–14. Collaborate or compete on the shared pixel canvas.", actions: ["join", "paint <color> <x 0–19> <y 0–14>", "start", "stop", "leave", "status"] },
  rhythmpulse: { rules: "Join the beat performance and contribute rhythm words or musical emoji after spmt. Contributions build beats, combos and synchronization.", answer: "<beat word or emoji>" },
  treasurehunt: { rules: "Join the hunt and dig a coordinate to reveal hidden treasure. Discoveries award points and reveal clues. The current chat validator accepts A1–H8.", actions: ["join", "dig <A1–H8>", "start", "stop", "leave", "status"] },
  wordchain: { rules: "Join Word Chain, then submit one word of at least three letters starting with the last letter of the current word. Repeated words are rejected. Rounds start at 60 seconds; words of seven or more letters add five seconds. Themes choose starter words only: dictionary and category validation are not implemented. Score the word length; consecutive contributions by the same player increase the multiplier by 0.5 up to 3×. With HELLO on screen, spmt orange submits ORANGE; ordinary chat is ignored.", answer: "<word>" },
  wordstorm: { rules: "Join the live word cloud and contribute words after spmt. Repeated words grow and similar words create visual combos. Common filler words are filtered and old words fade.", answer: "<words>" },
};
export function nebulaGameGuide(gameId: string) {
  const game = NEBULA_ARCADE_GAMES.find(item => item.id === gameId);
  if (!game) throw new Error("Unknown Nebula game");
  const detail = details[game.id]!;
  const actions = detail.actions ?? [...new Set(["join", ...game.commands.filter(command => command !== "accept"), "start", "stop"])];
  const commands = actions.map(action => `spmt ${game.id} ${action}`);
  if (detail.answer) commands.push(`spmt ${game.id} ${detail.answer}`, `spmt ${detail.answer}`);
  commands.push(`spmt ${game.id} help`, `spmt ${game.id} rules`);
  return { game, rules: detail.rules, commands };
}
export function nebulaGuideLink(kind: "rules" | "commands", publicOrigin?: string, gameId?: string) {
  const path = `/apps/nebula-arcade?view=${kind}${gameId ? `#${gameId}` : ""}`;
  return publicOrigin ? new URL(path, publicOrigin).toString() : path;
}
export function nebulaGuideReplies(text: string, activeGameIds: readonly string[], publicOrigin?: string): string[] | undefined {
  const parsed = parseNebulaMessage(text);
  if (!parsed || !["help", "commands", "rules"].includes(parsed.command)) return;
  const kind = parsed.command === "rules" ? "rules" : "commands";
  const ids = parsed.gameId ? [parsed.gameId] : activeGameIds;
  const replies = ids.map(id => { const guide = nebulaGameGuide(id); return `${guide.game.name}: ${kind === "rules" ? guide.rules : guide.commands.join(" · ")}`; });
  replies.push(`${kind === "rules" ? "All game rules" : "All game commands"}${!ids.length ? " — no games are active in this channel" : ""}: ${nebulaGuideLink(kind, publicOrigin, parsed.gameId)}`);
  return replies;
}
