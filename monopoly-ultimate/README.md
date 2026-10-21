# Aurelia

A harbor-city property game. Buy wards, run auctions, build evenly, mortgage, trade, and outlast the table.

The playable app is the workspace preview. Game rules, AI, and this note live in `monopoly-ultimate/`. The screen is mounted from the app root so it can run in the preview.

## Play

- **Solo** — you against rivals.
- **Pass and play** — two or more people, one device. A handoff screen hides the table between human seats.
- **Custom** — starting cash, auctions, trading, Free Plaza pot, even building, round limit.
- **Tournament** — local simulated series. Not an online room.

Online multiplayer is not part of this build. A durable authoritative game server is not available on the deploy target, so the table does not pretend to be networked.

## Rivals

| | How they decide |
|---|---|
| Easy | Buys cheap deeds, keeps a blunt reserve, rolls in the Lockup, rarely trades. |
| Normal | Compares a deed’s value with its price and keeps a cash reserve. |
| Hard | Adds liquidity, blocking value, and auction ceilings. |
| Expert | Also weighs likely rent on the next roll and pays up to finish a ward. |

Personalities change those weights: banker, aggressive, trader, collector, risk, balanced. Explanations can be shown beside the seat. They are the heuristic, not a claim of deep search.

## Save

Matches and settings stay in this browser. Export from the pause menu writes the match JSON. A damaged file is rejected.

## Tests

From the workspace root:

```
npm test
```

Engine coverage includes movement, salary, rent, wards, auctions, jail, cards, mortgages, hotels, trades, bankruptcy, saves, and seeded rival matches.

## Rules

Open **Rules** in the game. Defaults follow a classic property-trading rhythm with original names: Harbor Gate salary, Lockup, Tide Ledger, City Notices, ferries, and two utilities.
