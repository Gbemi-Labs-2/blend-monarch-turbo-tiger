import { BOARD, isDeed } from "./board.ts";
import { SAVE_VERSION, type GameState, type Phase, type Rules } from "./types.ts";

const PHASES: Phase[] = ["pre_roll", "jail", "purchase", "auction", "card", "debt", "trade", "manage", "game_over"];

export function exportGame(state: GameState): string {
  return JSON.stringify(state);
}

export function importGame(raw: string): { ok: true; state: GameState } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }
  if (!data || typeof data !== "object") return { ok: false, error: "Save data is empty." };
  const state = data as GameState;
  if (state.version !== SAVE_VERSION) return { ok: false, error: "This save is from a different edition of Aurelia." };
  if (!Array.isArray(state.players) || state.players.length < 2 || state.players.length > 6) {
    return { ok: false, error: "The save has an impossible owner list." };
  }
  if (!PHASES.includes(state.phase)) return { ok: false, error: "The save has an unknown turn phase." };
  if (!state.rules || typeof state.rules.startingCash !== "number") return { ok: false, error: "The save is missing its rules." };
  const deeds: GameState["deeds"] = {};
  const source = state.deeds ?? {};
  for (const space of BOARD) {
    if (!isDeed(space)) continue;
    const deed = (source as Record<string, GameState["deeds"][number]>)[space.index] ?? (source as Record<string, GameState["deeds"][number]>)[String(space.index)];
    if (!deed || typeof deed.houses !== "number" || typeof deed.mortgaged !== "boolean") {
      return { ok: false, error: `Deed ${space.name} is missing from the save.` };
    }
    deeds[space.index] = {
      ownerId: deed.ownerId ?? null,
      mortgaged: deed.mortgaged,
      houses: deed.houses,
    };
  }
  for (const player of state.players) {
    if (typeof player.cash !== "number" || typeof player.position !== "number" || typeof player.id !== "string") {
      return { ok: false, error: "An owner record is damaged." };
    }
    if (player.position < 0 || player.position > 39) return { ok: false, error: `${player.name} stands off the board.` };
  }
  state.deeds = deeds;
  state.diceQueue = Array.isArray(state.diceQueue) ? state.diceQueue : [];
  state.log = Array.isArray(state.log) ? state.log : [];
  state.debtQueue = Array.isArray(state.debtQueue) ? state.debtQueue : [];
  if (!state.rng || typeof state.rng.s !== "number") return { ok: false, error: "The save is missing its random state." };
  return { ok: true, state };
}

export function logToCsv(state: GameState): string {
  const lines = ["id,turn,playerId,amount,message"];
  for (const entry of state.log) {
    const message = `"${entry.message.replaceAll('"', '""')}"`;
    lines.push([entry.id, entry.turn, entry.playerId ?? "", entry.amount ?? "", message].join(","));
  }
  return lines.join("\n");
}

export function rulesSummary(rules: Rules): string {
  const rounds = rules.roundLimit ? `${rules.roundLimit} rounds` : "last owner standing";
  return [
    `Starting cash ${rules.startingCash}`,
    `Harbor Gate ${rules.goSalary}`,
    `Lockup fine ${rules.jailFine}`,
    rules.auctions ? "Auctions on" : "Auctions off",
    rules.trading ? "Trading on" : "Trading off",
    rules.freeParkingPot ? "Free Plaza collects fees" : "Free Plaza pays nothing",
    rules.evenBuild ? "Even building" : "Free building",
    `Victory: ${rounds}`,
  ].join(" · ");
}
