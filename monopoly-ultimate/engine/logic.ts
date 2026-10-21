import { BOARD, groupIndices, isDeed, mortgageValue, RAILS, spaceAt, UTILITIES, type Space, type Street } from "./board.ts";
import { cardById, deckIds, type CardDef } from "./cards.ts";
import { drawDie, shuffleInPlace } from "./rng.ts";
import {
  ActionError,
  SAVE_VERSION,
  type Action,
  type Auction,
  type CreateConfig,
  type Debt,
  type Difficulty,
  type GameMode,
  type GameState,
  type Personality,
  type Phase,
  type Player,
  type Resume,
  type Rules,
  type TokenId,
  type Trade,
} from "./types.ts";

export const CLASSIC_RULES: Rules = {
  startingCash: 1500,
  goSalary: 200,
  jailFine: 50,
  maxJailRolls: 3,
  doublesToJail: true,
  freeParkingPot: false,
  auctions: true,
  trading: true,
  evenBuild: true,
  houseSupply: 32,
  hotelSupply: 12,
  mortgageRate: 0.1,
  roundLimit: null,
  safetyRounds: 80,
  auctionIncrement: 10,
  minBid: 1,
};

export const RULE_PRESETS: Record<string, Partial<Rules>> = {
  classic: {},
  short: { roundLimit: 12 },
  tycoon: { startingCash: 2500 },
  sprint: { roundLimit: 8, startingCash: 2000, freeParkingPot: true },
  casual: { startingCash: 2000, freeParkingPot: true, roundLimit: 20 },
};

const TOKENS: TokenId[] = ["heron", "lantern", "ferry", "key", "compass", "crown", "anchor", "fox"];

export function makeRules(partial?: Partial<Rules>): Rules {
  const rules = { ...CLASSIC_RULES, ...partial };
  if (rules.startingCash < 0 || rules.goSalary < 0 || rules.jailFine < 0) {
    throw new ActionError("Money rules cannot be negative");
  }
  if (rules.maxJailRolls < 1 || rules.houseSupply < 0 || rules.hotelSupply < 0) {
    throw new ActionError("Invalid supply or jail rule");
  }
  if (rules.auctionIncrement < 1 || rules.minBid < 1) throw new ActionError("Invalid auction rule");
  return rules;
}

export function createGame(config: CreateConfig): GameState {
  if (config.players.length < 2 || config.players.length > 6) {
    throw new ActionError("Aurelia is played with 2 to 6 owners");
  }
  const tokens = new Set<string>();
  config.players.forEach((p, i) => {
    const token = p.token ?? TOKENS[i];
    if (!token || tokens.has(token)) throw new ActionError("Each owner needs a distinct token");
    tokens.add(token);
    if (!p.name.trim()) throw new ActionError("Every owner needs a name");
  });
  const rules = makeRules(config.rules);
  const seed = config.seed ?? Math.floor(Math.random() * 1_000_000_000) + 1;
  const state: GameState = {
    version: SAVE_VERSION,
    id: config.id ?? `aurelia-${seed.toString(36)}`,
    seed,
    rng: { s: seed >>> 0 },
    rules,
    players: config.players.map((p, i) => ({
      id: `p${i + 1}`,
      name: p.name.trim(),
      human: p.human,
      token: p.token ?? TOKENS[i]!,
      difficulty: p.difficulty ?? "normal",
      personality: p.personality ?? "balanced",
      cash: rules.startingCash,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: [],
      bankrupt: false,
      doublesStreak: 0,
    })),
    deeds: {},
    phase: "pre_roll",
    current: 0,
    dice: null,
    mustRoll: true,
    pendingExtraRoll: false,
    diceQueue: config.diceQueue ? config.diceQueue.slice() : [],
    housesLeft: rules.houseSupply,
    hotelsLeft: rules.hotelSupply,
    pot: 0,
    tideDraw: [],
    tideDiscard: [],
    cityDraw: [],
    cityDiscard: [],
    revealedCard: null,
    purchaseIndex: null,
    auction: null,
    debt: null,
    debtQueue: [],
    trade: null,
    phaseBeforeTrade: null,
    rentMultiplier: 1,
    freshDice: false,
    suppressExtra: false,
    log: [],
    logSeq: 0,
    turnCount: 1,
    round: 1,
    offersThisTurn: 0,
    cardChain: 0,
    gameOver: false,
    winnerId: null,
    endReason: null,
    mode: config.mode ?? "solo",
    createdAt: Date.now(),
    lastMove: null,
  };
  for (const space of BOARD) {
    if (isDeed(space)) state.deeds[space.index] = { ownerId: null, mortgaged: false, houses: 0 };
  }
  state.tideDraw = shuffleInPlace(state, deckIds("tide"));
  state.cityDraw = shuffleInPlace(state, deckIds("city"));
  log(state, "The harbor opens. Deeds are unclaimed and the tide is in.");
  return state;
}

export function dispatch(state: GameState, action: Action): { ok: true; state: GameState } | { ok: false; error: string } {
  const next = structuredClone(state) as GameState;
  try {
    apply(next, action);
    const problems = invariantErrors(next);
    if (problems.length) throw new Error(`State invariant broken: ${problems.join("; ")}`);
    return { ok: true, state: next };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, error: error.message };
    throw error;
  }
}

export function invariantErrors(state: GameState): string[] {
  const errs: string[] = [];
  for (const p of state.players) {
    if (!Number.isInteger(p.cash) || p.cash < 0) errs.push(`${p.name} cash ${p.cash}`);
    if (p.position < 0 || p.position > 39) errs.push(`${p.name} position`);
    if (p.bankrupt && p.cash !== 0) errs.push(`${p.name} bankrupt with cash`);
  }
  let houses = 0;
  let hotels = 0;
  for (const [key, deed] of Object.entries(state.deeds)) {
    const index = Number(key);
    const space = BOARD[index];
    if (!space || !isDeed(space)) errs.push(`deed on ${key}`);
    if (deed.houses < 0 || deed.houses > 5) errs.push(`houses ${key}`);
    if (deed.houses === 5) hotels += 1;
    else houses += deed.houses;
    if (deed.ownerId && !state.players.some((p) => p.id === deed.ownerId)) errs.push(`owner ${key}`);
    if (!deed.ownerId && (deed.houses > 0 || deed.mortgaged)) errs.push(`wild deed ${key}`);
    if (deed.mortgaged && deed.houses > 0) errs.push(`mortgaged buildings ${key}`);
  }
  if (houses + state.housesLeft !== state.rules.houseSupply) {
    errs.push(`houses ${houses}+${state.housesLeft}!=${state.rules.houseSupply}`);
  }
  if (hotels + state.hotelsLeft !== state.rules.hotelSupply) {
    errs.push(`hotels ${hotels}+${state.hotelsLeft}`);
  }
  if (!state.gameOver && state.players[state.current]?.bankrupt && state.phase !== "debt" && state.phase !== "auction") {
    errs.push("bankrupt seat to move");
  }
  return errs;
}

export function actorId(state: GameState): string | null {
  if (state.gameOver) return null;
  if (state.phase === "debt" && state.debt) return state.debt.debtorId;
  if (state.phase === "auction" && state.auction) return state.auction.turnId;
  if (state.phase === "trade" && state.trade) return state.trade.toId;
  return state.players[state.current]?.id ?? null;
}

