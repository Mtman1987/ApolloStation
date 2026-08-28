export type QuackversePlayerId = "playerOne" | "playerTwo";

export type QuackverseSavedPiece = {
  instanceId?: string;
  owner: QuackversePlayerId;
  cardId: number;
  currentHp: number;
  maxHp: number;
  specialCurrent?: number;
  equipmentIds?: number[];
  fatigued?: boolean;
  fatigue?: number;
  stunnedTurns?: number;
  statModifiers?: { atk?: number; def?: number; spd?: number; spc?: number };
};

export type QuackverseCardInstance = { instanceId: string; cardId: number };
export type QuackverseBattlePileState = { drawPile: QuackverseCardInstance[]; hand: QuackverseCardInstance[]; discardPile: QuackverseCardInstance[] };
export type QuackverseTurnActions = { deployedOrMoved: boolean; attacked: string[]; usedAbility: string[]; equipped: string[] };
export type QuackverseSavedDeck = { id: string; name: string; cardIds: number[]; wins: number; losses: number; createdAt: string; updatedAt: string };
export type QuackverseCollectionState = {
  cards: number[];
  deck: number[];
  activeDeckId: string;
  savedDecks: QuackverseSavedDeck[];
  deckWins: number;
  deckLosses: number;
  openedAtDay: string;
  openedToday: number;
  lastPack: number[];
};

export type QuackverseSavedState = {
  gridSize: number;
  squadSize: number;
  activePlayer: QuackversePlayerId;
  turnNumber: number;
  squads: Record<QuackversePlayerId, number[]>;
  claimedPlayers: Record<QuackversePlayerId, string>;
  grid: Array<QuackverseSavedPiece | null>;
  battlePiles: Record<QuackversePlayerId, QuackverseBattlePileState>;
  score: Record<QuackversePlayerId, number>;
  koCount: Record<QuackversePlayerId, number>;
  formationVp: Record<QuackversePlayerId, number>;
  scoredFormationKeys: string[];
  matchResultRecordedForWinner: QuackversePlayerId | null;
  turnActions: Record<QuackversePlayerId, QuackverseTurnActions>;
  npcPlayers: Record<QuackversePlayerId, boolean>;
  winner: QuackversePlayerId | null;
  matchLog: string[];
  collections: Record<string, QuackverseCollectionState>;
  updatedAt: string;
};

export const QUACKVERSE_DAILY_PACK_LIMIT = 4;
export const QUACKVERSE_GRID_SIZE = 7;
export const QUACKVERSE_SQUAD_SIZE = 5;
export const QUACKVERSE_STAT_CAP = 20;

function clampStat(value: unknown, minimum = 0) { return Math.min(QUACKVERSE_STAT_CAP, Math.max(minimum, Number(value || 0))); }
function normalizePiece(piece: QuackverseSavedPiece | null): QuackverseSavedPiece | null {
  if (!piece) return null;
  const maxHp = clampStat(piece.maxHp, 1);
  return {
    ...piece,
    currentHp: Math.min(maxHp, clampStat(piece.currentHp, 0)),
    maxHp,
    specialCurrent: clampStat(piece.specialCurrent),
    fatigue: Math.max(0, Number(piece.fatigue ?? (piece.fatigued ? 1 : 0))),
    stunnedTurns: Math.max(0, Number(piece.stunnedTurns || 0)),
    statModifiers: {
      atk: Number(piece.statModifiers?.atk || 0),
      def: Number(piece.statModifiers?.def || 0),
      spd: Number(piece.statModifiers?.spd || 0),
      spc: Number(piece.statModifiers?.spc || 0),
    },
  };
}

export function defaultQuackverseState(now = new Date()): QuackverseSavedState {
  return {
    gridSize: QUACKVERSE_GRID_SIZE,
    squadSize: QUACKVERSE_SQUAD_SIZE,
    activePlayer: "playerOne",
    turnNumber: 1,
    squads: { playerOne: [], playerTwo: [] },
    claimedPlayers: { playerOne: "", playerTwo: "" },
    grid: Array.from({ length: QUACKVERSE_GRID_SIZE * QUACKVERSE_GRID_SIZE }, () => null),
    battlePiles: {
      playerOne: { drawPile: [], hand: [], discardPile: [] },
      playerTwo: { drawPile: [], hand: [], discardPile: [] },
    },
    score: { playerOne: 0, playerTwo: 0 },
    koCount: { playerOne: 0, playerTwo: 0 },
    formationVp: { playerOne: 0, playerTwo: 0 },
    scoredFormationKeys: [],
    matchResultRecordedForWinner: null,
    turnActions: {
      playerOne: { deployedOrMoved: false, attacked: [], usedAbility: [], equipped: [] },
      playerTwo: { deployedOrMoved: false, attacked: [], usedAbility: [], equipped: [] },
    },
    npcPlayers: { playerOne: false, playerTwo: false },
    winner: null,
    matchLog: ["No match loaded yet."],
    collections: {},
    updatedAt: now.toISOString(),
  };
}

