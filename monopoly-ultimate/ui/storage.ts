import type { CreateConfig, GameState } from "../engine/index.ts";

export type Prefs = {
  theme: "night" | "day";
  contrast: boolean;
  colorblind: boolean;
  scale: "sm" | "md" | "lg";
  reducedMotion: boolean;
  muted: boolean;
  master: number;
  music: number;
  sfx: number;
  fastAi: boolean;
  explainAi: boolean;
  handoff: boolean;
  seenIntro: boolean;
};

export type HistoryRow = {
  id: string;
  at: number;
  winner: string;
  players: string;
  rounds: number;
  reason: string;
};

const PREF = "aurelia.prefs.v1";
const SAVE = "aurelia.save.v1";
const HIST = "aurelia.history.v1";
const TOUR = "aurelia.tourney.v1";

export const DEFAULT_PREFS: Prefs = {
  theme: "night",
  contrast: false,
  colorblind: false,
  scale: "md",
  reducedMotion: false,
  muted: false,
  master: 0.7,
  music: 0.25,
  sfx: 0.8,
  fastAi: false,
  explainAi: true,
  handoff: true,
  seenIntro: false,
};

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs) {
  localStorage.setItem(PREF, JSON.stringify(prefs));
}

export type SaveFile = { state: GameState; setup: CreateConfig };

export function loadSave(): SaveFile | null {
  try {
    const raw = localStorage.getItem(SAVE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveFile;
    if (!parsed?.state || !parsed.setup) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSave(file: SaveFile | null) {
  if (!file) localStorage.removeItem(SAVE);
  else localStorage.setItem(SAVE, JSON.stringify(file));
}

export function loadHistory(): HistoryRow[] {
  try {
    const raw = localStorage.getItem(HIST);
    return raw ? (JSON.parse(raw) as HistoryRow[]) : [];
  } catch {
    return [];
  }
}

export function pushHistory(row: HistoryRow) {
  const all = [row, ...loadHistory()].slice(0, 30);
  localStorage.setItem(HIST, JSON.stringify(all));
}

export type TourneyRow = { name: string; wins: number; matches: number; net: number };

export function loadTourney(): TourneyRow[] {
  try {
    const raw = localStorage.getItem(TOUR);
    return raw ? (JSON.parse(raw) as TourneyRow[]) : [];
  } catch {
    return [];
  }
}

export function saveTourney(rows: TourneyRow[]) {
  localStorage.setItem(TOUR, JSON.stringify(rows));
}