export function debtTotal(debt: Debt): number {
  return debt.parts.reduce((sum, part) => sum + part.amount, 0);
}

export function netWorth(state: GameState, playerId: string): number {
  const player = playerById(state, playerId);
  let worth = player.cash;
  for (const [key, deed] of Object.entries(state.deeds)) {
    if (deed.ownerId !== playerId) continue;
    const space = spaceAt(Number(key));
    if (!isDeed(space)) continue;
    worth += deed.mortgaged ? mortgageValue(space) : space.price;
    if (space.kind === "street" && deed.houses > 0) worth += deed.houses * space.house;
  }
  return worth;
}

export function standings(state: GameState) {
  return state.players
    .map((p) => ({
      id: p.id,
      name: p.name,
      cash: p.cash,
      netWorth: p.bankrupt ? 0 : netWorth(state, p.id),
      properties: ownedIndices(state, p.id).length,
      bankrupt: p.bankrupt,
      token: p.token,
      human: p.human,
    }))
    .sort((a, b) => b.netWorth - a.netWorth || b.cash - a.cash);
}

export function ownedIndices(state: GameState, playerId: string): number[] {
  const indices: number[] = [];
  for (const [key, deed] of Object.entries(state.deeds)) {
    if (deed.ownerId === playerId) indices.push(Number(key));
  }
  return indices.sort((a, b) => a - b);
}

export function computeRent(state: GameState, index: number, diceTotal: number, multiplier = 1): number {
  const space = spaceAt(index);
  const deed = state.deeds[index];
  if (!deed?.ownerId || deed.mortgaged || !isDeed(space)) return 0;
  if (space.kind === "rail") {
    const count = RAILS.filter((i) => {
      const d = state.deeds[i];
      return d?.ownerId === deed.ownerId && !d.mortgaged;
    }).length;
    const table = [0, 25, 50, 100, 200];
    return (table[count] ?? 200) * multiplier;
  }
  if (space.kind === "utility") {
    if (multiplier > 1) return multiplier * diceTotal;
    const count = UTILITIES.filter((i) => {
      const d = state.deeds[i];
      return d?.ownerId === deed.ownerId && !d.mortgaged;
    }).length;
    return (count >= 2 ? 10 : 4) * diceTotal;
  }
  let rent = space.rent[deed.houses] ?? 0;
  if (deed.houses === 0 && fullSet(state, space.group, deed.ownerId) && !groupMortgaged(state, space.group)) {
    rent *= 2;
  }
  return rent * multiplier;
}

export function canBuild(state: GameState, playerId: string, index: number): string | null {
  const player = playerById(state, playerId);
  if (player.bankrupt) return "Eliminated";
  const space = spaceAt(index);
  const deed = state.deeds[index];
  if (space.kind !== "street" || !deed) return "Only streets can be developed";
  if (deed.ownerId !== playerId) return "You do not own this deed";
  if (!fullSet(state, space.group, playerId)) return "Own the full ward first";
  if (groupMortgaged(state, space.group)) return "Unmortgage the ward before building";
  if (deed.houses >= 5) return "A hotel already stands here";
  if (state.rules.evenBuild) {
    const min = minHouses(state, space.group);
    if (deed.houses > min) return "Build evenly across the ward";
  }
  if (player.cash < space.house) return "Not enough cash";
  if (deed.houses < 4 && state.housesLeft < 1) return "The bank has no houses left";
  if (deed.houses === 4 && state.hotelsLeft < 1) return "The bank has no hotels left";
  return null;
}

export function canSell(state: GameState, playerId: string, index: number): string | null {
  const space = spaceAt(index);
  const deed = state.deeds[index];
  if (space.kind !== "street" || !deed) return "Nothing to sell";
  if (deed.ownerId !== playerId) return "You do not own this deed";
  if (deed.houses <= 0) return "No buildings here";
  if (state.rules.evenBuild) {
    const max = maxHouses(state, space.group);
    if (deed.houses < max) return "Sell evenly across the ward";
  }
  if (deed.houses === 5 && state.housesLeft < 4) return "The bank lacks four houses to break this hotel";
  return null;
}

export function canMortgage(state: GameState, playerId: string, index: number): string | null {
  const space = spaceAt(index);
  const deed = state.deeds[index];
  if (!deed || !isDeed(space)) return "Not a deed";
  if (deed.ownerId !== playerId) return "You do not own this deed";
  if (deed.mortgaged) return "Already mortgaged";
  if (space.kind === "street") {
    for (const i of groupIndices(space.group)) {
      if ((state.deeds[i]?.houses ?? 0) > 0) return "Sell every building in the ward first";
    }
  }
  return null;
}

export function canUnmortgage(state: GameState, playerId: string, index: number): string | null {
  const space = spaceAt(index);
  const deed = state.deeds[index];
  if (!deed || !isDeed(space)) return "Not a deed";
  if (deed.ownerId !== playerId) return "You do not own this deed";
  if (!deed.mortgaged) return "This deed is not mortgaged";
  if (playerById(state, playerId).cash < unmortgageCost(state, space)) return "Not enough cash to lift the mortgage";
  return null;
}

export function unmortgageCost(state: GameState, space: Space): number {
  if (!isDeed(space)) return 0;
  const base = mortgageValue(space);
  return base + Math.round(base * state.rules.mortgageRate);
}

export function phaseHint(state: GameState): string {
  const player = state.players[state.current];
  if (state.gameOver) return state.endReason ?? "The match is over.";
  if (state.phase === "pre_roll") return `${player?.name ?? "The owner"} may develop, trade, or roll.`;
  if (state.phase === "jail") return `${player?.name ?? "The owner"} is in the Lockup and must pay, use a key, or roll for doubles.`;
  if (state.phase === "purchase") {
    const space = state.purchaseIndex != null ? spaceAt(state.purchaseIndex) : null;
    return space && isDeed(space)
      ? `${space.name} is unclaimed. Buy it for ${space.price}, or send it to auction.`
      : "A deed is for sale.";
  }
  if (state.phase === "auction") return "Auction in progress. Bid at least the asking price, or pass.";
  if (state.phase === "card" && state.revealedCard) {
    const card = cardById(state.revealedCard);
    return `${card.title}. ${card.text}`;
  }
  if (state.phase === "debt" && state.debt) {
    const debtor = playerById(state, state.debt.debtorId);
    return `${debtor.name} owes ${debtTotal(state.debt)}. Raise funds, pay, or go bankrupt.`;
  }
  if (state.phase === "trade" && state.trade) {
    const to = playerById(state, state.trade.toId);
    return `${to.name} must accept, refuse, or counter the offer.`;
  }
  if (state.phase === "manage") {
    return state.mustRoll
      ? "Doubles — roll again."
      : `${player?.name ?? "The owner"} may develop, mortgage, trade, or end the turn.`;
  }
  return "Waiting.";
}

export function minNextBid(state: GameState, auction: Auction): number {
  if (auction.highBid <= 0) return state.rules.minBid;
  return auction.highBid + state.rules.auctionIncrement;
}

