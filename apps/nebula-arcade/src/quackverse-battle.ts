import {
  normalizeQuackverseState,
  type QuackversePlayerId,
  type QuackverseSavedPiece,
  type QuackverseSavedState,
} from "./quackverse-state.js";

export interface QuackverseBattleCardV1 {
  id: number;
  name: string;
  atk: number;
  def: number;
  spd?: number;
  spc?: number;
  hp: number;
  role?: string;
}

export interface QuackverseBattleCatalogV1 {
  get(cardId: number): QuackverseBattleCardV1 | undefined;
}

export type QuackverseBattleActionV1 =
  | { kind: "deploy"; playerId: QuackversePlayerId; cardId: number; to: number; instanceId?: string }
  | { kind: "move"; playerId: QuackversePlayerId; from: number; to: number }
  | { kind: "attack"; playerId: QuackversePlayerId; from: number; to: number }
  | { kind: "end-turn"; playerId: QuackversePlayerId };

export interface QuackverseBattleResultV1 {
  state: QuackverseSavedState;
  events: Array<{ type: string; message: string; payload?: Record<string, unknown> }>;
}

export const QUACKVERSE_VICTORY_TARGET = 6;
export const QUACKVERSE_FORMATION_VP_LIMIT = 3;

export function applyQuackverseBattleAction(
  input: Partial<QuackverseSavedState>,
  action: QuackverseBattleActionV1,
  catalog: QuackverseBattleCatalogV1,
  now = new Date(),
): QuackverseBattleResultV1 {
  const state = normalizeQuackverseState(input, now);
  if (state.winner) throw new Error("Quackverse match is already complete");
  if (state.activePlayer !== action.playerId) throw new Error("It is not that player's turn");
  const events: QuackverseBattleResultV1["events"] = [];

  if (action.kind === "deploy") deploy(state, action.playerId, action.cardId, action.to, catalog, action.instanceId, events);
  else if (action.kind === "move") move(state, action.playerId, action.from, action.to, events);
  else if (action.kind === "attack") attack(state, action.playerId, action.from, action.to, catalog, events);
  else endTurn(state, action.playerId, catalog, events);

  scoreFormation(state, action.playerId, events);
  settleWinner(state, events);
  state.updatedAt = now.toISOString();
  state.matchLog = [...events.map((event) => event.message), ...state.matchLog].slice(0, 20);
  return { state, events };
}

function deploy(state: QuackverseSavedState, playerId: QuackversePlayerId, cardId: number, to: number, catalog: QuackverseBattleCatalogV1, requestedInstanceId: string | undefined, events: QuackverseBattleResultV1["events"]) {
  assertCell(state, to);
  if (state.grid[to]) throw new Error("Deployment cell is occupied");
  if (state.turnActions[playerId].deployedOrMoved) throw new Error("This turn already used its deploy or move action");
  if (rowOf(to, state.gridSize) !== backRow(playerId, state.gridSize)) throw new Error("New pieces must deploy on the player's back row");
  if (state.grid.filter((piece) => piece?.owner === playerId).length >= state.squadSize) throw new Error("Squad is already at its deployment limit");

  const card = requireCard(catalog, cardId);
  const hand = state.battlePiles[playerId].hand;
  const handIndex = hand.findIndex((entry) => entry.cardId === cardId && (!requestedInstanceId || entry.instanceId === requestedInstanceId));
  const squadOwnsCard = state.squads[playerId].includes(cardId);
  if (hand.length > 0 && handIndex < 0) throw new Error("That card is not in the player's hand");
  if (hand.length === 0 && !squadOwnsCard) throw new Error("That card is not in the player's squad");
  const instance = handIndex >= 0 ? hand.splice(handIndex, 1)[0] : undefined;
  state.grid[to] = makePiece(playerId, card, instance?.instanceId ?? requestedInstanceId);
  state.turnActions[playerId].deployedOrMoved = true;
  events.push({ type: "deploy", message: `${label(playerId)} deployed ${card.name}.`, payload: { playerId, cardId, to } });
}

