import type { QuackverseCollectionState, QuackverseTradeOffer } from "./quackverse-state.js";

export function spareQuackverseCopies(collection: QuackverseCollectionState, cardId: number) {
  const count = (ids: number[]) => ids.filter((id) => id === cardId).length;
  const reserved = Math.max(count(collection.deck), ...collection.savedDecks.map((deck) => count(deck.cardIds)), 0);
  return Math.max(0, count(collection.cards) - reserved);
}

export function offerQuackverseTrade(
  collections: Record<string, QuackverseCollectionState>,
  offer: QuackverseTradeOffer,
  now = Date.now(),
) {
  if (!offer.id || !offer.fromId || !offer.toId || !Number.isSafeInteger(offer.giveCardId) || !Number.isSafeInteger(offer.wantCardId)) {
    throw new Error("Trade offer details are invalid.");
  }
  if (offer.fromId === offer.toId) throw new Error("Choose another player.");
  const from = collections[offer.fromId], to = collections[offer.toId];
  if (!from || !to) throw new Error("Both players need a Quackverse collection.");
  if (spareQuackverseCopies(from, offer.giveCardId) < 1 || spareQuackverseCopies(to, offer.wantCardId) < 1) {
    throw new Error("Choose owned cards with a spare copy outside active and saved decks.");
  }
  const offers = from.tradeOffers || [];
  if (offers.some((item) => item.id === offer.id)) throw new Error("Trade offer ID already exists.");
  if (offers.filter((item) => item.status === "pending" && Date.parse(item.expiresAt) > now).length >= 20) {
    throw new Error("You already have 20 open offers. Cancel one first.");
  }
  from.tradeOffers = [
    ...offers.filter((item) => item.status === "pending" && Date.parse(item.expiresAt) > now),
    ...offers.filter((item) => item.status !== "pending").slice(-100),
    { ...offer, status: "pending" },
  ];
  return from.tradeOffers[from.tradeOffers.length - 1]!;
}

export function resolveQuackverseTrade(
  collections: Record<string, QuackverseCollectionState>,
  id: string,
  actorId: string,
  action: "accept" | "decline" | "cancel",
  now = Date.now(),
) {
  const offer = Object.values(collections).flatMap((collection) => collection.tradeOffers || []).find((item) => item.id === id);
  if (!offer) throw new Error("Trade offer not found.");
  if (offer.status !== "pending") throw new Error("This offer has already been resolved.");
  // Authorize before exposing expiry/state details to an unrelated player.
  if (action === "cancel" ? actorId !== offer.fromId : actorId !== offer.toId) {
    throw new Error("This trade action belongs to the other player.");
  }
  if (Date.parse(offer.expiresAt) <= now) throw new Error("This offer expired. Create a new offer.");
  if (action === "accept") {
    const from = collections[offer.fromId], to = collections[offer.toId];
    if (!from || !to || spareQuackverseCopies(from, offer.giveCardId) < 1 || spareQuackverseCopies(to, offer.wantCardId) < 1) {
      throw new Error("A card is no longer available outside the players' decks. Cancel this offer and choose another card.");
    }
    from.cards.splice(from.cards.indexOf(offer.giveCardId), 1);
    to.cards.splice(to.cards.indexOf(offer.wantCardId), 1);
    from.cards.push(offer.wantCardId);
    to.cards.push(offer.giveCardId);
  }
  offer.status = action === "accept" ? "accepted" : action === "decline" ? "declined" : "cancelled";
  offer.resolvedAt = new Date(now).toISOString();
  return offer;
}
