export const SAVE_VERSION = 1 as const;

export type Difficulty = "easy" | "normal" | "hard" | "expert";
export type Personality = "aggressive" | "banker" | "trader" | "collector" | "risk" | "balanced";
export type TokenId = "heron" | "lantern" | "ferry" | "key" | "compass" | "crown" | "anchor" | "fox";
export type GroupId = "cocoa" | "tide" | "rose" | "cedar" | "garnet" | "solar" | "jade" | "crown";
export type DeckId = "tide" | "city";
export type GameMode = "solo" | "hotseat" | "tournament" | "custom";

export type Phase =
  | "pre_roll"
  | "jail"
  | "purchase"
  | "auction"
  | "card"
  | "debt"
  | "trade"
  | "manage"
  | "game_over";

export type Rules = {
  startingCash: number;
  goSalary: number;
  jailFine: number;
  maxJailRolls: number;
  doublesToJail: boolean;
  freeParkingPot: boolean;
  auctions: boolean;
  trading: boolean;
  evenBuild: boolean;
  houseSupply: number;
  hotelSupply: number;
  mortgageRate: number;
  /** Completed rounds (every seat has played) before highest net worth wins. Null = last standing only. */
  roundLimit: number | null;
  safetyRounds: number;
  auctionIncrement: number;
  minBid: number;
};

export type Player = {
  id: string;
  name: string;
  human: boolean;
  token: TokenId;
  difficulty: Difficulty;
  personality: Personality;
  cash: number;
  position: number;
  inJail: boolean;
  jailTurns: number;
  jailCards: string[];
  bankrupt: boolean;
  doublesStreak: number;
};

export type Deed = {
  ownerId: string | null;
  mortgaged: boolean;
  houses: number;
};

export type Auction = {
  propertyIndex: number;
  order: string[];
  highBid: number;
  highBidderId: string | null;
  passed: string[];
  turnId: string;
  bids: { playerId: string; amount: number }[];
};

export type Resume =
  | { type: "finish" }
  | { type: "noop" }
  | { type: "release_to_roll" }
  | { type: "move"; steps: number; awardGo: boolean; rentMultiplier: number; freshDice: boolean; suppressExtra: boolean }
  | { type: "leave_jail_and_move"; steps: number };

export type Debt = {
  debtorId: string;
  parts: { creditorId: string; amount: number }[];
  reason: string;
  resume: Resume;
};

export type Trade = {
  fromId: string;
  toId: string;
  offerProperties: number[];
  offerCash: number;
  offerCards: string[];
  requestProperties: number[];
  requestCash: number;
  requestCards: string[];
  hops: number;
};

export type LogEntry = {
  id: number;
  turn: number;
  message: string;
  playerId: string | null;
  amount: number | null;
};

export type GameState = {
  version: typeof SAVE_VERSION;
  id: string;
  seed: number;
  rng: { s: number };
  rules: Rules;
  players: Player[];
  /** Deed records keyed by board index. */
  deeds: Record<number, Deed>;
  phase: Phase;
  current: number;
  dice: [number, number] | null;
  mustRoll: boolean;
  pendingExtraRoll: boolean;
  diceQueue: number[];
  housesLeft: number;
  hotelsLeft: number;
  pot: number;
  tideDraw: string[];
  tideDiscard: string[];
  cityDraw: string[];
  cityDiscard: string[];
  revealedCard: string | null;
  purchaseIndex: number | null;
  auction: Auction | null;
  debt: Debt | null;
  debtQueue: Debt[];
  trade: Trade | null;
  phaseBeforeTrade: Phase | null;
  rentMultiplier: number;
  freshDice: boolean;
  suppressExtra: boolean;
  log: LogEntry[];
  logSeq: number;
  turnCount: number;
  round: number;
  offersThisTurn: number;
  cardChain: number;
  gameOver: boolean;
  winnerId: string | null;
  endReason: string | null;
  mode: GameMode;
  createdAt: number;
  lastMove: { playerId: string; path: number[] } | null;
};

export type PlayerSetup = {
  name: string;
  human: boolean;
  token: TokenId;
  difficulty?: Difficulty;
  personality?: Personality;
};

export type CreateConfig = {
  players: PlayerSetup[];
  rules?: Partial<Rules>;
  seed?: number;
  diceQueue?: number[];
  mode?: GameMode;
  id?: string;
};

export type Action =
  | { type: "ROLL" }
  | { type: "BUY" }
  | { type: "DECLINE" }
  | { type: "BID"; amount: number }
  | { type: "PASS" }
  | { type: "ACK" }
  | { type: "PAY_FINE" }
  | { type: "USE_CARD" }
  | { type: "ROLL_JAIL" }
  | { type: "BUILD"; index: number }
  | { type: "SELL"; index: number }
  | { type: "MORTGAGE"; index: number }
  | { type: "UNMORTGAGE"; index: number }
  | { type: "END_TURN" }
  | { type: "PAY_DEBT" }
  | { type: "BANKRUPT" }
  | { type: "RESIGN" }
  | {
      type: "PROPOSE";
      toId: string;
      offerProperties: number[];
      offerCash: number;
      offerCards: string[];
      requestProperties: number[];
      requestCash: number;
      requestCards: string[];
    }
  | { type: "ACCEPT" }
  | { type: "REJECT" }
  | { type: "CANCEL_TRADE" }
  | {
      type: "COUNTER";
      offerProperties: number[];
      offerCash: number;
      offerCards: string[];
      requestProperties: number[];
      requestCash: number;
      requestCards: string[];
    };

export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}
