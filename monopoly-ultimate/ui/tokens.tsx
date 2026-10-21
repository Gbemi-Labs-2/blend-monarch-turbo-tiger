import type { TokenId } from "../engine/index.ts";

const PATHS: Record<TokenId, string> = {
  heron: "M4 16c4-8 8-8 12-2 2 3 1 6-2 7-4 2-8 0-10-5z M14 8l6-4",
  lantern: "M9 3h6l1 3H8z M8 6h8l-1 12H9z M12 18v3",
  ferry: "M3 14h18l-2 4H5z M7 14V9h10v5 M9 9V6h6",
  key: "M8 8a3 3 0 1 1 0.1 0 M11 9h8 M16 9v3 M19 9v2",
  compass: "M12 3l3 9-3 9-3-9z M12 9v6",
  crown: "M4 16l2-8 6 5 6-5 2 8z M6 16h12v2H6z",
  anchor: "M12 3a2 2 0 1 1 0 4 M12 7v11 M7 14c0 4 10 4 10 0 M8 18h8",
  fox: "M4 8l4 2 4-6 4 6 4-2-2 12H6z",
};

export function TokenMark({ id }: { id: TokenId }) {
  return (
    <svg className="piece" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[id]} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

export const TOKEN_IDS: TokenId[] = ["heron", "lantern", "ferry", "key", "compass", "crown", "anchor", "fox"];
