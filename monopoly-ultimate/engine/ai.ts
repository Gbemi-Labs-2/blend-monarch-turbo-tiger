import { GROUP_META, RAILS, UTILITIES, isDeed, groupIndices, spaceAt, type Street } from "./board.ts";
import {
  actorId,
  canBuild,
  canMortgage,
  canSell,
  canUnmortgage,
  computeRent,
  debtTotal,
  dispatch,
  minNextBid,
  netWorth,
  ownedIndices,
  unmortgageCost,
} from "./logic.ts";
import type { Action, Difficulty, GameState, Personality, Player } from "./types.ts";

export type AiChoice = { action: Action; reason: string };

const RESERVE: Record<Difficulty, number> = { easy: 230, normal: 160, hard: 120, expert: 80 };

export function chooseAiAction(state: GameState): AiChoice {
  const id = actorId(state);
  if (!id) throw new Error("AI was asked to move with no actor");
  const player = state.players.find((p) => p.id === id);
  if (!player) throw new Error("Missing AI player");
  const ranked = rankChoices(state, player);
  for (const choice of ranked) {
    const result = dispatch(state, choice.action);
    if (result.ok) return choice;
  }
  const fallback = fallbackChoice(state);
  const result = dispatch(state, fallback.action);
  if (!result.ok) throw new Error(`AI stuck in ${state.phase}: ${result.error}`);
  return fallback;
}

export function playUntilDone(state: GameState, maxSteps = 8000): { state: GameState; steps: number } {
  let current = state;
  let steps = 0;
  while (!current.gameOver && steps < maxSteps) {
    const choice = chooseAiAction(current);
    const result = dispatch(current, choice.action);
    if (!result.ok) throw new Error(`AI illegal during ${current.phase} (${choice.action.type}): ${result.error}`);
    current = result.state;
    steps += 1;
  }
  return { state: current, steps };
}

function rankChoices(state: GameState, player: Player): AiChoice[] {
  if (state.phase === "card") return [{ action: { type: "ACK" }, reason: "Resolve the drawn notice." }];
  if (state.phase === "auction") return [auctionChoice(state, player)];
  if (state.phase === "purchase") return [purchaseChoice(state, player)];
  if (state.phase === "trade") return [tradeChoice(state, player)];
  if (state.phase === "debt") return debtChoices(state, player);
  if (state.phase === "jail") return jailChoices(state, player);
  return prepChoices(state, player);
}

function purchaseChoice(state: GameState, player: Player): AiChoice {
  const index = state.purchaseIndex;
  const space = index == null ? null : spaceAt(index);
  if (index == null || !space || !isDeed(space)) {
    return { action: { type: "DECLINE" }, reason: "Nothing here can be purchased." };
  }
  if (player.cash < space.price) {
    return { action: { type: "DECLINE" }, reason: `${space.name} costs more than the cash on hand.` };
  }
  const decision = wantsPurchase(state, player, index, space.price);
  return decision.buy
    ? { action: { type: "BUY" }, reason: decision.reason }
    : { action: { type: "DECLINE" }, reason: decision.reason };
}

export function wantsPurchase(
  state: GameState,
  player: Player,
  index: number,
  price: number,
): { buy: boolean; reason: string } {
  const space = spaceAt(index);
  const value = strategicValue(state, player, index);
  const cashAfter = player.cash - price;
  const completes = space.kind === "street" && wouldComplete(state, player.id, index);
  const groupName = space.kind === "street" ? GROUP_META[space.group].label : space.name;
  if (completes && cashAfter >= 40) {
    const bankerPanic = player.difficulty === "easy" && player.personality === "banker" && cashAfter < 180;
    if (!bankerPanic) return { buy: true, reason: `Completes the ${groupName} ward.` };
  }
  if (player.difficulty === "easy") {
    const wobble = hash(state, `${player.id}:buy`, index) % 5 === 0 && player.personality !== "collector";
    if (price <= 120 && cashAfter >= 200 && !wobble) {
      return { buy: true, reason: "The price is modest and a cash reserve remains." };
    }
    return { buy: false, reason: "Keeps a simple cash reserve instead of buying." };
  }
  const reserve = liquidityTarget(state, player);
  if (!completes && cashAfter < reserve) {
    return { buy: false, reason: "Preserves liquidity for rent and fines." };
  }
  const threat = expectedRentHit(state, player.id);
  if (player.difficulty === "expert" && !completes && cashAfter < threat * 2) {
    return { buy: false, reason: "Holds cash against the rent likely on the next roll." };
  }
  const threshold = player.difficulty === "normal" ? 0.95 : player.difficulty === "hard" ? 0.84 : 0.74;
  if (value >= price * threshold) return { buy: true, reason: `Values ${space.kind === "street" ? space.name : space.name} above the asking price.` };
  return { buy: false, reason: "The asking price is ahead of the deed's value." };
}