function apply(state: GameState, action: Action) {
  if (state.gameOver) throw new ActionError("The match is over");
  switch (action.type) {
    case "ROLL":
      return roll(state);
    case "BUY":
      return buy(state);
    case "DECLINE":
      return decline(state);
    case "BID":
      return bid(state, action.amount);
    case "PASS":
      return passAuction(state);
    case "ACK":
      return ackCard(state);
    case "PAY_FINE":
      return payFine(state);
    case "USE_CARD":
      return useJailCard(state);
    case "ROLL_JAIL":
      return rollJail(state);
    case "BUILD":
      return build(state, action.index);
    case "SELL":
      return sell(state, action.index);
    case "MORTGAGE":
      return mortgage(state, action.index);
    case "UNMORTGAGE":
      return unmortgage(state, action.index);
    case "END_TURN":
      return endTurn(state);
    case "PAY_DEBT":
      return payDebt(state);
    case "BANKRUPT":
      return declareBankrupt(state);
    case "RESIGN":
      return resign(state);
    case "PROPOSE":
      return propose(state, action);
    case "ACCEPT":
      return acceptTrade(state);
    case "REJECT":
      return rejectTrade(state);
    case "CANCEL_TRADE":
      return cancelTrade(state);
    case "COUNTER":
      return counterTrade(state, action);
    default:
      throw new ActionError("Unknown action");
  }
}

function roll(state: GameState) {
  if (state.phase !== "pre_roll" || !state.mustRoll) throw new ActionError("You cannot roll right now");
  const player = current(state);
  if (player.inJail) throw new ActionError("Resolve the Lockup first");
  const d1 = drawDie(state);
  const d2 = drawDie(state);
  state.dice = [d1, d2];
  const doubles = d1 === d2;
  player.doublesStreak = doubles ? player.doublesStreak + 1 : 0;
  log(state, `${player.name} rolls ${d1} and ${d2}${doubles ? " — doubles" : ""}.`, { playerId: player.id });
  if (doubles && state.rules.doublesToJail && player.doublesStreak >= 3) {
    sendToJail(state, player, "three doubles in a row");
    state.mustRoll = false;
    state.phase = "manage";
    return;
  }
  state.pendingExtraRoll = doubles;
  state.rentMultiplier = 1;
  state.freshDice = false;
  state.suppressExtra = false;
  state.mustRoll = false;
  movePlayer(state, player, d1 + d2, true);
  resolveLanding(state, player);
}

function buy(state: GameState) {
  if (state.phase !== "purchase" || state.purchaseIndex == null) throw new ActionError("Nothing is for sale");
  const player = current(state);
  const space = spaceAt(state.purchaseIndex);
  if (!isDeed(space)) throw new ActionError("That space cannot be bought");
  const deed = state.deeds[space.index]!;
  if (deed.ownerId) throw new ActionError("Already owned");
  if (player.cash < space.price) throw new ActionError("Not enough cash to buy this deed");
  player.cash -= space.price;
  deed.ownerId = player.id;
  deed.mortgaged = false;
  deed.houses = 0;
  log(state, `${player.name} buys ${space.name} for ${space.price}.`, { playerId: player.id, amount: -space.price });
  state.purchaseIndex = null;
  state.phase = "manage";
  finish(state);
}

function decline(state: GameState) {
  if (state.phase !== "purchase" || state.purchaseIndex == null) throw new ActionError("Nothing to decline");
  const space = spaceAt(state.purchaseIndex);
  const player = current(state);
  if (!state.rules.auctions) {
    log(state, `${player.name} leaves ${isDeed(space) ? space.name : "the space"} unclaimed.`);
    state.purchaseIndex = null;
    state.phase = "manage";
    finish(state);
    return;
  }
  log(state, `${player.name} declines. ${isDeed(space) ? space.name : "The deed"} goes to auction.`);
  startAuction(state, state.purchaseIndex);
}

function bid(state: GameState, amount: number) {
  const auction = state.auction;
  if (state.phase !== "auction" || !auction) throw new ActionError("No auction is running");
  const player = playerById(state, auction.turnId);
  if (!Number.isInteger(amount)) throw new ActionError("Bids must be whole coins");
  const min = minNextBid(state, auction);
  if (amount < min) throw new ActionError(`The next bid must be at least ${min}`);
  if (amount > player.cash) throw new ActionError("That bid is more cash than you hold");
  auction.highBid = amount;
  auction.highBidderId = player.id;
  auction.bids.push({ playerId: player.id, amount });
  log(state, `${player.name} bids ${amount}.`, { playerId: player.id });
  const idx = auction.order.indexOf(player.id);
  auction.turnId = auction.order[(idx + 1) % auction.order.length] ?? player.id;
  settleAuction(state);
}

function passAuction(state: GameState) {
  const auction = state.auction;
  if (state.phase !== "auction" || !auction) throw new ActionError("No auction is running");
  const player = playerById(state, auction.turnId);
  if (!auction.passed.includes(player.id)) auction.passed.push(player.id);
  log(state, `${player.name} passes.`, { playerId: player.id });
  settleAuction(state);
}

function ackCard(state: GameState) {
  if (state.phase !== "card" || !state.revealedCard) throw new ActionError("No notice to resolve");
  const card = cardById(state.revealedCard);
  state.revealedCard = null;
  state.phase = "manage";
  if (card.effect.kind !== "jail_card") discardCard(state, card);
  applyCard(state, card);
}

function payFine(state: GameState) {
  const player = current(state);
  if (state.phase !== "jail" || !player.inJail) throw new ActionError("You are not detained");
  charge(state, player, [{ creditorId: "bank", amount: state.rules.jailFine }], "Lockup fine", { type: "release_to_roll" });
}

function useJailCard(state: GameState) {
  const player = current(state);
  if (state.phase !== "jail" || !player.inJail) throw new ActionError("You are not detained");
  const cardId = player.jailCards.pop();
  if (!cardId) throw new ActionError("You have no key or pardon");
  discardCard(state, cardById(cardId));
  log(state, `${player.name} uses a ${cardById(cardId).title.toLowerCase()}.`, { playerId: player.id });
  releaseToRoll(state, player);
}

function rollJail(state: GameState) {
  const player = current(state);
  if (state.phase !== "jail" || !player.inJail) throw new ActionError("You are not detained");
  const d1 = drawDie(state);
  const d2 = drawDie(state);
  state.dice = [d1, d2];
  player.doublesStreak = 0;
  if (d1 === d2) {
    log(state, `${player.name} rolls ${d1} and ${d2} and slips the Lockup. No extra turn.`, { playerId: player.id });
    player.inJail = false;
    player.jailTurns = 0;
    state.pendingExtraRoll = false;
    state.suppressExtra = true;
    state.mustRoll = false;
    movePlayer(state, player, d1 + d2, true);
    resolveLanding(state, player);
    return;
  }
  player.jailTurns += 1;
  log(state, `${player.name} rolls ${d1} and ${d2} and stays detained (${player.jailTurns}/${state.rules.maxJailRolls}).`, {
    playerId: player.id,
  });
  if (player.jailTurns >= state.rules.maxJailRolls) {
    charge(state, player, [{ creditorId: "bank", amount: state.rules.jailFine }], "Third-turn Lockup fine", {
      type: "leave_jail_and_move",
      steps: d1 + d2,
    });
    return;
  }
  state.mustRoll = false;
  state.pendingExtraRoll = false;
  state.phase = "manage";
}

