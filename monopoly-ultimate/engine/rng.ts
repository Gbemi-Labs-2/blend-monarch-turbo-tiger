import type { GameState } from "./types.ts";

/** Mulberry32 step. Returns the next unit float and the next uint seed. */
export function nextRng(state: { s: number }): { state: { s: number }; value: number } {
  let a = state.s >>> 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: { s: a >>> 0 }, value };
}

export function drawUnit(state: GameState): number {
  const r = nextRng(state.rng);
  state.rng = r.state;
  return r.value;
}

export function drawDie(state: GameState): number {
  if (state.diceQueue.length > 0) {
    const n = state.diceQueue.shift();
    if (n === undefined || n < 1 || n > 6) throw new Error("Bad dice queue value");
    return n;
  }
  return 1 + Math.floor(drawUnit(state) * 6);
}

export function shuffleInPlace(state: GameState, items: string[]): string[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(drawUnit(state) * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}