function auctionChoice(state: GameState, player: Player): AiChoice {
  const auction = state.auction;
  if (!auction) return { action: { type: "PASS" }, reason: "The auction has already closed." };
  const space = spaceAt(auction.propertyIndex);
  const price = isDeed(space) ? space.price : 0;
  const min = minNextBid(state, auction);
  const ceiling = auctionCeiling(state, player, auction.propertyIndex, price);
  if (min > player.cash) return { action: { type: "PASS" }, reason: "Cannot afford the next bid." };
  if (min > ceiling) return { action: { type: "PASS" }, reason: "The bid has passed what the deed is worth." };
  return { action: { type: "BID", amount: min }, reason: `Bids ${min}, under a ceiling of ${Math.floor(ceiling)}.` };
}

function tradeChoice(state: GameState, player: Player): AiChoice {
  const trade = state.trade;
  if (!trade) return { action: { type: "REJECT" }, reason: "No trade is on the table." };
  if (trade.toId !== player.id) return { action: { type: "REJECT" }, reason: "Waiting on the other owner." };
  const received = valueBundle(state, player, trade.offerProperties, trade.offerCash);
  const given = valueBundle(state, player, trade.requestProperties, trade.requestCash);
  const handsMonopoly = trade.requestProperties.some((index) => wouldComplete(state, trade.fromId, index));
  const gainsMonopoly = trade.offerProperties.some((index) => wouldComplete(state, player.id, index));
  const margin =
    player.difficulty === "easy" ? -40 : player.difficulty === "normal" ? 0 : player.difficulty === "hard" ? 30 : 10;
  if (handsMonopoly && !gainsMonopoly && player.difficulty !== "easy") {
    return { action: { type: "REJECT" }, reason: "Refuses to hand over a ward." };
  }
  const cashAfter = player.cash + trade.offerCash - trade.requestCash;
  if (cashAfter < 0) return { action: { type: "REJECT" }, reason: "The offer would overdraw cash." };
  if (player.difficulty !== "easy" && cashAfter < liquidityTarget(state, player) * 0.4 && trade.requestCash > trade.offerCash) {
    return { action: { type: "REJECT" }, reason: "The cash leaving the reserve is too steep." };
  }
  if (received - given >= margin || (gainsMonopoly && cashAfter >= 40)) {
    return {
      action: { type: "ACCEPT" },
      reason: gainsMonopoly ? "Accepts a trade that completes a ward." : "The assets coming in outweigh the assets leaving.",
    };
  }
  return { action: { type: "REJECT" }, reason: "The trade does not improve this position." };
}

function debtChoices(state: GameState, player: Player): AiChoice[] {
  const debt = state.debt;
  const choices: AiChoice[] = [];
  if (debt && player.cash >= debtTotal(debt)) {
    choices.push({ action: { type: "PAY_DEBT" }, reason: "Cash covers the debt." });
  }
  const sell = bestBuildingToSell(state, player.id);
  if (sell != null) choices.push({ action: { type: "SELL", index: sell }, reason: "Sells a building to raise cash." });
  const deed = bestDeedToMortgage(state, player.id);
  if (deed != null) choices.push({ action: { type: "MORTGAGE", index: deed }, reason: "Mortgages a quiet deed to raise cash." });
  choices.push({ action: { type: "BANKRUPT" }, reason: "No honest way left to cover the debt." });
  return choices;
}

function jailChoices(state: GameState, player: Player): AiChoice[] {
  const choices: AiChoice[] = [];
  const fine = state.rules.jailFine;
  const pressure = opponentsHaveWard(state, player.id);
  const useCard =
    player.jailCards.length > 0 &&
    (player.difficulty !== "easy" || player.cash < fine || pressure);
  if (useCard && !(player.difficulty === "easy" && player.cash > 400 && !pressure)) {
    choices.push({ action: { type: "USE_CARD" }, reason: "Spends a key rather than miss more turns." });
  }
  const pay =
    player.cash >= fine &&
    (player.difficulty === "expert" || player.difficulty === "hard"
      ? pressure || player.jailTurns >= 1 || player.cash > fine + liquidityTarget(state, player)
      : player.difficulty === "normal"
        ? player.cash > 500 || player.jailTurns >= 2
        : false);
  if (pay) choices.push({ action: { type: "PAY_FINE" }, reason: "Pays the fine to get back on the tide." });
  if (!pay && player.cash < fine) {
    const deed = bestDeedToMortgage(state, player.id);
    if (deed != null && player.difficulty !== "easy") {
      choices.push({ action: { type: "MORTGAGE", index: deed }, reason: "Raises the Lockup fine by mortgaging." });
    }
  }
  choices.push({ action: { type: "ROLL_JAIL" }, reason: "Tries for doubles." });
  return choices;
}