function build(state: GameState, index: number) {
  const player = economyPlayer(state);
  assertDevelopPhase(state);
  const reason = canBuild(state, player.id, index);
  if (reason) throw new ActionError(reason);
  const space = spaceAt(index) as Street;
  const deed = state.deeds[index]!;
  if (deed.houses < 4) {
    state.housesLeft -= 1;
    deed.houses += 1;
  } else {
    state.housesLeft += 4;
    state.hotelsLeft -= 1;
    deed.houses = 5;
  }
  player.cash -= space.house;
  const built = deed.houses === 5 ? "a hotel" : `house ${deed.houses}`;
  log(state, `${player.name} raises ${built} on ${space.name} for ${space.house}.`, { playerId: player.id, amount: -space.house });
}

function sell(state: GameState, index: number) {
  const player = economyPlayer(state);
  assertDevelopPhase(state);
  const reason = canSell(state, player.id, index);
  if (reason) throw new ActionError(reason);
  const space = spaceAt(index) as Street;
  const deed = state.deeds[index]!;
  const refund = Math.floor(space.house / 2);
  if (deed.houses === 5) {
    state.hotelsLeft += 1;
    state.housesLeft -= 4;
    deed.houses = 4;
  } else {
    deed.houses -= 1;
    state.housesLeft += 1;
  }
  player.cash += refund;
  log(state, `${player.name} sells a building on ${space.name} for ${refund}.`, { playerId: player.id, amount: refund });
}

function mortgage(state: GameState, index: number) {
  const player = economyPlayer(state);
  assertDevelopPhase(state);
  const reason = canMortgage(state, player.id, index);
  if (reason) throw new ActionError(reason);
  const space = spaceAt(index);
  if (!isDeed(space)) throw new ActionError("Not a deed");
  const deed = state.deeds[index]!;
  deed.mortgaged = true;
  const value = mortgageValue(space);
  player.cash += value;
  log(state, `${player.name} mortgages ${space.name} for ${value}.`, { playerId: player.id, amount: value });
}

function unmortgage(state: GameState, index: number) {
  const player = economyPlayer(state);
  assertDevelopPhase(state);
  const reason = canUnmortgage(state, player.id, index);
  if (reason) throw new ActionError(reason);
  const space = spaceAt(index);
  if (!isDeed(space)) throw new ActionError("Not a deed");
  const cost = unmortgageCost(state, space);
  player.cash -= cost;
  state.deeds[index]!.mortgaged = false;
  log(state, `${player.name} lifts the mortgage on ${space.name} for ${cost}.`, { playerId: player.id, amount: -cost });
}

function endTurn(state: GameState) {
  if (state.phase !== "manage") throw new ActionError("You cannot end the turn yet");
  if (state.mustRoll || state.pendingExtraRoll) throw new ActionError("Roll the doubles first");
  if (state.debt || state.auction || state.trade || state.revealedCard) throw new ActionError("Resolve the current event first");
  advanceSeat(state);
}

function payDebt(state: GameState) {
  const debt = state.debt;
  if (state.phase !== "debt" || !debt) throw new ActionError("No debt is due");
  const player = playerById(state, debt.debtorId);
  const total = debtTotal(debt);
  if (player.cash < total) throw new ActionError("You still cannot cover this debt");
  player.cash -= total;
  for (const part of debt.parts) payCreditor(state, part.creditorId, part.amount);
  log(state, `${player.name} pays ${total} toward ${debt.reason}.`, { playerId: player.id, amount: -total });
  const resume = debt.resume;
  state.debt = null;
  if (state.phase === "debt") state.phase = "manage";
  completeAfterDebt(state, resume, false);
}

function declareBankrupt(state: GameState) {
  const debt = state.debt;
  if (state.phase !== "debt" || !debt) throw new ActionError("You are not facing a debt");
  const player = playerById(state, debt.debtorId);
  if (player.cash >= debtTotal(debt)) throw new ActionError("Pay the debt instead of going bankrupt");
  if (canRaise(state, player.id)) throw new ActionError("Sell buildings or mortgage deeds before conceding bankruptcy");
  const creditor = mainCreditor(debt);
  const resume = debt.resume;
  state.debt = null;
  if (state.phase === "debt") state.phase = "manage";
  transferEstate(state, player, creditor);
  completeAfterDebt(state, resume, true);
}

function resign(state: GameState) {
  const id = actorId(state);
  if (!id) throw new ActionError("No one can resign");
  const player = playerById(state, id);
  if (!player.human) throw new ActionError("Only a human owner may resign");
  let creditor = "bank";
  let resume: Resume = { type: "noop" };
  if (state.debt && state.debt.debtorId === id) {
    creditor = mainCreditor(state.debt);
    resume = state.debt.resume;
    state.debt = null;
  }
  state.purchaseIndex = null;
  state.revealedCard = null;
  log(state, `${player.name} resigns from the harbor.`, { playerId: player.id });
  transferEstate(state, player, creditor);
  completeAfterDebt(state, resume, true);
}

function propose(state: GameState, action: Extract<Action, { type: "PROPOSE" }>) {
  if (!state.rules.trading) throw new ActionError("Trading is turned off");
  if (!["pre_roll", "manage", "jail", "debt", "purchase", "card"].includes(state.phase)) {
    throw new ActionError("You cannot open a trade right now");
  }
  if (state.offersThisTurn >= 3) throw new ActionError("No more offers this turn");
  const from = economyPlayer(state);
  if (from.id === action.toId) throw new ActionError("You cannot trade with yourself");
  const to = playerById(state, action.toId);
  if (to.bankrupt || from.bankrupt) throw new ActionError("That owner is out of the match");
  const trade = sanitizeTrade(state, from, to, action, 0);
  state.phaseBeforeTrade = state.phase;
  state.trade = trade;
  state.phase = "trade";
  state.offersThisTurn += 1;
  log(state, `${from.name} offers ${to.name} a trade.`, { playerId: from.id });
}

function acceptTrade(state: GameState) {
  const trade = state.trade;
  if (state.phase !== "trade" || !trade) throw new ActionError("No trade is waiting");
  const from = playerById(state, trade.fromId);
  const to = playerById(state, trade.toId);
  assertTradeFunds(state, from, to, trade);
  moveCashAndDeeds(state, from, to, trade);
  log(state, `${to.name} accepts ${from.name}'s trade.`, { playerId: to.id });
  restorePhase(state);
}

function rejectTrade(state: GameState) {
  const trade = state.trade;
  if (state.phase !== "trade" || !trade) throw new ActionError("No trade is waiting");
  const to = playerById(state, trade.toId);
  log(state, `${to.name} refuses the trade.`, { playerId: to.id });
  state.trade = null;
  restorePhase(state);
}

function cancelTrade(state: GameState) {
  if (state.phase !== "trade" || !state.trade) throw new ActionError("No trade is waiting");
  log(state, `${playerById(state, state.trade.fromId).name} withdraws the offer.`);
  state.trade = null;
  restorePhase(state);
}

function counterTrade(state: GameState, action: Extract<Action, { type: "COUNTER" }>) {
  const trade = state.trade;
  if (state.phase !== "trade" || !trade) throw new ActionError("No trade is waiting");
  if (trade.hops >= 2) throw new ActionError("This negotiation has gone on long enough");
  const from = playerById(state, trade.toId);
  const to = playerById(state, trade.fromId);
  const next = sanitizeTrade(state, from, to, { ...action, toId: to.id, type: "PROPOSE" }, trade.hops + 1);
  state.trade = next;
  state.offersThisTurn += 1;
  log(state, `${from.name} counters.`, { playerId: from.id });
}

