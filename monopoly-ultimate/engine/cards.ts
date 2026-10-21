import type { DeckId } from "./types.ts";

export type CardEffect =
  | { kind: "cash"; amount: number }
  | { kind: "pay_each"; amount: number }
  | { kind: "collect_each"; amount: number }
  | { kind: "move_to"; index: number; awardGo: boolean }
  | { kind: "nearest"; target: "rail" | "utility"; rentMultiplier: number; freshDice: boolean }
  | { kind: "steps"; delta: number }
  | { kind: "jail" }
  | { kind: "jail_card" }
  | { kind: "repairs"; house: number; hotel: number };

export type CardDef = {
  id: string;
  deck: DeckId;
  title: string;
  text: string;
  effect: CardEffect;
};

export const CARDS: CardDef[] = [
  { id: "t1", deck: "tide", title: "Harbor wind", text: "Advance to Harbor Gate. Collect the gate salary.", effect: { kind: "move_to", index: 0, awardGo: true } },
  { id: "t2", deck: "tide", title: "Palace summons", text: "Advance to Palace Reach. Collect the gate salary if you pass Harbor Gate.", effect: { kind: "move_to", index: 39, awardGo: true } },
  { id: "t3", deck: "tide", title: "Ivory opening", text: "Advance to Ivory Wharf. Collect the gate salary if you pass Harbor Gate.", effect: { kind: "move_to", index: 21, awardGo: true } },
  { id: "t4", deck: "tide", title: "Ferry whistle", text: "Advance to the nearest ferry. If it is owned, pay double the usual fare.", effect: { kind: "nearest", target: "rail", rentMultiplier: 2, freshDice: false } },
  { id: "t5", deck: "tide", title: "Second whistle", text: "Advance to the nearest ferry. If it is owned, pay double the usual fare.", effect: { kind: "nearest", target: "rail", rentMultiplier: 2, freshDice: false } },
  { id: "t6", deck: "tide", title: "Works inspection", text: "Advance to the nearest utility. If it is owned, roll the dice and pay ten times the total.", effect: { kind: "nearest", target: "utility", rentMultiplier: 10, freshDice: true } },
  { id: "t7", deck: "tide", title: "Backwash", text: "Go back three spaces.", effect: { kind: "steps", delta: -3 } },
  { id: "t8", deck: "tide", title: "Detained", text: "Go directly to the Lockup. Do not collect the gate salary.", effect: { kind: "jail" } },
  { id: "t9", deck: "tide", title: "Brass key", text: "Keep this key. Use it to leave the Lockup without paying the fine.", effect: { kind: "jail_card" } },
  { id: "t10", deck: "tide", title: "Storm repairs", text: "Pay 25 for each house and 100 for each hotel you own.", effect: { kind: "repairs", house: 25, hotel: 100 } },
  { id: "t11", deck: "tide", title: "Wharf due", text: "Pay a 50 wharf due to the bank.", effect: { kind: "cash", amount: -50 } },
  { id: "t12", deck: "tide", title: "Dividend", text: "The harbor bank pays you a dividend of 50.", effect: { kind: "cash", amount: 50 } },
  { id: "t13", deck: "tide", title: "North passage", text: "Advance to North Ferry. Collect the gate salary if you pass Harbor Gate.", effect: { kind: "move_to", index: 5, awardGo: true } },
  { id: "t14", deck: "tide", title: "Chair of the quay", text: "Pay each other player 50 for the quay festival.", effect: { kind: "pay_each", amount: 50 } },
  { id: "t15", deck: "tide", title: "Loan matures", text: "Your harbor loan matures. Collect 150.", effect: { kind: "cash", amount: 150 } },
  { id: "t16", deck: "tide", title: "Found purse", text: "You find a purse on the promenade. Collect 100.", effect: { kind: "cash", amount: 100 } },
  { id: "c1", deck: "city", title: "Bank error", text: "A bank error is in your favor. Collect 200.", effect: { kind: "cash", amount: 200 } },
  { id: "c2", deck: "city", title: "Physician", text: "Pay the physician's fee of 50.", effect: { kind: "cash", amount: -50 } },
  { id: "c3", deck: "city", title: "Stock sale", text: "From sale of stock you collect 50.", effect: { kind: "cash", amount: 50 } },
  { id: "c4", deck: "city", title: "Civic pardon", text: "Keep this pardon. Use it to leave the Lockup without paying the fine.", effect: { kind: "jail_card" } },
  { id: "c5", deck: "city", title: "Night court", text: "Go directly to the Lockup. Do not collect the gate salary.", effect: { kind: "jail" } },
  { id: "c6", deck: "city", title: "Return to the gate", text: "Advance to Harbor Gate. Collect the gate salary.", effect: { kind: "move_to", index: 0, awardGo: true } },
  { id: "c7", deck: "city", title: "Birthday quay", text: "It is your birthday. Collect 20 from each other player.", effect: { kind: "collect_each", amount: 20 } },
  { id: "c8", deck: "city", title: "Life annuity", text: "A life annuity matures. Collect 100.", effect: { kind: "cash", amount: 100 } },
  { id: "c9", deck: "city", title: "Hospital wing", text: "Pay the hospital fund 100.", effect: { kind: "cash", amount: -100 } },
  { id: "c10", deck: "city", title: "School levy", text: "Pay the school levy of 50.", effect: { kind: "cash", amount: -50 } },
  { id: "c11", deck: "city", title: "Consultancy", text: "Collect 25 for consultancy fees.", effect: { kind: "cash", amount: 25 } },
  { id: "c12", deck: "city", title: "Street assessment", text: "Pay 40 for each house and 115 for each hotel.", effect: { kind: "repairs", house: 40, hotel: 115 } },
  { id: "c13", deck: "city", title: "Inheritance", text: "You inherit a small estate. Collect 100.", effect: { kind: "cash", amount: 100 } },
  { id: "c14", deck: "city", title: "Holiday fund", text: "The holiday fund matures. Collect 100.", effect: { kind: "cash", amount: 100 } },
  { id: "c15", deck: "city", title: "Tax refund", text: "Income-tax refund. Collect 20.", effect: { kind: "cash", amount: 20 } },
  { id: "c16", deck: "city", title: "Opera night", text: "Collect 50 from each other player for opening night.", effect: { kind: "collect_each", amount: 50 } },
];

const BY_ID = new Map(CARDS.map((c) => [c.id, c]));

export function cardById(id: string): CardDef {
  const card = BY_ID.get(id);
  if (!card) throw new Error(`Unknown card ${id}`);
  return card;
}

export function deckIds(deck: DeckId): string[] {
  return CARDS.filter((c) => c.deck === deck).map((c) => c.id);
}