function prepChoices(state: GameState, player: Player): AiChoice[] {
  const choices: AiChoice[] = [];
  const lift = bestUnmortgage(state, player);
  if (lift != null) choices.push({ action: { type: "UNMORTGAGE", index: lift }, reason: "Lifts a mortgage on a ward that can earn." });
  const build = bestBuild(state, player);
  if (build != null) {
    const space = spaceAt(build);
    choices.push({
      action: { type: "BUILD", index: build },
      reason: `Develops ${space.name} while cash still covers the reserve.`,
    });
  }
  const trade = proposeTrade(state, player);
  if (trade) choices.push(trade);
  if (state.phase === "pre_roll" || state.mustRoll) {
    choices.push({ action: { type: "ROLL" }, reason: "Rolls the tide." });
  }
  choices.push({ action: { type: "END_TURN" }, reason: "Nothing better remains this turn." });
  return choices;
}

function fallbackChoice(state: GameState): AiChoice {
  if (state.phase === "auction") return { action: { type: "PASS" }, reason: "Passes." };
  if (state.phase === "purchase") return { action: { type: "DECLINE" }, reason: "Declines." };
  if (state.phase === "card") return { action: { type: "ACK" }, reason: "Continues." };
  if (state.phase === "trade") return { action: { type: "REJECT" }, reason: "Refuses." };
  if (state.phase === "debt") return { action: { type: "BANKRUPT" }, reason: "Concedes the debt." };
  if (state.phase === "jail") return { action: { type: "ROLL_JAIL" }, reason: "Rolls in the Lockup." };
  if (state.phase === "pre_roll") return { action: { type: "ROLL" }, reason: "Rolls." };
  return { action: { type: "END_TURN" }, reason: "Ends the turn." };
}

export function strategicValue(state: GameState, player: Player, index: number): number {
  const space = spaceAt(index);
  if (!isDeed(space)) return 0;
  let value = space.price * 0.62;
  if (space.kind === "street") {
    const group = groupIndices(space.group);
    const mine = group.filter((i) => state.deeds[i]?.ownerId === player.id).length;
    const byOpp = new Map<string, number>();
    for (const i of group) {
      const owner = state.deeds[i]?.ownerId;
      if (owner && owner !== player.id) byOpp.set(owner, (byOpp.get(owner) ?? 0) + 1);
    }
    if (mine + 1 === group.length) value += space.price * (player.personality === "collector" ? 1.55 : 1.15);
    else if (mine > 0) value += space.price * 0.36;
    if ([...byOpp.values()].some((count) => count >= group.length - 1)) {
      value += space.price * (player.personality === "aggressive" ? 0.85 : 0.55);
    }
    value += space.rent[5] * (player.difficulty === "easy" ? 0.03 : 0.09);
  } else if (space.kind === "rail") {
    const owned = RAILS.filter((i) => state.deeds[i]?.ownerId === player.id).length;
    value += 36 + owned * (player.difficulty === "easy" ? 24 : 58);
  } else {
    const owned = UTILITIES.filter((i) => state.deeds[i]?.ownerId === player.id).length;
    value += 30 + owned * 36;
  }
  if (player.personality === "aggressive") value *= 1.12;
  if (player.personality === "banker") value *= 0.86;
  if (player.personality === "risk") value *= 1.1;
  if (player.personality === "collector" && space.kind === "street") value *= 1.05;
  if (player.difficulty === "hard" || player.difficulty === "expert") value += denialValue(state, player.id, index);
  return value;
}

function denialValue(state: GameState, playerId: string, index: number): number {
  const space = spaceAt(index);
  if (space.kind !== "street") return 0;
  let best = 0;
  for (const other of state.players) {
    if (other.id === playerId || other.bankrupt) continue;
    if (wouldComplete(state, other.id, index)) best = Math.max(best, space.price * 0.45);
  }
  return best;
}