export function defaultQuackverseCollection(): QuackverseCollectionState {
  return { cards: [], deck: [], activeDeckId: "default", savedDecks: [], deckWins: 0, deckLosses: 0, openedAtDay: "", openedToday: 0, lastPack: [] };
}

export function quackverseDayKey(date = new Date()) { return date.toISOString().slice(0, 10); }

export function normalizeQuackverseCollection(value: Partial<QuackverseCollectionState> | null | undefined, now = new Date()): QuackverseCollectionState {
  const fallback = defaultQuackverseCollection();
  const today = quackverseDayKey(now);
  const openedAtDay = typeof value?.openedAtDay === "string" ? value.openedAtDay : "";
  const savedDecks = Array.isArray(value?.savedDecks)
    ? value.savedDecks.map((deck) => ({
        id: typeof deck?.id === "string" && deck.id.trim() ? deck.id.trim() : "",
        name: typeof deck?.name === "string" && deck.name.trim() ? deck.name.trim().slice(0, 40) : "Saved Deck",
        cardIds: Array.isArray(deck?.cardIds) ? deck.cardIds.map(Number).filter(Number.isFinite).slice(0, 20) : [],
        wins: Number(deck?.wins || 0), losses: Number(deck?.losses || 0),
        createdAt: typeof deck?.createdAt === "string" ? deck.createdAt : "",
        updatedAt: typeof deck?.updatedAt === "string" ? deck.updatedAt : "",
      })).filter((deck) => deck.id)
    : [];
  return {
    cards: Array.isArray(value?.cards) ? value.cards.map(Number).filter(Number.isFinite) : fallback.cards,
    deck: Array.isArray(value?.deck) ? value.deck.map(Number).filter(Number.isFinite) : fallback.deck,
    activeDeckId: typeof value?.activeDeckId === "string" && value.activeDeckId.trim() ? value.activeDeckId.trim() : fallback.activeDeckId,
    savedDecks,
    deckWins: Number(value?.deckWins || 0),
    deckLosses: Number(value?.deckLosses || 0),
    openedAtDay,
    openedToday: openedAtDay === today ? Number(value?.openedToday || 0) : 0,
    lastPack: Array.isArray(value?.lastPack) ? value.lastPack.map(Number).filter(Number.isFinite) : fallback.lastPack,
  };
}