function economyPlayer(state: GameState): Player {
  if (state.phase === "trade") throw new ActionError("Finish the trade first");
  if (state.phase === "debt" && state.debt) return playerById(state, state.debt.debtorId);
  if (state.phase === "auction" && state.auction) return playerById(state, state.auction.turnId);
  return current(state);
}

function assertDevelopPhase(state: GameState) {
  const ok: Phase[] = ["pre_roll", "manage", "jail", "purchase", "card", "debt", "auction"];
  if (!ok.includes(state.phase)) throw new ActionError("You cannot manage deeds right now");
}

function rollRelease(_state: GameState, player: Player) {
  player.inJail = false;
  player.jailTurns = 0;
}

function releaseToRoll(state: GameState, player: Player) {
  rollRelease(state, player);
  state.phase = "pre_roll";
  state.mustRoll = true;
  state.pendingExtraRoll = false;
  log(state, `${player.name} is free to roll.`, { playerId: player.id });
}

function sendToJail(state: GameState, player: Player, why: string) {
  player.position = 10;
  player.inJail = true;
  player.jailTurns = 0;
  player.doublesStreak = 0;
  state.pendingExtraRoll = false;
  state.suppressExtra = true;
  state.lastMove = { playerId: player.id, path: [10] };
  log(state, `${player.name} is sent to the Lockup (${why}).`, { playerId: player.id });
}

function movePlayer(state: GameState, player: Player, steps: number, awardGo: boolean) {
  if (steps === 0) {
    state.lastMove = { playerId: player.id, path: [player.position] };
    return;
  }
  const path: number[] = [];
  if (steps > 0) {
    for (let i = 1; i <= steps; i++) path.push((player.position + i) % 40);
    player.position = path[path.length - 1]!;
    state.lastMove = { playerId: player.id, path };
    if (awardGo && path.includes(0)) {
      player.cash += state.rules.goSalary;
      log(state, `${player.name} passes Harbor Gate and collects ${state.rules.goSalary}.`, {
        playerId: player.id,
        amount: state.rules.goSalary,
      });
    }
    return;
  }
  const back = -steps;
  for (let i = 1; i <= back; i++) path.push((player.position - i + 40) % 40);
  player.position = path[path.length - 1]!;
  state.lastMove = { playerId: player.id, path };
}

function resolveLanding(state: GameState, player: Player) {
  const space = spaceAt(player.position);
  const multiplier = state.rentMultiplier;
  const fresh = state.freshDice;
  state.rentMultiplier = 1;
  state.freshDice = false;
  if (space.kind === "go" || space.kind === "jail") {
    if (space.kind === "jail") log(state, `${player.name} is only visiting the Lockup.`, { playerId: player.id });
    finish(state);
    return;
  }
  if (space.kind === "free") {
    if (state.rules.freeParkingPot && state.pot > 0) {
      player.cash += state.pot;
      log(state, `${player.name} collects ${state.pot} from Free Plaza.`, { playerId: player.id, amount: state.pot });
      state.pot = 0;
    } else {
      log(state, `${player.name} rests at Free Plaza.`, { playerId: player.id });
    }
    finish(state);
    return;
  }
  if (space.kind === "gotojail") {
    sendToJail(state, player, "the harbor watch");
    finish(state);
    return;
  }
  if (space.kind === "tax") {
    const creditor = state.rules.freeParkingPot ? "pot" : "bank";
    charge(state, player, [{ creditorId: creditor, amount: space.amount }], space.name, { type: "finish" });
    return;
  }
  if (space.kind === "card") {
    if (state.cardChain >= 6) {
      log(state, "The ledgers jam shut before another notice can be drawn.");
      finish(state);
      return;
    }
    state.cardChain += 1;
    const id = drawFrom(state, space.deck);
    state.revealedCard = id;
    state.phase = "card";
    const card = cardById(id);
    log(state, `${player.name} draws ${card.title}.`, { playerId: player.id });
    return;
  }
  if (isDeed(space)) resolveDeed(state, player, space, multiplier, fresh);
}

function resolveDeed(
  state: GameState,
  player: Player,
  space: Extract<Space, { kind: "street" | "rail" | "utility" }>,
  multiplier: number,
  fresh: boolean,
) {
  const deed = state.deeds[space.index]!;
  if (!deed.ownerId) {
    if (player.cash < space.price && !state.rules.auctions) {
      log(state, `${player.name} cannot afford ${space.name}, and auctions are off.`, { playerId: player.id });
      finish(state);
      return;
    }
    state.purchaseIndex = space.index;
    state.phase = "purchase";
    log(state, `${player.name} lands on unclaimed ${space.name}.`, { playerId: player.id });
    return;
  }
  if (deed.ownerId === player.id) {
    log(state, `${player.name} lands on their own ${space.name}.`, { playerId: player.id });
    finish(state);
    return;
  }
  const owner = playerById(state, deed.ownerId);
  if (deed.mortgaged) {
    log(state, `${space.name} is mortgaged. No rent is due.`, { playerId: player.id });
    finish(state);
    return;
  }
  let diceTotal = state.dice ? state.dice[0] + state.dice[1] : 0;
  if (fresh && space.kind === "utility") {
    const a = drawDie(state);
    const b = drawDie(state);
    state.dice = [a, b];
    diceTotal = a + b;
    log(state, `Works dice: ${a} and ${b}.`, { playerId: player.id });
  }
  const due = computeRent(state, space.index, diceTotal, multiplier);
  if (due <= 0) {
    finish(state);
    return;
  }
  charge(state, player, [{ creditorId: owner.id, amount: due }], `rent at ${space.name}`, { type: "finish" });
}