function auctionCeiling(state: GameState, player: Player, index: number, price: number): number {
  const value = strategicValue(state, player, index);
  const factor = player.difficulty === "easy" ? 0 : player.difficulty === "normal" ? 0.82 : player.difficulty === "hard" ? 0.96 : 1.06;
  let ceiling = player.difficulty === "easy" ? price * 0.45 : value * factor;
  if (player.personality === "banker") ceiling *= 0.84;
  if (player.personality === "aggressive") ceiling *= 1.14;
  if (player.personality === "risk") ceiling *= 1.12;
  if (player.personality === "collector" && wouldComplete(state, player.id, index)) ceiling *= 1.2;
  const reserve = liquidityTarget(state, player) * (player.difficulty === "expert" ? 0.55 : 0.35);
  return Math.min(ceiling, player.cash - reserve);
}

function liquidityTarget(state: GameState, player: Player): number {
  let reserve = RESERVE[player.difficulty];
  if (player.personality === "banker") reserve += 90;
  if (player.personality === "aggressive") reserve -= 50;
  if (player.personality === "risk") reserve -= 35;
  if (player.personality === "collector") reserve -= 20;
  if (player.difficulty === "hard") reserve += expectedRentHit(state, player.id);
  if (player.difficulty === "expert") reserve += expectedRentHit(state, player.id) * 2;
  return Math.max(40, reserve);
}

export function expectedRentHit(state: GameState, playerId: string): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.inJail) return 0;
  const probs = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1].map((n) => n / 36);
  let expected = 0;
  for (let roll = 2; roll <= 12; roll++) {
    const index = (player.position + roll) % 40;
    const space = spaceAt(index);
    if (!isDeed(space)) continue;
    const deed = state.deeds[index];
    if (!deed?.ownerId || deed.ownerId === playerId || deed.mortgaged) continue;
    expected += (probs[roll] ?? 0) * computeRent(state, index, roll, 1);
  }
  return expected;
}

function bestBuild(state: GameState, player: Player): number | null {
  let best: { index: number; gain: number } | null = null;
  for (const index of ownedIndices(state, player.id)) {
    if (canBuild(state, player.id, index)) continue;
    const space = spaceAt(index) as Street;
    const gain = rentDelta(state, index);
    const reserve = liquidityTarget(state, player);
    if (player.difficulty === "easy") {
      if (player.cash - space.house < 500) continue;
      if (hash(state, "build", index) % 3 !== 0) continue;
    } else if (player.cash - space.house < reserve) continue;
    const payoff = player.difficulty === "expert" ? 1.15 : player.difficulty === "hard" ? 1 : 0.4;
    if (player.difficulty !== "easy" && gain < space.house * payoff && !wouldBeHotel(state, index)) continue;
    if (!best || gain > best.gain) best = { index, gain };
  }
  return best?.index ?? null;
}

function bestUnmortgage(state: GameState, player: Player): number | null {
  if (player.difficulty === "easy") return null;
  let best: number | null = null;
  for (const index of ownedIndices(state, player.id)) {
    if (canUnmortgage(state, player.id, index)) continue;
    const space = spaceAt(index);
    if (space.kind === "street" && !groupIndices(space.group).every((i) => state.deeds[i]?.ownerId === player.id)) continue;
    const cost = unmortgageCost(state, space);
    if (player.cash - cost < liquidityTarget(state, player) + 80) continue;
    best = index;
  }
  return best;
}

function bestBuildingToSell(state: GameState, playerId: string): number | null {
  let best: { index: number; cost: number } | null = null;
  for (const index of ownedIndices(state, playerId)) {
    if (canSell(state, playerId, index)) continue;
    const space = spaceAt(index);
    if (space.kind !== "street") continue;
    if (!best || space.house > best.cost) best = { index, cost: space.house };
  }
  return best?.index ?? null;
}

function bestDeedToMortgage(state: GameState, playerId: string): number | null {
  let best: { index: number; score: number } | null = null;
  for (const index of ownedIndices(state, playerId)) {
    if (canMortgage(state, playerId, index)) continue;
    const space = spaceAt(index);
    if (!isDeed(space)) continue;
    const inSet = space.kind === "street" && groupIndices(space.group).every((i) => state.deeds[i]?.ownerId === playerId);
    const score = (inSet ? 1000 : 0) + space.price;
    if (!best || score < best.score) best = { index, score };
  }
  return best?.index ?? null;
}