function move(state: QuackverseSavedState, playerId: QuackversePlayerId, from: number, to: number, events: QuackverseBattleResultV1["events"]) {
  assertCell(state, from); assertCell(state, to);
  if (state.turnActions[playerId].deployedOrMoved) throw new Error("This turn already used its deploy or move action");
  const piece = state.grid[from];
  if (!piece || piece.owner !== playerId) throw new Error("Move source is not owned by the active player");
  if (state.grid[to]) throw new Error("Move destination is occupied");
  if (!isAdjacent(from, to, state.gridSize)) throw new Error("Pieces move one orthogonal cell per action");
  state.grid[to] = piece;
  state.grid[from] = null;
  state.turnActions[playerId].deployedOrMoved = true;
  events.push({ type: "move", message: `${label(playerId)} moved a piece.`, payload: { playerId, from, to, instanceId: piece.instanceId } });
}

function attack(state: QuackverseSavedState, playerId: QuackversePlayerId, from: number, to: number, catalog: QuackverseBattleCatalogV1, events: QuackverseBattleResultV1["events"]) {
  assertCell(state, from); assertCell(state, to);
  const attacker = state.grid[from];
  const defender = state.grid[to];
  if (!attacker || attacker.owner !== playerId) throw new Error("Attacking piece is not owned by the active player");
  if (!defender || defender.owner === playerId) throw new Error("Attack target must be an opposing piece");
  if (!isAdjacent(from, to, state.gridSize)) throw new Error("Base attacks require an adjacent target");
  const attackKey = pieceKey(attacker, from);
  if (state.turnActions[playerId].attacked.includes(attackKey)) throw new Error("That piece already attacked this turn");
  if (Number(attacker.stunnedTurns || 0) > 0) throw new Error("Stunned pieces cannot attack");

  const attackerCard = requireCard(catalog, attacker.cardId);
  const defenderCard = requireCard(catalog, defender.cardId);
  const attackPower = attackerCard.atk + Number(attacker.statModifiers?.atk || 0);
  const defensePower = defenderCard.def + Number(defender.statModifiers?.def || 0);
  const damage = Math.max(1, attackPower - Math.floor(defensePower / 2));
  defender.currentHp = Math.max(0, defender.currentHp - damage);
  attacker.specialCurrent = Math.min(20, Number(attacker.specialCurrent || 0) + Math.max(1, Math.ceil(damage / 2)));
  state.turnActions[playerId].attacked.push(attackKey);
  events.push({ type: "attack", message: `${attackerCard.name} hit ${defenderCard.name} for ${damage}.`, payload: { playerId, from, to, damage } });

  if (defender.currentHp <= 0) {
    state.grid[to] = null;
    state.koCount[playerId] += 1;
    state.score[playerId] += 1;
    state.battlePiles[defender.owner].discardPile.push({ instanceId: defender.instanceId ?? `${defender.owner}-${defender.cardId}-${to}`, cardId: defender.cardId });
    events.push({ type: "ko", message: `${label(playerId)} knocked out ${defenderCard.name}.`, payload: { playerId, cardId: defender.cardId, score: state.score[playerId] } });
  }
}

function endTurn(state: QuackverseSavedState, playerId: QuackversePlayerId, catalog: QuackverseBattleCatalogV1, events: QuackverseBattleResultV1["events"]) {
  const next = opponentOf(playerId);
  state.activePlayer = next;
  state.turnNumber += 1;
  state.turnActions[playerId] = { deployedOrMoved: false, attacked: [], usedAbility: [], equipped: [] };
  for (const piece of state.grid) {
    if (!piece || piece.owner !== next) continue;
    if (Number(piece.stunnedTurns || 0) > 0) piece.stunnedTurns = Math.max(0, Number(piece.stunnedTurns || 0) - 1);
    const card = catalog.get(piece.cardId);
    if (card && /medic|support|heal/i.test(`${card.role ?? ""} ${card.name}`)) piece.currentHp = Math.min(piece.maxHp, piece.currentHp + 1);
  }
  const pile = state.battlePiles[next];
  if (pile.drawPile.length && pile.hand.length < 7) pile.hand.push(pile.drawPile.shift()!);
  events.push({ type: "turn", message: `${label(next)} begins turn ${state.turnNumber}.`, payload: { playerId: next, turnNumber: state.turnNumber } });
}