function applyCard(state: GameState, card: CardDef) {
  const player = current(state);
  const effect = card.effect;
  log(state, card.text, { playerId: player.id });
  if (effect.kind === "cash") {
    if (effect.amount >= 0) {
      player.cash += effect.amount;
      log(state, `${player.name} collects ${effect.amount}.`, { playerId: player.id, amount: effect.amount });
      finish(state);
      return;
    }
    charge(state, player, [{ creditorId: "bank", amount: -effect.amount }], card.title, { type: "finish" });
    return;
  }
  if (effect.kind === "pay_each") {
    const others = alive(state).filter((p) => p.id !== player.id);
    if (others.length === 0) {
      finish(state);
      return;
    }
    charge(
      state,
      player,
      others.map((p) => ({ creditorId: p.id, amount: effect.amount })),
      card.title,
      { type: "finish" },
    );
    return;
  }
  if (effect.kind === "collect_each") {
    const debtors: Player[] = [];
    for (const other of alive(state)) {
      if (other.id === player.id) continue;
      if (other.cash >= effect.amount) {
        other.cash -= effect.amount;
        player.cash += effect.amount;
        log(state, `${other.name} pays ${player.name} ${effect.amount}.`, { playerId: other.id, amount: -effect.amount });
      } else debtors.push(other);
    }
    if (debtors.length === 0) {
      finish(state);
      return;
    }
    debtors.forEach((debtor, index) => {
      setDebt(state, {
        debtorId: debtor.id,
        parts: [{ creditorId: player.id, amount: effect.amount }],
        reason: card.title,
        resume: index === debtors.length - 1 ? { type: "finish" } : { type: "noop" },
      });
    });
    return;
  }
  if (effect.kind === "jail_card") {
    player.jailCards.push(card.id);
    log(state, `${player.name} pockets a ${card.title.toLowerCase()}.`, { playerId: player.id });
    finish(state);
    return;
  }
  if (effect.kind === "jail") {
    sendToJail(state, player, card.title);
    finish(state);
    return;
  }
  if (effect.kind === "repairs") {
    let amount = 0;
    for (const index of ownedIndices(state, player.id)) {
      const deed = state.deeds[index]!;
      const space = spaceAt(index);
      if (space.kind !== "street") continue;
      if (deed.houses === 5) amount += effect.hotel;
      else amount += deed.houses * effect.house;
    }
    if (amount === 0) {
      log(state, `${player.name} owes nothing for repairs.`, { playerId: player.id });
      finish(state);
      return;
    }
    charge(state, player, [{ creditorId: "bank", amount }], card.title, { type: "finish" });
    return;
  }
  if (effect.kind === "steps") {
    state.rentMultiplier = 1;
    state.freshDice = false;
    state.suppressExtra = false;
    movePlayer(state, player, effect.delta, false);
    resolveLanding(state, player);
    return;
  }
  if (effect.kind === "move_to") {
    const steps = (effect.index - player.position + 40) % 40;
    state.rentMultiplier = 1;
    state.freshDice = false;
    state.suppressExtra = false;
    movePlayer(state, player, steps, effect.awardGo);
    resolveLanding(state, player);
    return;
  }
  if (effect.kind === "nearest") {
    const targets = effect.target === "rail" ? RAILS : UTILITIES;
    const found = nearestForward(player.position, targets);
    state.rentMultiplier = effect.rentMultiplier;
    state.freshDice = effect.freshDice;
    state.suppressExtra = false;
    movePlayer(state, player, found.steps, true);
    resolveLanding(state, player);
  }
}

function charge(state: GameState, debtor: Player, parts: { creditorId: string; amount: number }[], reason: string, resume: Resume) {
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  if (total <= 0) {
    runResume(state, resume);
    return;
  }
  if (debtor.cash >= total) {
    debtor.cash -= total;
    for (const part of parts) payCreditor(state, part.creditorId, part.amount);
    log(state, `${debtor.name} pays ${total} for ${reason}.`, { playerId: debtor.id, amount: -total });
    runResume(state, resume);
    return;
  }
  setDebt(state, { debtorId: debtor.id, parts, reason, resume });
  log(state, `${debtor.name} cannot cover ${total} for ${reason}.`, { playerId: debtor.id });
}

function setDebt(state: GameState, debt: Debt) {
  if (state.debt) state.debtQueue.push(debt);
  else {
    state.debt = debt;
    state.phase = "debt";
  }
}

function payCreditor(state: GameState, creditorId: string, amount: number) {
  if (amount <= 0) return;
  if (creditorId === "bank") return;
  if (creditorId === "pot") {
    state.pot += amount;
    return;
  }
  playerById(state, creditorId).cash += amount;
}

function runResume(state: GameState, resume: Resume) {
  if (state.gameOver) return;
  if (resume.type === "noop") return;
  if (resume.type === "finish") {
    finish(state);
    return;
  }
  if (resume.type === "release_to_roll") {
    releaseToRoll(state, current(state));
    return;
  }
  const player = current(state);
  if (resume.type === "leave_jail_and_move") {
    player.inJail = false;
    player.jailTurns = 0;
    state.pendingExtraRoll = false;
    state.suppressExtra = true;
    log(state, `${player.name} pays the fine and leaves the Lockup.`, { playerId: player.id });
    movePlayer(state, player, resume.steps, true);
    resolveLanding(state, player);
    return;
  }
  state.rentMultiplier = resume.rentMultiplier;
  state.freshDice = resume.freshDice;
  state.suppressExtra = resume.suppressExtra;
  if (resume.suppressExtra) state.pendingExtraRoll = false;
  movePlayer(state, player, resume.steps, resume.awardGo && resume.steps > 0);
  resolveLanding(state, player);
}

function finish(state: GameState) {
  if (state.gameOver) return;
  if (state.phase === "debt" || state.phase === "purchase" || state.phase === "auction" || state.phase === "card" || state.phase === "trade") {
    return;
  }
  const player = current(state);
  if (player.bankrupt) {
    advanceSeat(state);
    return;
  }
  state.cardChain = 0;
  if (player.inJail || state.suppressExtra) {
    state.pendingExtraRoll = false;
  }
  if (state.pendingExtraRoll && !state.suppressExtra && !player.inJail) {
    state.phase = "pre_roll";
    state.mustRoll = true;
    state.pendingExtraRoll = false;
    state.suppressExtra = false;
    log(state, `${player.name} earned another roll for doubles.`, { playerId: player.id });
    return;
  }
  state.suppressExtra = false;
  state.pendingExtraRoll = false;
  state.mustRoll = false;
  state.phase = "manage";
}

function completeAfterDebt(state: GameState, resume: Resume, eliminated: boolean) {
  if (checkSolo(state)) return;
  const debtorWasCurrent = eliminated && !!state.players[state.current]?.bankrupt;
  if (!debtorWasCurrent && state.phase === "debt") state.phase = "manage";
  if (!debtorWasCurrent) runResume(state, resume);
  if (state.gameOver) return;
  if (state.debt) {
    state.phase = "debt";
    return;
  }
  if (state.debtQueue.length > 0) {
    state.debt = state.debtQueue.shift() ?? null;
    if (state.debt) {
      state.phase = "debt";
      return;
    }
  }
  if (state.auction) {
    state.phase = "auction";
    return;
  }
  if (state.players[state.current]?.bankrupt) {
    advanceSeat(state);
    return;
  }
  if (state.phase === "debt") {
    state.phase = "manage";
    finish(state);
  }
}

function startAuction(state: GameState, propertyIndex: number) {
  const order: string[] = [];
  const n = state.players.length;
  for (let k = 0; k < n; k++) {
    const player = state.players[(state.current + k) % n]!;
    if (!player.bankrupt) order.push(player.id);
  }
  state.purchaseIndex = null;
  state.auction = {
    propertyIndex,
    order,
    highBid: 0,
    highBidderId: null,
    passed: [],
    turnId: order[0] ?? current(state).id,
    bids: [],
  };
  state.phase = "auction";
  settleAuction(state);
}

function settleAuction(state: GameState) {
  const auction = state.auction;
  if (!auction) return;
  for (const id of auction.order) {
    if (playerById(state, id).bankrupt && !auction.passed.includes(id)) auction.passed.push(id);
  }
  const active = auction.order.filter((id) => !auction.passed.includes(id) && !playerById(state, id).bankrupt);
  if (auction.highBidderId && active.length === 1 && active[0] === auction.highBidderId) {
    closeAuction(state, true);
    return;
  }
  if (active.length === 0) {
    closeAuction(state, false);
    return;
  }
  if (!active.includes(auction.turnId)) {
    const idx = Math.max(0, auction.order.indexOf(auction.turnId));
    for (let k = 1; k <= auction.order.length; k++) {
      const id = auction.order[(idx + k) % auction.order.length]!;
      if (active.includes(id)) {
        auction.turnId = id;
        break;
      }
    }
  }
}