export function normalizeQuackverseState(value: Partial<QuackverseSavedState> | null | undefined, now = new Date()): QuackverseSavedState {
  const fallback = defaultQuackverseState(now);
  const grid = Array.isArray(value?.grid) && value.grid.length === QUACKVERSE_GRID_SIZE * QUACKVERSE_GRID_SIZE ? value.grid.map((piece) => normalizePiece(piece)) : fallback.grid;
  return {
    ...fallback,
    ...value,
    gridSize: QUACKVERSE_GRID_SIZE,
    squadSize: QUACKVERSE_SQUAD_SIZE,
    squads: { playerOne: Array.isArray(value?.squads?.playerOne) ? value.squads.playerOne : [], playerTwo: Array.isArray(value?.squads?.playerTwo) ? value.squads.playerTwo : [] },
    claimedPlayers: { playerOne: typeof value?.claimedPlayers?.playerOne === "string" ? value.claimedPlayers.playerOne : "", playerTwo: typeof value?.claimedPlayers?.playerTwo === "string" ? value.claimedPlayers.playerTwo : "" },
    grid,
    battlePiles: {
      playerOne: { drawPile: Array.isArray(value?.battlePiles?.playerOne?.drawPile) ? value.battlePiles.playerOne.drawPile : [], hand: Array.isArray(value?.battlePiles?.playerOne?.hand) ? value.battlePiles.playerOne.hand : [], discardPile: Array.isArray(value?.battlePiles?.playerOne?.discardPile) ? value.battlePiles.playerOne.discardPile : [] },
      playerTwo: { drawPile: Array.isArray(value?.battlePiles?.playerTwo?.drawPile) ? value.battlePiles.playerTwo.drawPile : [], hand: Array.isArray(value?.battlePiles?.playerTwo?.hand) ? value.battlePiles.playerTwo.hand : [], discardPile: Array.isArray(value?.battlePiles?.playerTwo?.discardPile) ? value.battlePiles.playerTwo.discardPile : [] },
    },
    score: { playerOne: Number(value?.score?.playerOne || 0), playerTwo: Number(value?.score?.playerTwo || 0) },
    koCount: { playerOne: Number(value?.koCount?.playerOne || 0), playerTwo: Number(value?.koCount?.playerTwo || 0) },
    formationVp: { playerOne: Number(value?.formationVp?.playerOne || 0), playerTwo: Number(value?.formationVp?.playerTwo || 0) },
    scoredFormationKeys: Array.isArray(value?.scoredFormationKeys) ? value.scoredFormationKeys : [],
    matchResultRecordedForWinner: value?.matchResultRecordedForWinner === "playerOne" || value?.matchResultRecordedForWinner === "playerTwo" ? value.matchResultRecordedForWinner : null,
    turnActions: {
      playerOne: { deployedOrMoved: Boolean(value?.turnActions?.playerOne?.deployedOrMoved), attacked: Array.isArray(value?.turnActions?.playerOne?.attacked) ? value.turnActions.playerOne.attacked : [], usedAbility: Array.isArray(value?.turnActions?.playerOne?.usedAbility) ? value.turnActions.playerOne.usedAbility : [], equipped: Array.isArray(value?.turnActions?.playerOne?.equipped) ? value.turnActions.playerOne.equipped : [] },
      playerTwo: { deployedOrMoved: Boolean(value?.turnActions?.playerTwo?.deployedOrMoved), attacked: Array.isArray(value?.turnActions?.playerTwo?.attacked) ? value.turnActions.playerTwo.attacked : [], usedAbility: Array.isArray(value?.turnActions?.playerTwo?.usedAbility) ? value.turnActions.playerTwo.usedAbility : [], equipped: Array.isArray(value?.turnActions?.playerTwo?.equipped) ? value.turnActions.playerTwo.equipped : [] },
    },
    npcPlayers: { playerOne: Boolean(value?.npcPlayers?.playerOne), playerTwo: Boolean(value?.npcPlayers?.playerTwo) },
    collections: Object.fromEntries(Object.entries(value?.collections || {}).map(([userId, collection]) => [userId, normalizeQuackverseCollection(collection as Partial<QuackverseCollectionState>, now)])),
    activePlayer: value?.activePlayer === "playerTwo" ? "playerTwo" : "playerOne",
    winner: value?.winner === "playerOne" || value?.winner === "playerTwo" ? value.winner : null,
    turnNumber: Number(value?.turnNumber || 1),
    matchLog: Array.isArray(value?.matchLog) ? value.matchLog.slice(0, 20) : fallback.matchLog,
    updatedAt: value?.updatedAt || fallback.updatedAt,
  };
}

export function claimQuackverseSeat(stateInput: Partial<QuackverseSavedState>, userId: string): { state: QuackverseSavedState; seat: QuackversePlayerId | null } {
  const user = String(userId || "").trim();
  if (!user) throw new Error("Quackverse user id is required");
  const state = normalizeQuackverseState(stateInput);
  if (state.claimedPlayers.playerOne === user) return { state, seat: "playerOne" };
  if (state.claimedPlayers.playerTwo === user) return { state, seat: "playerTwo" };
  if (!state.claimedPlayers.playerOne) { state.claimedPlayers.playerOne = user; state.updatedAt = new Date().toISOString(); return { state, seat: "playerOne" }; }
  if (!state.claimedPlayers.playerTwo) { state.claimedPlayers.playerTwo = user; state.updatedAt = new Date().toISOString(); return { state, seat: "playerTwo" }; }
  return { state, seat: null };
}

export function canOpenQuackversePack(collectionInput: Partial<QuackverseCollectionState>, now = new Date()) {
  const collection = normalizeQuackverseCollection(collectionInput, now);
  return { allowed: collection.openedToday < QUACKVERSE_DAILY_PACK_LIMIT, remaining: Math.max(0, QUACKVERSE_DAILY_PACK_LIMIT - collection.openedToday), collection };
}

export function recordQuackversePack(collectionInput: Partial<QuackverseCollectionState>, cardIds: readonly number[], now = new Date()): QuackverseCollectionState {
  const check = canOpenQuackversePack(collectionInput, now);
  if (!check.allowed) throw new Error("Quackverse daily pack limit reached");
  const ids = cardIds.map(Number).filter(Number.isFinite);
  return { ...check.collection, cards: [...check.collection.cards, ...ids], openedAtDay: quackverseDayKey(now), openedToday: check.collection.openedToday + 1, lastPack: ids };
}
