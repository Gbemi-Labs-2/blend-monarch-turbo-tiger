import type { GroupId } from "./types.ts";

export type Street = {
  index: number;
  kind: "street";
  name: string;
  group: GroupId;
  price: number;
  rent: [number, number, number, number, number, number];
  house: number;
};

export type Rail = { index: number; kind: "rail"; name: string; price: 200 };
export type Utility = { index: number; kind: "utility"; name: string; price: 150 };
export type Tax = { index: number; kind: "tax"; name: string; amount: number };
export type CardSpace = { index: number; kind: "card"; name: string; deck: "tide" | "city" };
export type Simple = { index: number; kind: "go" | "jail" | "free" | "gotojail"; name: string };

export type Space = Street | Rail | Utility | Tax | CardSpace | Simple;

export const GROUP_META: Record<
  GroupId,
  { label: string; swatch: string; pattern: "dots" | "hatch" | "waves" | "grid" | "diag" | "cross" | "vert" | "rings" }
> = {
  cocoa: { label: "Cocoa", swatch: "var(--group-cocoa)", pattern: "dots" },
  tide: { label: "Tideglass", swatch: "var(--group-tide)", pattern: "waves" },
  rose: { label: "Rose", swatch: "var(--group-rose)", pattern: "diag" },
  cedar: { label: "Cedar", swatch: "var(--group-cedar)", pattern: "hatch" },
  garnet: { label: "Garnet", swatch: "var(--group-garnet)", pattern: "vert" },
  solar: { label: "Solar", swatch: "var(--group-solar)", pattern: "grid" },
  jade: { label: "Jade", swatch: "var(--group-jade)", pattern: "cross" },
  crown: { label: "Crown", swatch: "var(--group-crown)", pattern: "rings" },
};

const street = (
  index: number,
  name: string,
  group: GroupId,
  price: number,
  rent: [number, number, number, number, number, number],
  house: number,
): Street => ({ index, kind: "street", name, group, price, rent, house });

export const BOARD: Space[] = [
  { index: 0, kind: "go", name: "Harbor Gate" },
  street(1, "Lantern Lane", "cocoa", 60, [2, 10, 30, 90, 160, 250], 50),
  { index: 2, kind: "card", name: "Tide Ledger", deck: "tide" },
  street(3, "Cobble Court", "cocoa", 60, [4, 20, 60, 180, 320, 450], 50),
  { index: 4, kind: "tax", name: "Harbor Dues", amount: 200 },
  { index: 5, kind: "rail", name: "North Ferry", price: 200 },
  street(6, "Moss Terrace", "tide", 100, [6, 30, 90, 270, 400, 550], 50),
  { index: 7, kind: "card", name: "City Notices", deck: "city" },
  street(8, "Willow Walk", "tide", 100, [6, 30, 90, 270, 400, 550], 50),
  street(9, "Orchid Row", "tide", 120, [8, 40, 100, 300, 450, 600], 50),
  { index: 10, kind: "jail", name: "The Lockup" },
  street(11, "Amber Arcade", "rose", 140, [10, 50, 150, 450, 625, 750], 100),
  { index: 12, kind: "utility", name: "Lumen Works", price: 150 },
  street(13, "Rose Market", "rose", 140, [10, 50, 150, 450, 625, 750], 100),
  street(14, "Velvet Court", "rose", 160, [12, 60, 180, 500, 700, 900], 100),
  { index: 15, kind: "rail", name: "East Ferry", price: 200 },
  street(16, "Cedar Square", "cedar", 180, [14, 70, 200, 550, 750, 950], 100),
  { index: 17, kind: "card", name: "Tide Ledger", deck: "tide" },
  street(18, "Maple Promenade", "cedar", 180, [14, 70, 200, 550, 750, 950], 100),
  street(19, "Saffron Street", "cedar", 200, [16, 80, 220, 600, 800, 1000], 100),
  { index: 20, kind: "free", name: "Free Plaza" },
  street(21, "Ivory Wharf", "garnet", 220, [18, 90, 250, 700, 875, 1050], 150),
  { index: 22, kind: "card", name: "City Notices", deck: "city" },
  street(23, "Crimson Arcade", "garnet", 220, [18, 90, 250, 700, 875, 1050], 150),
  street(24, "Garnet Row", "garnet", 240, [20, 100, 300, 750, 925, 1100], 150),
  { index: 25, kind: "rail", name: "South Ferry", price: 200 },
  street(26, "Solace Gardens", "solar", 260, [22, 110, 330, 800, 975, 1150], 150),
  street(27, "Bright Court", "solar", 260, [22, 110, 330, 800, 975, 1150], 150),
  { index: 28, kind: "utility", name: "Tidewell", price: 150 },
  street(29, "Goldspire", "solar", 280, [24, 120, 360, 850, 1025, 1200], 150),
  { index: 30, kind: "gotojail", name: "Sent to Lockup" },
  street(31, "Pearl District", "jade", 300, [26, 130, 390, 900, 1100, 1275], 200),
  street(32, "Jade Promenade", "jade", 300, [26, 130, 390, 900, 1100, 1275], 200),
  { index: 33, kind: "card", name: "City Notices", deck: "city" },
  street(34, "Emerald Quay", "jade", 320, [28, 150, 450, 1000, 1200, 1400], 200),
  { index: 35, kind: "rail", name: "West Ferry", price: 200 },
  { index: 36, kind: "card", name: "Tide Ledger", deck: "tide" },
  street(37, "Crown Heights", "crown", 350, [35, 175, 500, 1100, 1300, 1500], 200),
  { index: 38, kind: "tax", name: "Luxury Levy", amount: 100 },
  street(39, "Palace Reach", "crown", 400, [50, 200, 600, 1400, 1700, 2000], 200),
];

export const RAILS = [5, 15, 25, 35];
export const UTILITIES = [12, 28];

export function spaceAt(index: number): Space {
  const space = BOARD[index];
  if (!space) throw new Error(`No space ${index}`);
  return space;
}

export function isDeed(space: Space): space is Street | Rail | Utility {
  return space.kind === "street" || space.kind === "rail" || space.kind === "utility";
}

export function groupIndices(group: GroupId): number[] {
  return BOARD.filter((s): s is Street => s.kind === "street" && s.group === group).map((s) => s.index);
}

export function mortgageValue(space: Street | Rail | Utility): number {
  return space.price / 2;
}

export function tokenMeta(id: string): { label: string; ink: string } {
  const map: Record<string, { label: string; ink: string }> = {
    heron: { label: "Heron", ink: "var(--token-heron)" },
    lantern: { label: "Lantern", ink: "var(--token-lantern)" },
    ferry: { label: "Ferry", ink: "var(--token-ferry)" },
    key: { label: "Key", ink: "var(--token-key)" },
    compass: { label: "Compass", ink: "var(--token-compass)" },
    crown: { label: "Crown", ink: "var(--token-crown)" },
    anchor: { label: "Anchor", ink: "var(--token-anchor)" },
    fox: { label: "Fox", ink: "var(--token-fox)" },
  };
  return map[id] ?? { label: id, ink: "var(--color-primary)" };
}