function closeAuction(state: GameState, sold: boolean) {
  const auction = state.auction;
  if (!auction) return;
  const space = spaceAt(auction.propertyIndex);
  const name = isDeed(space) ? space.name : "the deed";
  if (sold && auction.highBidderId && auction.highBid > 0) {
    const winner = playerById(state, auction.highBidderId);
    if (winner.cash >= auction.highBid) {
      winner.cash -= auction.highBid;
      const deed = state.deeds[auction.propertyIndex]!;
      deed.ownerId = winner.id;
      deed.mortgaged = false;
      deed.houses = 0;
      log(state, `${winner.name} wins ${name} at auction for ${auction.highBid}.`, {
        playerId: winner.id,
        amount: -auction.highBid,
      });
    } else {
      log(state, `The winning bid for ${name} could not be paid. No sale.`);
    }
  } else {
    log(state, `No one bids for ${name}. It stays with the harbor.`);
  }
  state.auction = null;
  if (!state.gameOver) {
    state.phase = "manage";
    finish(state);
  }
}

function transferEstate(state: GameState, debtor: Player, creditorId: string) {
  forceLiquidate(state, debtor);
  const creditor = creditorId === "bank" || creditorId === "pot" ? null : playerById(state, creditorId);
  if (creditor) {
    creditor.cash += debtor.cash;
    if (debtor.cash) log(state, `${creditor.name} receives ${debtor.cash} from ${debtor.name}.`, { playerId: creditor.id, amount: debtor.cash });
  } else if (creditorId === "pot") {
    state.pot += debtor.cash;
  }
  debtor.cash = 0;
  let interest = 0;
  for (const [key, deed] of Object.entries(state.deeds)) {
    if (deed.ownerId !== debtor.id) continue;
    const index = Number(key);
    if (!creditor) {
      deed.ownerId = null;
      deed.mortgaged = false;
      deed.houses = 0;
    } else {
      deed.ownerId = creditor.id;
      const space = spaceAt(index);
      if (deed.mortgaged && isDeed(space)) interest += Math.round(mortgageValue(space) * state.rules.mortgageRate);
    }
  }
  if (creditor) creditor.jailCards.push(...debtor.jailCards);
  else {
    for (const cardId of debtor.jailCards) discardCard(state, cardById(cardId));
  }
  debtor.jailCards = [];
  debtor.bankrupt = true;
  debtor.inJail = false;
  log(state, `${debtor.name} is bankrupt and leaves the harbor.`, { playerId: debtor.id });
  if (state.auction) {
    if (!state.auction.passed.includes(debtor.id)) state.auction.passed.push(debtor.id);
    if (state.auction.highBidderId === debtor.id) {
      state.auction.highBid = 0;
      state.auction.highBidderId = null;
      state.auction.passed = state.auction.passed.filter((id) => playerById(state, id).bankrupt);
      state.auction.passed.push(debtor.id);
    }
    if (state.phase === "auction") settleAuction(state);
  }
  if (state.trade && (state.trade.fromId === debtor.id || state.trade.toId === debtor.id)) {
    state.trade = null;
    if (state.phase === "trade") restorePhase(state);
  }
  if (creditor && interest > 0) {
    if (creditor.cash >= interest) {
      creditor.cash -= interest;
      log(state, `${creditor.name} pays ${interest} interest on mortgaged deeds.`, { playerId: creditor.id, amount: -interest });
    } else {
      setDebt(state, {
        debtorId: creditor.id,
        parts: [{ creditorId: "bank", amount: interest }],
        reason: "interest on deeds taken in bankruptcy",
        resume: { type: "noop" },
      });
    }
  }
}

function forceLiquidate(state: GameState, player: Player) {
  for (const index of ownedIndices(state, player.id)) {
    const deed = state.deeds[index]!;
    if (deed.houses <= 0) continue;
    const space = spaceAt(index);
    if (space.kind !== "street") continue;
    const refund = Math.floor((deed.houses * space.house) / 2);
    if (deed.houses === 5) state.hotelsLeft += 1;
    else state.housesLeft += deed.houses;
    deed.houses = 0;
    player.cash += refund;
    log(state, `${player.name} liquidates buildings on ${space.name} for ${refund}.`, { playerId: player.id, amount: refund });
  }
}

function canRaise(state: GameState, playerId: string): boolean {
  for (const index of ownedIndices(state, playerId)) {
    if (!canSell(state, playerId, index)) return true;
    if (!canMortgage(state, playerId, index)) return true;
  }
  return false;
}

function advanceSeat(state: GameState) {
  if (checkSolo(state)) return;
  const prev = state.current;
  const n = state.players.length;
  let next = prev;
  for (let k = 0; k < n; k++) {
    next = (next + 1) % n;
    if (!state.players[next]!.bankrupt) break;
  }
  if (state.players[next]!.bankrupt) {
    checkSolo(state);
    return;
  }
  const wrapped = next <= prev;
  state.current = next;
  state.turnCount += 1;
  state.offersThisTurn = 0;
  state.cardChain = 0;
  state.dice = null;
  state.lastMove = null;
  state.purchaseIndex = null;
  state.revealedCard = null;
  state.pendingExtraRoll = false;
  state.suppressExtra = false;
  state.players[next]!.doublesStreak = 0;
  if (wrapped) state.round += 1;
  if (state.rules.roundLimit && state.round > state.rules.roundLimit) {
    finishByNetWorth(state, "The round limit is up. Highest net worth takes the harbor.");
    return;
  }
  if (state.round > state.rules.safetyRounds) {
    finishByNetWorth(state, "The harbor calls a truce. Highest net worth wins.");
    return;
  }
  const player = state.players[next]!;
  state.phase = player.inJail ? "jail" : "pre_roll";
  state.mustRoll = !player.inJail;
  log(state, `Turn passes to ${player.name}.`, { playerId: player.id });
}

function checkSolo(state: GameState): boolean {
  const living = alive(state);
  if (living.length > 1) return false;
  state.gameOver = true;
  state.phase = "game_over";
  state.mustRoll = false;
  state.winnerId = living[0]?.id ?? null;
  state.endReason = living[0] ? `${living[0].name} is the last owner standing.` : "No owners remain.";
  if (living[0]) log(state, state.endReason, { playerId: living[0].id });
  return true;
}

function finishByNetWorth(state: GameState, reason: string) {
  const ranked = standings(state).filter((row) => !row.bankrupt);
  state.gameOver = true;
  state.phase = "game_over";
  state.mustRoll = false;
  state.winnerId = ranked[0]?.id ?? null;
  state.endReason = reason;
  log(state, reason, { playerId: state.winnerId });
}

function drawFrom(state: GameState, deck: "tide" | "city"): string {
  const draw = deck === "tide" ? state.tideDraw : state.cityDraw;
  if (draw.length === 0) {
    const discard = deck === "tide" ? state.tideDiscard : state.cityDiscard;
    if (discard.length === 0) throw new ActionError("That ledger is empty");
    const shuffled = shuffleInPlace(state, discard);
    if (deck === "tide") {
      state.tideDraw = shuffled;
      state.tideDiscard = [];
    } else {
      state.cityDraw = shuffled;
      state.cityDiscard = [];
    }
  }
  const pile = deck === "tide" ? state.tideDraw : state.cityDraw;
  const id = pile.shift();
  if (!id) throw new ActionError("That ledger is empty");
  return id;
}

