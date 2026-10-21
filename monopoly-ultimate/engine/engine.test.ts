import assert from "node:assert/strict";
import test from "node:test";
import { chooseAiAction, playUntilDone, wantsPurchase } from "./ai.ts";
import { BOARD } from "./board.ts";
import { cardById } from "./cards.ts";
import { createGame, dispatch, invariantErrors, netWorth } from "./logic.ts";
import { importGame, exportGame } from "./persist.ts";
import type { Action, GameState, PlayerSetup } from "./types.ts";

const seats = (humans = true): PlayerSetup[] => [
  { name: "Ada", human: humans, token: "heron", difficulty: "normal", personality: "balanced" },
  { name: "Bea", human: false, token: "fox", difficulty: "hard", personality: "collector" },
];

function boot(extra?: Partial<Parameters<typeof createGame>[0]>): GameState {
  return createGame({ players: seats(), seed: 11, diceQueue: [], ...extra });
}

function play(state: GameState, action: Action): GameState {
  const result = dispatch(state, action);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

test("board is a 40-space harbor", () => {
  assert.equal(BOARD.length, 40);
  assert.equal(BOARD[0]?.kind, "go");
  assert.equal(BOARD[10]?.kind, "jail");
  assert.equal(BOARD[20]?.kind, "free");
  assert.equal(BOARD[30]?.kind, "gotojail");
  assert.equal(new Set(BOARD.map((s) => s.index)).size, 40);
});

test("passing Harbor Gate pays salary once, then a deed can be bought", () => {
  let state = boot({ diceQueue: [1, 1] });
  state.players[0]!.position = 39;
  state = play(state, { type: "ROLL" });
  assert.equal(state.players[0]!.position, 1);
  assert.equal(state.players[0]!.cash, 1700);
  assert.equal(state.phase, "purchase");
  state = play(state, { type: "BUY" });
  assert.equal(state.deeds[1]!.ownerId, "p1");
  assert.equal(state.players[0]!.cash, 1640);
  assert.equal(invariantErrors(state).length, 0);
});

test("rent is paid to the owner, and a full ward doubles undeveloped rent", () => {
  let state = boot({ diceQueue: [1, 1] });
  state.players[0]!.position = 39;
  state.deeds[1]!.ownerId = "p2";
  state = play(state, { type: "ROLL" });
  assert.equal(state.players[0]!.cash, 1698);
  assert.equal(state.players[1]!.cash, 1502);

  let doubled = boot({ diceQueue: [1, 1] });
  doubled.players[0]!.position = 39;
  doubled.deeds[1]!.ownerId = "p2";
  doubled.deeds[3]!.ownerId = "p2";
  doubled = play(doubled, { type: "ROLL" });
  assert.equal(doubled.players[0]!.cash, 1696);
  assert.equal(doubled.players[1]!.cash, 1504);
});

test("declining a purchase auctions the deed to the highest remaining bidder", () => {
  let state = boot({ diceQueue: [1, 1] });
  state.players[0]!.position = 39;
  state = play(state, { type: "ROLL" });
  state = play(state, { type: "DECLINE" });
  assert.equal(state.phase, "auction");
  state = play(state, { type: "BID", amount: 10 });
  state = play(state, { type: "BID", amount: 30 });
  state = play(state, { type: "PASS" });
  assert.equal(state.deeds[1]!.ownerId, "p2");
  assert.equal(state.players[1]!.cash, 1470);
  assert.equal(state.auction, null);
});

test("an auction with no bids leaves the deed unclaimed", () => {
  let state = boot({ diceQueue: [1, 1] });
  state.players[0]!.position = 39;
  state = play(state, { type: "ROLL" });
  state = play(state, { type: "DECLINE" });
  state = play(state, { type: "PASS" });
  state = play(state, { type: "PASS" });
  assert.equal(state.deeds[1]!.ownerId, null);
  assert.equal(state.phase === "pre_roll" || state.phase === "manage", true);
});

test("three doubles in one turn send the owner to the Lockup before the third move", () => {
  let state = boot({ diceQueue: [1, 1, 1, 1, 1, 1] });
  state.players[0]!.position = 19;
  for (const index of [21, 23, 25]) state.deeds[index]!.ownerId = "p1";
  state = play(state, { type: "ROLL" });
  assert.equal(state.players[0]!.position, 21);
  assert.equal(state.phase, "pre_roll");
  state = play(state, { type: "ROLL" });
  assert.equal(state.players[0]!.position, 23);
  state = play(state, { type: "ROLL" });
  assert.equal(state.players[0]!.position, 10);
  assert.equal(state.players[0]!.inJail, true);
  assert.equal(state.phase, "manage");
  assert.notEqual(state.phase, "pre_roll");
});

test("Lockup options: fine, key, doubles, and a forced fine on the third miss", () => {
  let fine = boot();
  fine.players[0]!.inJail = true;
  fine.phase = "jail";
  fine.mustRoll = false;
  fine = play(fine, { type: "PAY_FINE" });
  assert.equal(fine.players[0]!.cash, 1450);
  assert.equal(fine.players[0]!.inJail, false);
  assert.equal(fine.phase, "pre_roll");

  let key = boot();
  key.players[0]!.inJail = true;
  key.phase = "jail";
  key.mustRoll = false;
  key.players[0]!.jailCards = ["t9"];
  key.tideDraw = key.tideDraw.filter((id) => id !== "t9");
  key = play(key, { type: "USE_CARD" });
  assert.equal(key.players[0]!.inJail, false);
  assert.ok(key.tideDiscard.includes("t9"));

  let doubled = boot({ diceQueue: [3, 3] });
  doubled.players[0]!.inJail = true;
  doubled.players[0]!.position = 10;
  doubled.phase = "jail";
  doubled.mustRoll = false;
  doubled = play(doubled, { type: "ROLL_JAIL" });
  assert.equal(doubled.players[0]!.position, 16);
  assert.equal(doubled.players[0]!.inJail, false);
  assert.notEqual(doubled.phase, "pre_roll");

  let third = boot({ diceQueue: [1, 2] });
  third.players[0]!.inJail = true;
  third.players[0]!.position = 10;
  third.players[0]!.jailTurns = 2;
  third.phase = "jail";
  third.mustRoll = false;
  third = play(third, { type: "ROLL_JAIL" });
  assert.equal(third.players[0]!.inJail, false);
  assert.equal(third.players[0]!.position, 13);
  assert.equal(third.players[0]!.cash, 1450);
});

test("development is even, mortgaging is blocked by buildings, and rent stops", () => {
  let state = boot();
  state.deeds[1]!.ownerId = "p1";
  state.deeds[3]!.ownerId = "p1";
  state = play(state, { type: "BUILD", index: 1 });
  assert.equal(state.deeds[1]!.houses, 1);
  assert.equal(state.players[0]!.cash, 1450);
  const uneven = dispatch(state, { type: "BUILD", index: 1 });
  assert.equal(uneven.ok, false);
  state = play(state, { type: "BUILD", index: 3 });
  const mortgaged = dispatch(state, { type: "MORTGAGE", index: 1 });
  assert.equal(mortgaged.ok, false);
  state = play(state, { type: "SELL", index: 1 });
  state = play(state, { type: "SELL", index: 3 });
  state = play(state, { type: "MORTGAGE", index: 1 });
  assert.equal(state.deeds[1]!.mortgaged, true);
  assert.equal(state.players[0]!.cash, 1480);

  let visitor = boot({ diceQueue: [1, 1] });
  visitor.players[0]!.position = 39;
  visitor.deeds[1] = { ownerId: "p2", mortgaged: true, houses: 0 };
  visitor.deeds[3]!.ownerId = "p2";
  const before = visitor.players[1]!.cash;
  visitor = play(visitor, { type: "ROLL" });
  assert.equal(visitor.players[1]!.cash, before);
});

test("ferries and utilities use their own rent schedules", () => {
  let ferry = boot({ diceQueue: [1, 1] });
  ferry.players[0]!.position = 3;
  ferry.deeds[5]!.ownerId = "p2";
  ferry = play(ferry, { type: "ROLL" });
  assert.equal(ferry.players[0]!.cash, 1475);
  assert.equal(ferry.players[1]!.cash, 1525);

  let works = boot({ diceQueue: [1, 1] });
  works.players[0]!.position = 10;
  works.deeds[12]!.ownerId = "p2";
  works.deeds[28]!.ownerId = "p2";
  works = play(works, { type: "ROLL" });
  assert.equal(works.players[0]!.position, 12);
  assert.equal(works.players[0]!.cash, 1480);
});

test("taxes, visiting, and being sent to the Lockup", () => {
  let tax = boot({ diceQueue: [1, 3] });
  tax = play(tax, { type: "ROLL" });
  assert.equal(tax.players[0]!.position, 4);
  assert.equal(tax.players[0]!.cash, 1300);

  let visit = boot({ diceQueue: [2, 3] });
  visit.players[0]!.position = 5;
  visit = play(visit, { type: "ROLL" });
  assert.equal(visit.players[0]!.position, 10);
  assert.equal(visit.players[0]!.inJail, false);

  let sent = boot({ diceQueue: [1, 1] });
  sent.players[0]!.position = 28;
  sent.deeds[28]!.ownerId = "p1";
  sent = play(sent, { type: "ROLL" });
  assert.equal(sent.players[0]!.position, 10);
  assert.equal(sent.players[0]!.inJail, true);
  assert.equal(sent.phase, "manage");
});

test("tide and city notices change cash, movement, and jail", () => {
  let dividend = boot({ diceQueue: [1, 1] });
  dividend.tideDraw = ["t12", ...dividend.tideDraw.filter((id) => id !== "t12")];
  dividend = play(dividend, { type: "ROLL" });
  assert.equal(dividend.phase, "card");
  assert.equal(cardById(dividend.revealedCard ?? "").title, "Dividend");
  dividend = play(dividend, { type: "ACK" });
  assert.equal(dividend.players[0]!.cash, 1550);

  let detained = boot({ diceQueue: [1, 1] });
  detained.tideDraw = ["t8", ...detained.tideDraw.filter((id) => id !== "t8")];
  detained = play(detained, { type: "ROLL" });
  detained = play(detained, { type: "ACK" });
  assert.equal(detained.players[0]!.inJail, true);
  assert.equal(detained.players[0]!.position, 10);
  assert.equal(detained.players[0]!.cash, 1500);

  let back = boot({ diceQueue: [1, 1] });
  back.tideDraw = ["t7", ...back.tideDraw.filter((id) => id !== "t7")];
  back = play(back, { type: "ROLL" });
  back = play(back, { type: "ACK" });
  assert.equal(back.players[0]!.position, 39);
  assert.equal(back.phase, "purchase");
});

test("empty ledgers reshuffle before the next draw", () => {
  let state = boot({ diceQueue: [1, 1] });
  state.tideDraw = [];
  state.tideDiscard = ["t12"];
  state = play(state, { type: "ROLL" });
  assert.equal(state.revealedCard, "t12");
});

test("bankruptcy transfers the estate and ends a two-owner match", () => {
  let state = boot({ diceQueue: [1, 1], rules: { goSalary: 0 } });
  state.players[0]!.position = 39;
  state.players[0]!.cash = 0;
  state.deeds[1]!.ownerId = "p2";
  state = play(state, { type: "ROLL" });
  assert.equal(state.phase, "debt");
  state = play(state, { type: "BANKRUPT" });
  assert.equal(state.players[0]!.bankrupt, true);
  assert.equal(state.players[0]!.cash, 0);
  assert.equal(state.gameOver, true);
  assert.equal(state.winnerId, "p2");
});

test("trades move deeds and cash, and illegal offers are refused", () => {
  let state = boot();
  state.deeds[1]!.ownerId = "p1";
  state.deeds[6]!.ownerId = "p2";
  state = play(state, {
    type: "PROPOSE",
    toId: "p2",
    offerProperties: [1],
    offerCash: 40,
    offerCards: [],
    requestProperties: [6],
    requestCash: 10,
    requestCards: [],
  });
  assert.equal(state.phase, "trade");
  state = play(state, { type: "ACCEPT" });
  assert.equal(state.deeds[1]!.ownerId, "p2");
  assert.equal(state.deeds[6]!.ownerId, "p1");
  assert.equal(state.players[0]!.cash, 1470);
  assert.equal(state.players[1]!.cash, 1530);

  const owned = boot();
  const bad = dispatch(owned, {
    type: "PROPOSE",
    toId: "p2",
    offerProperties: [1],
    offerCash: 0,
    offerCards: [],
    requestProperties: [],
    requestCash: 0,
    requestCards: [],
  });
  assert.equal(bad.ok, false);
});

test("illegal actions do not move money", () => {
  const state = boot();
  const cash = state.players[0]!.cash;
  assert.equal(dispatch(state, { type: "END_TURN" }).ok, false);
  assert.equal(dispatch(state, { type: "BUY" }).ok, false);
  assert.equal(dispatch(state, { type: "BID", amount: 5 }).ok, false);
  assert.equal(state.players[0]!.cash, cash);
});

test("saves round-trip and reject a damaged file", () => {
  const state = boot();
  state.players[0]!.cash = 1333;
  const raw = exportGame(state);
  const loaded = importGame(raw);
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.equal(loaded.state.players[0]!.cash, 1333);
  assert.equal(importGame("{").ok, false);
  assert.equal(importGame(JSON.stringify({ version: 99 })).ok, false);
});

test("Free Plaza can collect the fee pot", () => {
  let state = boot({ diceQueue: [1, 1], rules: { freeParkingPot: true } });
  state.players[0]!.position = 18;
  state.pot = 80;
  state.deeds[18]!.ownerId = "p1";
  state = play(state, { type: "ROLL" });
  assert.equal(state.players[0]!.position, 20);
  assert.equal(state.players[0]!.cash, 1580);
  assert.equal(state.pot, 0);
});

test("hotels return houses to the bank and keep the supply invariant", () => {
  let state = boot();
  state.players[0]!.cash = 5000;
  state.deeds[1]!.ownerId = "p1";
  state.deeds[3]!.ownerId = "p1";
  const order = [1, 3, 1, 3, 1, 3, 1, 3, 1, 3];
  for (const index of order) state = play(state, { type: "BUILD", index });
  assert.equal(state.deeds[1]!.houses, 5);
  assert.equal(state.deeds[3]!.houses, 5);
  assert.equal(state.housesLeft, 32);
  assert.equal(state.hotelsLeft, 10);
  assert.deepEqual(invariantErrors(state), []);
  state = play(state, { type: "SELL", index: 1 });
  assert.equal(state.deeds[1]!.houses, 4);
  const skip = dispatch(state, { type: "SELL", index: 1 });
  assert.equal(skip.ok, false);
});

test("difficulty changes purchase judgment on the same deed", () => {
  const state = boot();
  state.players[0]!.cash = 500;
  state.players[0]!.difficulty = "easy";
  state.players[0]!.personality = "banker";
  const easy = wantsPurchase(state, state.players[0]!, 16, 180);
  assert.equal(easy.buy, false);

  state.players[1]!.cash = 500;
  state.players[1]!.difficulty = "normal";
  state.players[1]!.personality = "balanced";
  const normal = wantsPurchase(state, state.players[1]!, 16, 180);
  assert.equal(normal.buy, true);

  state.players[1]!.difficulty = "expert";
  state.players[1]!.personality = "collector";
  state.players[1]!.cash = 400;
  state.deeds[23]!.ownerId = "p2";
  state.deeds[24]!.ownerId = "p2";
  const expert = wantsPurchase(state, state.players[1]!, 21, 220);
  assert.equal(expert.buy, true);
  assert.match(expert.reason, /ward/i);
});

test("AI matches finish with consistent books", () => {
  const lineup: PlayerSetup[] = [
    { name: "Ivy", human: false, token: "heron", difficulty: "easy", personality: "banker" },
    { name: "Nico", human: false, token: "lantern", difficulty: "normal", personality: "trader" },
    { name: "Hale", human: false, token: "ferry", difficulty: "hard", personality: "aggressive" },
    { name: "Quill", human: false, token: "key", difficulty: "expert", personality: "collector" },
  ];
  for (const seed of [4, 19, 42, 77]) {
    const start = createGame({ players: lineup, seed, rules: { roundLimit: 8 }, mode: "tournament" });
    const played = playUntilDone(start, 7000);
    assert.equal(played.state.gameOver, true, `seed ${seed} steps ${played.steps}`);
    assert.ok(played.state.winnerId);
    assert.deepEqual(invariantErrors(played.state), []);
    for (const player of played.state.players) {
      assert.ok(player.cash >= 0);
      assert.ok(netWorth(played.state, player.id) >= 0 || player.bankrupt);
    }
    const alive = played.state.players.filter((p) => !p.bankrupt);
    assert.ok(alive.length >= 1);
  }
});

test("chooseAiAction stays legal across a mixed turn", () => {
  let state = createGame({
    players: [
      { name: "Ada", human: false, token: "heron", difficulty: "expert", personality: "balanced" },
      { name: "Bea", human: false, token: "fox", difficulty: "easy", personality: "risk" },
    ],
    seed: 9,
    diceQueue: [1, 3, 2, 2, 5, 1],
  });
  for (let i = 0; i < 8 && !state.gameOver; i++) {
    const choice = chooseAiAction(state);
    state = play(state, choice.action);
  }
  assert.equal(invariantErrors(state).length, 0);
});