function proposeTrade(state: GameState, player: Player): AiChoice | null {
  if (!state.rules.trading) return null;
  if (state.offersThisTurn > 0) return null;
  if (player.difficulty === "easy" && player.personality !== "trader") return null;
  if (player.personality === "banker" && player.difficulty !== "expert") return null;
  if (state.phase !== "pre_roll" && state.phase !== "manage") return null;
  for (const space of state.players.length ? ownedMissing(state, player) : []) {
    const ownerId = state.deeds[space.index]?.ownerId;
    if (!ownerId || ownerId === player.id) continue;
    const owner = state.players.find((p) => p.id === ownerId);
    if (!owner || owner.bankrupt) continue;
    const budget = Math.max(0, player.cash - liquidityTarget(state, player));
    const offerCash = Math.min(budget, Math.round(space.price * (player.personality === "trader" ? 0.95 : 0.7)));
    if (offerCash < space.price * 0.45) continue;
    const give = sacrificialDeed(state, player.id, space.group);
    return {
      action: {
        type: "PROPOSE",
        toId: ownerId,
        offerProperties: give == null ? [] : [give],
        offerCash,
        offerCards: [],
        requestProperties: [space.index],
        requestCash: 0,
        requestCards: [],
      },
      reason: `Offers for ${space.name} to close the ${GROUP_META[space.group].label} ward.`,
    };
  }
  return null;
}

function ownedMissing(state: GameState, player: Player): Street[] {
  const missing: Street[] = [];
  for (const space of Object.values(GROUP_META).length ? allStreets() : []) {
    const group = groupIndices(space.group);
    const mine = group.filter((i) => state.deeds[i]?.ownerId === player.id).length;
    if (mine !== group.length - 1) continue;
    if (state.deeds[space.index]?.ownerId && state.deeds[space.index]?.ownerId !== player.id && (state.deeds[space.index]?.houses ?? 0) === 0) {
      missing.push(space);
    }
  }
  return missing;
}

function sacrificialDeed(state: GameState, playerId: string, keep: Street["group"]): number | null {
  let best: { index: number; price: number } | null = null;
  for (const index of ownedIndices(state, playerId)) {
    const space = spaceAt(index);
    const deed = state.deeds[index];
    if (!isDeed(space) || !deed || deed.houses > 0) continue;
    if (space.kind === "street" && space.group === keep) continue;
    if (space.kind === "street") {
      const group = groupIndices(space.group);
      const mine = group.filter((i) => state.deeds[i]?.ownerId === playerId).length;
      if (mine >= group.length - 1) continue;
    }
    if (!best || space.price < best.price) best = { index, price: space.price };
  }
  return best?.index ?? null;
}

function valueBundle(state: GameState, player: Player, indices: number[], cash: number): number {
  let total = cash;
  for (const index of indices) total += strategicValue(state, player, index);
  return total;
}

function wouldComplete(state: GameState, playerId: string, index: number): boolean {
  const space = spaceAt(index);
  if (space.kind !== "street") return false;
  if (state.deeds[index]?.ownerId === playerId) return false;
  const group = groupIndices(space.group);
  const mine = group.filter((i) => i !== index && state.deeds[i]?.ownerId === playerId).length;
  return mine === group.length - 1;
}

function wouldBeHotel(state: GameState, index: number): boolean {
  return state.deeds[index]?.houses === 4;
}

function rentDelta(state: GameState, index: number): number {
  const now = computeRent(state, index, 7, 1);
  const copy = structuredClone(state) as GameState;
  const deed = copy.deeds[index];
  if (!deed) return 0;
  deed.houses += 1;
  return computeRent(copy, index, 7, 1) - now;
}

function opponentsHaveWard(state: GameState, playerId: string): boolean {
  for (const other of state.players) {
    if (other.id === playerId || other.bankrupt) continue;
    for (const group of Object.keys(GROUP_META) as Street["group"][]) {
      if (groupIndices(group).every((i) => state.deeds[i]?.ownerId === other.id)) return true;
    }
  }
  return false;
}

function allStreets(): Street[] {
  const streets: Street[] = [];
  for (let i = 0; i < 40; i++) {
    const space = spaceAt(i);
    if (space.kind === "street") streets.push(space);
  }
  return streets;
}

function hash(state: GameState, salt: string, n: number): number {
  let x = (state.seed ^ Math.imul(state.turnCount + 1, 997) ^ Math.imul(n + 3, 131)) >>> 0;
  for (const char of salt) x = Math.imul(x ^ char.charCodeAt(0), 16777619) >>> 0;
  return x;
}

export function positionScore(state: GameState, playerId: string): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.bankrupt) return -100_000;
  return netWorth(state, playerId) - expectedRentHit(state, playerId) * 4;
}