function discardCard(state: GameState, card: CardDef) {
  if (card.deck === "tide") state.tideDiscard.push(card.id);
  else state.cityDiscard.push(card.id);
}

function nearestForward(from: number, targets: number[]): { index: number; steps: number } {
  let best = targets[0] ?? from;
  let bestSteps = 99;
  for (const target of targets) {
    let steps = (target - from + 40) % 40;
    if (steps === 0) steps = 40;
    if (steps < bestSteps) {
      bestSteps = steps;
      best = target;
    }
  }
  return { index: best, steps: bestSteps };
}

function fullSet(state: GameState, group: Street["group"], playerId: string): boolean {
  return groupIndices(group).every((index) => state.deeds[index]?.ownerId === playerId);
}

function groupMortgaged(state: GameState, group: Street["group"]): boolean {
  return groupIndices(group).some((index) => state.deeds[index]?.mortgaged);
}

function minHouses(state: GameState, group: Street["group"]): number {
  return Math.min(...groupIndices(group).map((index) => state.deeds[index]?.houses ?? 0));
}

function maxHouses(state: GameState, group: Street["group"]): number {
  return Math.max(...groupIndices(group).map((index) => state.deeds[index]?.houses ?? 0));
}

function sanitizeTrade(
  state: GameState,
  from: Player,
  to: Player,
  action: Extract<Action, { type: "PROPOSE" }>,
  hops: number,
): Trade {
  const offerProperties = uniqueSorted(action.offerProperties);
  const requestProperties = uniqueSorted(action.requestProperties);
  if (offerProperties.some((index) => requestProperties.includes(index))) {
    throw new ActionError("A deed cannot be on both sides of a trade");
  }
  for (const index of offerProperties) assertTradable(state, from.id, index);
  for (const index of requestProperties) assertTradable(state, to.id, index);
  if (!Number.isInteger(action.offerCash) || action.offerCash < 0) throw new ActionError("Invalid cash offer");
  if (!Number.isInteger(action.requestCash) || action.requestCash < 0) throw new ActionError("Invalid cash request");
  if (action.offerCash > from.cash) throw new ActionError("The offer spends cash you do not have");
  if (action.requestCash > to.cash) throw new ActionError("The request asks for cash they do not have");
  const offerCards = uniqueStrings(action.offerCards);
  const requestCards = uniqueStrings(action.requestCards);
  if (!subset(offerCards, from.jailCards)) throw new ActionError("You offered a key you do not hold");
  if (!subset(requestCards, to.jailCards)) throw new ActionError("You requested a key they do not hold");
  if (
    offerProperties.length + requestProperties.length + offerCards.length + requestCards.length === 0 &&
    action.offerCash === 0 &&
    action.requestCash === 0
  ) {
    throw new ActionError("An empty trade does nothing");
  }
  const trade: Trade = {
    fromId: from.id,
    toId: to.id,
    offerProperties,
    offerCash: action.offerCash,
    offerCards,
    requestProperties,
    requestCash: action.requestCash,
    requestCards,
    hops,
  };
  assertTradeFunds(state, from, to, trade);
  return trade;
}

function assertTradable(state: GameState, ownerId: string, index: number) {
  const deed = state.deeds[index];
  const space = spaceAt(index);
  if (!deed || !isDeed(space)) throw new ActionError("That is not a tradable deed");
  if (deed.ownerId !== ownerId) throw new ActionError(`${space.name} is not owned by that side`);
  if (deed.houses > 0) throw new ActionError(`Sell the buildings on ${space.name} before trading it`);
}

function assertTradeFunds(state: GameState, from: Player, to: Player, trade: Trade) {
  const fromInterest = interestOn(state, trade.requestProperties);
  const toInterest = interestOn(state, trade.offerProperties);
  const fromCash = from.cash - trade.offerCash + trade.requestCash;
  const toCash = to.cash - trade.requestCash + trade.offerCash;
  if (fromCash < fromInterest) throw new ActionError(`${from.name} cannot pay mortgage interest on the deeds they would receive`);
  if (toCash < toInterest) throw new ActionError(`${to.name} cannot pay mortgage interest on the deeds they would receive`);
}

function moveCashAndDeeds(state: GameState, from: Player, to: Player, trade: Trade) {
  const fromInterest = interestOn(state, trade.requestProperties);
  const toInterest = interestOn(state, trade.offerProperties);
  from.cash = from.cash - trade.offerCash + trade.requestCash - fromInterest;
  to.cash = to.cash - trade.requestCash + trade.offerCash - toInterest;
  for (const index of trade.offerProperties) state.deeds[index]!.ownerId = to.id;
  for (const index of trade.requestProperties) state.deeds[index]!.ownerId = from.id;
  from.jailCards = from.jailCards.filter((id) => !trade.offerCards.includes(id));
  to.jailCards = to.jailCards.filter((id) => !trade.requestCards.includes(id));
  from.jailCards.push(...trade.requestCards);
  to.jailCards.push(...trade.offerCards);
  state.trade = null;
}

function interestOn(state: GameState, indices: number[]): number {
  let total = 0;
  for (const index of indices) {
    const deed = state.deeds[index];
    const space = spaceAt(index);
    if (deed?.mortgaged && isDeed(space)) total += Math.round(mortgageValue(space) * state.rules.mortgageRate);
  }
  return total;
}

function restorePhase(state: GameState) {
  const phase = state.phaseBeforeTrade ?? "manage";
  state.phaseBeforeTrade = null;
  state.trade = null;
  if (phase === "purchase" && state.purchaseIndex == null) state.phase = "manage";
  else if (phase === "card" && !state.revealedCard) state.phase = "manage";
  else state.phase = phase;
}

function mainCreditor(debt: Debt): string {
  let best = debt.parts[0]?.creditorId ?? "bank";
  let amount = -1;
  for (const part of debt.parts) {
    if (part.amount > amount) {
      amount = part.amount;
      best = part.creditorId;
    }
  }
  return best;
}

function alive(state: GameState): Player[] {
  return state.players.filter((p) => !p.bankrupt);
}

function current(state: GameState): Player {
  const player = state.players[state.current];
  if (!player) throw new ActionError("No current owner");
  return player;
}

function playerById(state: GameState, id: string): Player {
  const player = state.players.find((p) => p.id === id);
  if (!player) throw new ActionError("Unknown owner");
  return player;
}

function log(state: GameState, message: string, extra?: { playerId?: string; amount?: number }) {
  state.logSeq += 1;
  state.log.push({
    id: state.logSeq,
    turn: state.turnCount,
    message,
    playerId: extra?.playerId ?? null,
    amount: extra?.amount ?? null,
  });
  if (state.log.length > 500) state.log.splice(0, state.log.length - 500);
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function subset(needles: string[], hay: string[]): boolean {
  const pool = hay.slice();
  for (const needle of needles) {
    const index = pool.indexOf(needle);
    if (index < 0) return false;
    pool.splice(index, 1);
  }
  return true;
}

export function playerLabel(difficulty: Difficulty, personality: Personality): string {
  return `${difficulty} ${personality}`;
}

export type { GameMode };
