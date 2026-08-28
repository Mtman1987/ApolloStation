export const BINGO_CENTER_INDEX = 12;
export const BINGO_CENTER_PLACEHOLDER = "SET YOUR PERSONAL PHRASE";
export const BINGO_CARD_SIZE = 25;
export const BINGO_SHARED_SQUARES = 24;

export type BingoClaimV1 = { claimedAt?: string; actorUserId?: string; [key: string]: unknown };
export type PersonalBingoBoardV1 = {
  centerPhrase: string;
  covered: Record<string, BingoClaimV1>;
  wonAt?: string;
  updatedAt?: string;
};
export type BingoStateV1 = { templatePhrases: string[]; personalBoards: Record<string, PersonalBingoBoardV1> };

export function normalizeBingoTemplatePhrases(values: readonly unknown[]): string[] {
  const source = Array.isArray(values) ? values.map((value) => String(value ?? "").slice(0, 120)) : [];
  const phrases = source.slice(0, BINGO_CARD_SIZE);
  while (phrases.length < BINGO_CARD_SIZE) phrases.push("");
  phrases[BINGO_CENTER_INDEX] = BINGO_CENTER_PLACEHOLDER;
  return phrases;
}

export function defaultBingoState(templatePhrases: readonly unknown[] = []): BingoStateV1 {
  return { templatePhrases: normalizeBingoTemplatePhrases(templatePhrases), personalBoards: {} };
}

export function normalizePersonalBingoBoard(value: Partial<PersonalBingoBoardV1> | null | undefined): PersonalBingoBoardV1 {
  return {
    centerPhrase: String(value?.centerPhrase ?? "").trim().slice(0, 120),
    covered: value?.covered && typeof value.covered === "object" ? { ...value.covered } : {},
    ...(value?.wonAt ? { wonAt: String(value.wonAt) } : {}),
    ...(value?.updatedAt ? { updatedAt: String(value.updatedAt) } : {}),
  };
}

export function normalizeBingoState(value: Partial<BingoStateV1> | null | undefined): BingoStateV1 {
  return {
    templatePhrases: normalizeBingoTemplatePhrases(value?.templatePhrases ?? []),
    personalBoards: Object.fromEntries(Object.entries(value?.personalBoards ?? {}).map(([playerKey, board]) => [cleanPlayerKey(playerKey), normalizePersonalBingoBoard(board)])),
  };
}

export function getPersonalBingoBoard(state: BingoStateV1, playerKeyValue: string, create = true): PersonalBingoBoardV1 | null {
  const playerKey = cleanPlayerKey(playerKeyValue);
  let board = state.personalBoards[playerKey];
  if (!board && create) {
    board = { centerPhrase: "", covered: {}, updatedAt: new Date().toISOString() };
    state.personalBoards[playerKey] = board;
  }
  if (!board) return null;
  const normalized = normalizePersonalBingoBoard(board);
  state.personalBoards[playerKey] = normalized;
  return normalized;
}

export function personalBingoView(stateInput: BingoStateV1, playerKey?: string | null) {
  const state = normalizeBingoState(stateInput);
  const phrases = [...state.templatePhrases];
  if (!playerKey) return { phrases, covered: {}, centerPhrase: "", centerPhraseSet: false, wonAt: null };
  const board = getPersonalBingoBoard(state, playerKey, false);
  const centerPhrase = String(board?.centerPhrase ?? "").trim();
  phrases[BINGO_CENTER_INDEX] = centerPhrase || BINGO_CENTER_PLACEHOLDER;
  return { phrases, covered: board?.covered ?? {}, centerPhrase, centerPhraseSet: Boolean(centerPhrase), wonAt: board?.wonAt ?? null };
}

export function setPersonalBingoCenter(state: BingoStateV1, playerKey: string, phraseValue: unknown, now = new Date()): PersonalBingoBoardV1 {
  const phrase = String(phraseValue ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (phrase.length < 2) throw new Error("Choose a personal Bingo phrase first.");
  const board = getPersonalBingoBoard(state, playerKey, true)!;
  if (board.covered[String(BINGO_CENTER_INDEX)]) throw new Error("Your center square is already claimed on this card. Change it after the next board reset.");
  board.centerPhrase = phrase;
  board.updatedAt = now.toISOString();
  return board;
}

export function claimPersonalBingoSquare(state: BingoStateV1, playerKey: string, squareInput: number, claim: BingoClaimV1 = {}, now = new Date()) {
  const square = Math.trunc(Number(squareInput));
  if (!Number.isInteger(square) || square < 0 || square >= BINGO_CARD_SIZE) throw new Error("Bingo square must be from 0 through 24");
  const board = getPersonalBingoBoard(state, playerKey, true)!;
  if (square === BINGO_CENTER_INDEX && !board.centerPhrase.trim()) throw new Error("Choose a personal Bingo phrase before claiming the center square.");
  const key = String(square);
  if (!board.covered[key]) board.covered[key] = { ...claim, claimedAt: claim.claimedAt ?? now.toISOString() };
  board.updatedAt = now.toISOString();
  const won = hasBingo(board.covered);
  if (won && !board.wonAt) board.wonAt = now.toISOString();
  return { board, square, newlyWon: won && board.wonAt === now.toISOString(), won };
}

export function resetPersonalBingoProgress(state: BingoStateV1, now = new Date()): void {
  const updatedAt = now.toISOString();
  for (const board of Object.values(state.personalBoards)) {
    board.covered = {};
    delete board.wonAt;
    board.updatedAt = updatedAt;
  }
}

export function hasBingo(covered: Record<string, unknown>): boolean {
  const claimed = new Set(Object.keys(covered || {}).map(Number).filter(Number.isInteger));
  for (let row = 0; row < 5; row += 1) if ([0, 1, 2, 3, 4].map((offset) => row * 5 + offset).every((square) => claimed.has(square))) return true;
  for (let col = 0; col < 5; col += 1) if ([0, 1, 2, 3, 4].map((offset) => col + offset * 5).every((square) => claimed.has(square))) return true;
  return [0, 6, 12, 18, 24].every((square) => claimed.has(square)) || [4, 8, 12, 16, 20].every((square) => claimed.has(square));
}

export function bingoCardStats(stateInput: BingoStateV1) {
  const state = normalizeBingoState(stateInput);
  const boards = Object.values(state.personalBoards);
  return {
    total: BINGO_CARD_SIZE,
    sharedSquares: BINGO_SHARED_SQUARES,
    centerIndex: BINGO_CENTER_INDEX,
    centerMode: "personal" as const,
    players: boards.length,
    claims: boards.reduce((sum, board) => sum + Object.keys(board.covered).length, 0),
    completedCards: boards.filter((board) => Boolean(board.wonAt)).length,
  };
}

function cleanPlayerKey(value: string) {
  const clean = String(value ?? "").trim().toLowerCase();
  if (!clean || clean.length > 160 || /[\r\n\0]/.test(clean)) throw new Error("Bingo player key is invalid");
  return clean;
}