function scoreFormation(state: QuackverseSavedState, playerId: QuackversePlayerId, events: QuackverseBattleResultV1["events"]) {
  if (state.formationVp[playerId] >= QUACKVERSE_FORMATION_VP_LIMIT) return;
  const lines = detectBattleLines(state, playerId);
  const fresh = lines.find((line) => !state.scoredFormationKeys.includes(line.key));
  if (!fresh) return;
  state.scoredFormationKeys.push(fresh.key);
  state.formationVp[playerId] += 1;
  state.score[playerId] += 1;
  events.push({ type: "formation", message: `${label(playerId)} formed a Battle Line for 1 VP.`, payload: { playerId, cells: fresh.cells, score: state.score[playerId] } });
}

function detectBattleLines(state: QuackverseSavedState, playerId: QuackversePlayerId) {
  const result: Array<{ key: string; cells: number[] }> = [];
  const owned = (cell: number) => state.grid[cell]?.owner === playerId;
  for (let row = 0; row < state.gridSize; row++) {
    const run: number[] = [];
    const flush = () => { if (run.length >= 3 && row !== backRow(playerId, state.gridSize)) result.push({ key: `${playerId}:row:${run.join("-")}`, cells: [...run] }); run.length = 0; };
    for (let col = 0; col < state.gridSize; col++) { const cell = row * state.gridSize + col; if (owned(cell)) run.push(cell); else flush(); }
    flush();
  }
  for (let col = 0; col < state.gridSize; col++) {
    const run: number[] = [];
    const flush = () => { if (run.length >= 3) result.push({ key: `${playerId}:col:${run.join("-")}`, cells: [...run] }); run.length = 0; };
    for (let row = 0; row < state.gridSize; row++) { const cell = row * state.gridSize + col; if (owned(cell)) run.push(cell); else flush(); }
    flush();
  }
  return result;
}

function settleWinner(state: QuackverseSavedState, events: QuackverseBattleResultV1["events"]) {
  const winner = (["playerOne", "playerTwo"] as const).find((playerId) => state.score[playerId] >= QUACKVERSE_VICTORY_TARGET) ?? null;
  if (!winner || state.winner) return;
  state.winner = winner;
  events.push({ type: "winner", message: `${label(winner)} wins the Quackverse match.`, payload: { playerId: winner, score: state.score[winner] } });
}

function makePiece(owner: QuackversePlayerId, card: QuackverseBattleCardV1, instanceId?: string): QuackverseSavedPiece {
  return { instanceId: instanceId ?? `${owner}-${card.id}-${Math.random().toString(36).slice(2, 10)}`, owner, cardId: card.id, currentHp: card.hp, maxHp: card.hp, specialCurrent: 0, equipmentIds: [], fatigue: 0, stunnedTurns: 0, statModifiers: { atk: 0, def: 0, spd: 0, spc: 0 } };
}
function requireCard(catalog: QuackverseBattleCatalogV1, cardId: number) { const card = catalog.get(cardId); if (!card) throw new Error(`Unknown Quackverse card ${cardId}`); return card; }
function assertCell(state: QuackverseSavedState, cell: number) { if (!Number.isSafeInteger(cell) || cell < 0 || cell >= state.grid.length) throw new Error("Quackverse board cell is invalid"); }
function rowOf(cell: number, size: number) { return Math.floor(cell / size); }
function colOf(cell: number, size: number) { return cell % size; }
function isAdjacent(from: number, to: number, size: number) { return Math.abs(rowOf(from, size) - rowOf(to, size)) + Math.abs(colOf(from, size) - colOf(to, size)) === 1; }
function backRow(playerId: QuackversePlayerId, size: number) { return playerId === "playerOne" ? size - 1 : 0; }
function opponentOf(playerId: QuackversePlayerId): QuackversePlayerId { return playerId === "playerOne" ? "playerTwo" : "playerOne"; }
function pieceKey(piece: QuackverseSavedPiece, cell: number) { return piece.instanceId || `${piece.owner}-${piece.cardId}-${cell}`; }
function label(playerId: QuackversePlayerId) { return playerId === "playerOne" ? "Player One" : "Player Two"; }
