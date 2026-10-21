import { useEffect, useMemo, useState } from "react";
import {
  BOARD,
  GROUP_META,
  actorId,
  canBuild,
  canMortgage,
  canSell,
  canUnmortgage,
  cardById,
  chooseAiAction,
  computeRent,
  debtTotal,
  dispatch,
  isDeed,
  minNextBid,
  mortgageValue,
  netWorth,
  ownedIndices,
  phaseHint,
  spaceAt,
  standings,
  tokenMeta,
  unmortgageCost,
  type Action,
  type CreateConfig,
  type GameState,
  type TokenId,
} from "../engine/index.ts";
import type { Prefs } from "./storage.ts";
import { TokenMark } from "./tokens.tsx";

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

function marks(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

function gridOf(index: number): { gridColumn: number; gridRow: number } {
  if (index <= 10) return { gridRow: 11, gridColumn: 11 - index };
  if (index < 20) return { gridRow: 11 - (index - 10), gridColumn: 1 };
  if (index <= 30) return { gridRow: 1, gridColumn: index - 19 };
  return { gridRow: index - 29, gridColumn: 11 };
}

export function Table({
  state,
  setup,
  prefs,
  reason,
  error,
  onAct,
  onExit,
  onRematch,
  onPrefs,
}: {
  state: GameState;
  setup: CreateConfig;
  prefs: Prefs;
  reason: string;
  error: string;
  onAct: (action: Action) => void;
  onExit: () => void;
  onRematch: () => void;
  onPrefs: (prefs: Prefs) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [paused, setPaused] = useState(false);
  const [ledger, setLedger] = useState(false);
  const [acked, setAcked] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, number>>({});
  const [rolling, setRolling] = useState(false);
  const [aiNote, setAiNote] = useState(reason);
  const [bid, setBid] = useState(10);
  const moveSig = state.lastMove ? `${state.lastMove.playerId}:${state.lastMove.path.join("-")}` : "";
  const actor = actorId(state);
  const actorPlayer = state.players.find((p) => p.id === actor) ?? null;
  const seat = state.players[state.current]!;
  const humans = state.players.filter((p) => p.human && !p.bankrupt).length;
  const handoff = prefs.handoff && humans > 1 && actorPlayer?.human && acked !== actorPlayer.id && !state.gameOver;

  useEffect(() => {
    if (prefs.reducedMotion || !state.lastMove) {
      setShown({});
      return;
    }
    const move = state.lastMove;
    let step = 0;
    setShown({ [move.playerId]: move.path[0] ?? 0 });
    const gap = prefs.fastAi ? 70 : 160;
    const timer = window.setInterval(() => {
      step += 1;
      if (step >= move.path.length) {
        window.clearInterval(timer);
        setShown({});
        return;
      }
      setShown({ [move.playerId]: move.path[step] ?? move.path[move.path.length - 1]! });
    }, gap);
    return () => window.clearInterval(timer);
  }, [moveSig, prefs.reducedMotion, prefs.fastAi, state.lastMove]);

  useEffect(() => {
    if (!state.dice) return;
    setRolling(true);
    const timer = window.setTimeout(() => setRolling(false), prefs.reducedMotion ? 0 : 420);
    return () => window.clearTimeout(timer);
  }, [state.dice, state.logSeq, prefs.reducedMotion]);

  useEffect(() => {
    if (state.auction) setBid(minNextBid(state, state.auction));
  }, [state]);

  const animating = Object.keys(shown).length > 0;

  useEffect(() => {
    if (animating || handoff || paused || state.gameOver) return;
    if (!actorPlayer || actorPlayer.human) return;
    const delay = prefs.fastAi ? 80 : 640;
    const timer = window.setTimeout(() => {
      try {
        const choice = chooseAiAction(state);
        setAiNote(choice.reason);
        onAct(choice.action);
      } catch (err) {
        console.error(err);
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [state, animating, handoff, paused, actorPlayer, prefs, onAct]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === "Escape") setPaused((v) => !v);
      if (!actorPlayer?.human || handoff || paused) return;
      if (event.key.toLowerCase() === "r" && state.phase === "pre_roll") onAct({ type: "ROLL" });
      if (event.key.toLowerCase() === "e" && state.phase === "manage") onAct({ type: "END_TURN" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actorPlayer, handoff, paused, state.phase, onAct]);

  const selectedSpace = selected != null ? spaceAt(selected) : null;

  return (
    <div className="table-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Round {state.round}</div>
          <strong className="wordmark" style={{ fontSize: "1.4rem" }}>Aurelia</strong>
        </div>
        <div className="muted">{phaseHint(state)}</div>
        <div className="row">
          <button className="btn ghost" type="button" onClick={() => onPrefs({ ...prefs, fastAi: !prefs.fastAi })}>
            {prefs.fastAi ? "AI brisk" : "AI paced"}
          </button>
          <button className="btn" type="button" onClick={() => setPaused(true)}>Pause</button>
        </div>
      </header>
      <div className="table-grid">
        <div className="felt">
          <div className="board" role="grid" aria-label="Aurelia harbor board">
            {BOARD.map((space) => {
              const pos = gridOf(space.index);
              const deed = state.deeds[space.index];
              const owner = deed?.ownerId ? state.players.find((p) => p.id === deed.ownerId) : null;
              const here = state.players.filter((p) => (shown[p.id] ?? p.position) === space.index && !p.bankrupt);
              const group = space.kind === "street" ? space.group : null;
              return (
                <button
                  key={space.index}
                  type="button"
                  className="cell"
                  style={pos}
                  data-hot={seat.position === space.index ? "yes" : "no"}
                  aria-label={`${space.name}${owner ? `, owned by ${owner.name}` : ""}`}
                  onClick={() => setSelected(space.index)}
                >
                  {group && (
                    <span className="swatch" data-group={group} data-pattern={GROUP_META[group].pattern} />
                  )}
                  <span className="nm">{space.name}</span>
                  {space.kind === "street" && deed && deed.houses > 0 && (
                    <span className="houses" aria-hidden="true">
                      {deed.houses === 5 ? <b className="hotel" /> : Array.from({ length: deed.houses }, (_, i) => <b key={i} />)}
                    </span>
                  )}
                  {isDeed(space) && <span className="px">{deed?.mortgaged ? "Mortgaged" : marks(space.price)}</span>}
                  {owner && (
                    <span className="owner-flag pip" data-token={owner.token} title={owner.name}>
                      {owner.name.slice(0, 1)}
                    </span>
                  )}
                  <span className="seat-tokens">
                    {here.map((p) => (
                      <span key={p.id} className="mini pip" data-token={p.token} title={p.name}>
                        <TokenMark id={p.token} />
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
            <div className="plaza">
              <div className="eyebrow">Harbor Gate</div>
              <h2>Aurelia</h2>
              <div className="dice" aria-label="Dice">
                <Die value={state.dice?.[0] ?? 1} rolling={rolling} hidden={!state.dice} />
                <Die value={state.dice?.[1] ?? 1} rolling={rolling} hidden={!state.dice} />
              </div>
              <div>
                <strong>{seat.name}</strong>
                <div className="muted">{seat.inJail ? "In the Lockup" : tokenMeta(seat.token).label}</div>
              </div>
            </div>
          </div>
        </div>
        <aside className="side">
          <div className="row">
            <span className="mini pip" data-token={seat.token}><TokenMark id={seat.token} /></span>
            <div>
              <div className="eyebrow">{seat.human ? "At the table" : seat.difficulty}</div>
              <strong>{seat.name}</strong>
            </div>
          </div>
          <p className="cash">{marks(seat.cash)}</p>
          <p className="muted">Net worth {marks(netWorth(state, seat.id))} · {ownedIndices(state, seat.id).length} deeds</p>
          {prefs.explainAi && aiNote && !seat.human && <p className="muted">{aiNote}</p>}
          {error && <div className="toast">{error}</div>}
          {!handoff && actorPlayer?.human && (
            <Actions state={state} bid={bid} setBid={setBid} onAct={onAct} onTrade={() => setTradeOpen(true)} onManage={() => setManage(true)} />
          )}
          <div className="chips">
            {state.players.map((p) => (
              <span key={p.id} className="chip" style={{ opacity: p.bankrupt ? 0.45 : 1 }}>
                {p.name} {p.bankrupt ? "out" : marks(p.cash)}
              </span>
            ))}
          </div>
          <button className="btn ghost" type="button" onClick={() => setLedger((v) => !v)}>{ledger ? "Hide ledger" : "Ledger"}</button>
          <div className="log">
            {(ledger ? state.log : state.log.slice(-6)).slice().reverse().map((entry) => (
              <p key={entry.id}>
                {entry.message}{" "}
                {entry.amount != null && (
                  <span className={entry.amount >= 0 ? "gain" : "loss"}>
                    {entry.amount >= 0 ? "+" : ""}
                    {marks(entry.amount)}
                  </span>
                )}
              </p>
            ))}
          </div>
        </aside>
      </div>
      {selectedSpace && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label={selectedSpace.name}>
          <div className="modal">
            <div className="eyebrow">{selectedSpace.kind}</div>
            <h3 className="wordmark" style={{ margin: 0, fontSize: "2rem" }}>{selectedSpace.name}</h3>
            <DeedFacts state={state} index={selected} onAct={onAct} actorId={actor} />
            <button className="btn" type="button" onClick={() => setSelected(null)}>Close</button>
          </div>
        </div>
      )}
      {tradeOpen && <TradeSheet state={state} onAct={onAct} onClose={() => setTradeOpen(false)} />}
      {manage && <ManageSheet state={state} onAct={onAct} onClose={() => setManage(false)} />}
      {paused && (
        <Pause
          state={state}
          setup={setup}
          onClose={() => setPaused(false)}
          onExit={onExit}
          onResign={() => {
            onAct({ type: "RESIGN" });
            setPaused(false);
          }}
        />
      )}
      {handoff && actorPlayer && (
        <div className="overlay">
          <div className="modal">
            <div className="eyebrow">Pass the table</div>
            <h3 className="wordmark" style={{ margin: 0, fontSize: "2.2rem" }}>{actorPlayer.name}</h3>
            <p className="muted">The next decision belongs to {actorPlayer.name}. Hand over the device, then continue.</p>
            <button className="btn primary" type="button" onClick={() => setAcked(actorPlayer.id)}>
              {actorPlayer.name} is ready
            </button>
          </div>
        </div>
      )}
      {state.gameOver && <GameOver state={state} onExit={onExit} onRematch={onRematch} />}
    </div>
  );
}

function Die({ value, rolling, hidden }: { value: number; rolling: boolean; hidden?: boolean }) {
  const on = PIPS[value] ?? [];
  return (
    <div className={rolling ? "die rolling" : "die"} style={{ visibility: hidden ? "hidden" : "visible" }} aria-hidden={hidden}>
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} className={on.includes(i) ? "on" : ""} />
      ))}
    </div>
  );
}

function Actions({
  state, bid, setBid, onAct, onTrade, onManage,
}: {
  state: GameState;
  bid: number;
  setBid: (n: number) => void;
  onAct: (a: Action) => void;
  onTrade: () => void;
  onManage: () => void;
}) {
  if (state.phase === "pre_roll") {
    return (
      <div className="row">
        <button className="btn primary" type="button" onClick={() => onAct({ type: "ROLL" })}>Roll</button>
        <button className="btn" type="button" onClick={onManage}>Deeds</button>
        {state.rules.trading && <button className="btn" type="button" onClick={onTrade}>Trade</button>}
      </div>
    );
  }
  if (state.phase === "purchase" && state.purchaseIndex != null) {
    const space = spaceAt(state.purchaseIndex);
    const price = isDeed(space) ? space.price : 0;
    const poor = state.players[state.current]!.cash < price;
    return (
      <div className="sheet">
        <strong>{isDeed(space) ? space.name : "Deed"} is unclaimed</strong>
        <p className="muted">List price {marks(price)}. {poor ? "You cannot afford it." : "Buying is final once confirmed."}</p>
        <div className="row">
          <button className="btn primary" type="button" disabled={poor} onClick={() => onAct({ type: "BUY" })}>Buy for {marks(price)}</button>
          <button className="btn" type="button" onClick={() => onAct({ type: "DECLINE" })}>{state.rules.auctions ? "Auction" : "Decline"}</button>
        </div>
      </div>
    );
  }
  if (state.phase === "auction" && state.auction) {
    const space = spaceAt(state.auction.propertyIndex);
    return (
      <div className="sheet">
        <strong>Auction · {isDeed(space) ? space.name : "Deed"}</strong>
        <p className="muted">High bid {marks(state.auction.highBid)} {state.auction.highBidderId ? `by ${state.players.find((p) => p.id === state.auction?.highBidderId)?.name}` : "— none yet"}</p>
        <label className="muted">Your bid
          <input className="textin" type="number" min={minNextBid(state, state.auction)} value={bid} onChange={(e) => setBid(Number(e.target.value))} />
        </label>
        <div className="row">
          <button className="btn primary" type="button" onClick={() => onAct({ type: "BID", amount: bid })}>Bid</button>
          <button className="btn" type="button" onClick={() => onAct({ type: "PASS" })}>Pass</button>
        </div>
      </div>
    );
  }
  if (state.phase === "card" && state.revealedCard) {
    const card = cardById(state.revealedCard);
    return (
      <div className="sheet">
        <div className="eyebrow">{card.deck === "tide" ? "Tide Ledger" : "City Notices"}</div>
        <strong>{card.title}</strong>
        <p>{card.text}</p>
        <button className="btn primary" type="button" onClick={() => onAct({ type: "ACK" })}>Resolve</button>
      </div>
    );
  }
  if (state.phase === "jail") {
    const player = state.players[state.current]!;
    return (
      <div className="row">
        <button className="btn primary" type="button" onClick={() => onAct({ type: "ROLL_JAIL" })}>Roll for doubles</button>
        <button className="btn" type="button" disabled={player.cash < state.rules.jailFine} onClick={() => onAct({ type: "PAY_FINE" })}>Pay {state.rules.jailFine}</button>
        <button className="btn" type="button" disabled={player.jailCards.length === 0} onClick={() => onAct({ type: "USE_CARD" })}>Use key</button>
      </div>
    );
  }
  if (state.phase === "debt" && state.debt) {
    const total = debtTotal(state.debt);
    const player = state.players.find((p) => p.id === state.debt?.debtorId);
    return (
      <div className="sheet">
        <strong>Debt · {marks(total)}</strong>
        <p className="muted">{state.debt.reason}. {player?.name} holds {marks(player?.cash ?? 0)}.</p>
        <div className="row">
          <button className="btn primary" type="button" disabled={(player?.cash ?? 0) < total} onClick={() => onAct({ type: "PAY_DEBT" })}>Pay</button>
          <button className="btn" type="button" onClick={() => onAct({ type: "BANKRUPT" })}>Go bankrupt</button>
          <button className="btn" type="button" onClick={onManage}>Raise funds</button>
          {state.rules.trading && <button className="btn" type="button" onClick={onTrade}>Trade</button>}
        </div>
      </div>
    );
  }
  if (state.phase === "trade" && state.trade) return <TradeReview state={state} onAct={onAct} />;
  if (state.phase === "manage") {
    return (
      <div className="row">
        <button className="btn primary" type="button" onClick={() => onAct({ type: "END_TURN" })}>End turn</button>
        <button className="btn" type="button" onClick={onManage}>Deeds</button>
        {state.rules.trading && <button className="btn" type="button" onClick={onTrade}>Trade</button>}
      </div>
    );
  }
  return null;
}

function DeedFacts({ state, index, onAct, actorId: actor }: { state: GameState; index: number | null; onAct: (a: Action) => void; actorId: string | null }) {
  if (index == null) return null;
  const space = spaceAt(index);
  const deed = state.deeds[index];
  if (!isDeed(space) || !deed) {
    return <p className="muted">{space.kind === "tax" && "amount" in space ? `Pay ${space.amount} when you land here.` : phaseHint(state)}</p>;
  }
  const owner = deed.ownerId ? state.players.find((p) => p.id === deed.ownerId) : null;
  const rent = owner ? computeRent(state, index, state.dice ? state.dice[0] + state.dice[1] : 7) : space.kind === "street" ? space.rent[0] : 0;
  const mine = actor && deed.ownerId === actor;
  return (
    <div>
      <p>{owner ? `${owner.name}${deed.mortgaged ? " (mortgaged)" : ""}` : "Unclaimed"} · rent now {marks(rent)}</p>
      {space.kind === "street" && (
        <p className="muted">
          Rents {space.rent.map((n) => marks(n)).join(" / ")} · build {marks(space.house)} · ward {GROUP_META[space.group].label}
        </p>
      )}
      {space.kind !== "street" && <p className="muted">Price {marks(space.price)} · mortgage {marks(mortgageValue(space))}</p>}
      {mine && actor && (
        <div className="row">
          <button className="btn" type="button" disabled={!!canBuild(state, actor, index)} title={canBuild(state, actor, index) ?? "Build"} onClick={() => onAct({ type: "BUILD", index })}>Build</button>
          <button className="btn" type="button" disabled={!!canSell(state, actor, index)} title={canSell(state, actor, index) ?? "Sell"} onClick={() => onAct({ type: "SELL", index })}>Sell</button>
          <button className="btn" type="button" disabled={!!canMortgage(state, actor, index)} title={canMortgage(state, actor, index) ?? "Mortgage"} onClick={() => onAct({ type: "MORTGAGE", index })}>Mortgage</button>
          <button className="btn" type="button" disabled={!!canUnmortgage(state, actor, index)} title={canUnmortgage(state, actor, index) ?? "Unmortgage"} onClick={() => onAct({ type: "UNMORTGAGE", index })}>
            Lift {marks(unmortgageCost(state, space))}
          </button>
        </div>
      )}
    </div>
  );
}

function ManageSheet({ state, onAct, onClose }: { state: GameState; onAct: (a: Action) => void; onClose: () => void }) {
  const id = actorId(state) ?? state.players[state.current]!.id;
  const owned = ownedIndices(state, id);
  return (
    <div className="overlay">
      <div className="modal">
        <h3 className="wordmark" style={{ margin: 0 }}>Deeds</h3>
        {owned.length === 0 && <p className="muted">No deeds yet.</p>}
        {owned.map((index) => {
          const space = spaceAt(index);
          const deed = state.deeds[index]!;
          return (
            <div key={index} className="list-btn">
              <strong>{isDeed(space) ? space.name : index}</strong>
              <div className="muted">{deed.mortgaged ? "Mortgaged" : deed.houses ? `${deed.houses === 5 ? "Hotel" : `${deed.houses} houses`}` : "Bare"}</div>
              <div className="row">
                <button className="btn" type="button" disabled={!!canBuild(state, id, index)} onClick={() => onAct({ type: "BUILD", index })}>Build</button>
                <button className="btn" type="button" disabled={!!canSell(state, id, index)} onClick={() => onAct({ type: "SELL", index })}>Sell</button>
                <button className="btn" type="button" disabled={!!canMortgage(state, id, index)} onClick={() => onAct({ type: "MORTGAGE", index })}>Mortgage</button>
                <button className="btn" type="button" disabled={!!canUnmortgage(state, id, index)} onClick={() => onAct({ type: "UNMORTGAGE", index })}>Lift</button>
              </div>
            </div>
          );
        })}
        <button className="btn primary" type="button" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

function TradeSheet({ state, onAct, onClose }: { state: GameState; onAct: (a: Action) => void; onClose: () => void }) {
  const from = actorId(state) ?? state.players[state.current]!.id;
  const others = state.players.filter((p) => p.id !== from && !p.bankrupt);
  const [toId, setToId] = useState(others[0]?.id ?? "");
  const [offer, setOffer] = useState<number[]>([]);
  const [request, setRequest] = useState<number[]>([]);
  const [offerCash, setOfferCash] = useState(0);
  const [requestCash, setRequestCash] = useState(0);
  const mine = ownedIndices(state, from).filter((i) => state.deeds[i]?.houses === 0);
  const theirs = ownedIndices(state, toId).filter((i) => state.deeds[i]?.houses === 0);
  function toggle(list: number[], set: (n: number[]) => void, index: number) {
    set(list.includes(index) ? list.filter((n) => n !== index) : [...list, index]);
  }
  return (
    <div className="overlay">
      <div className="modal">
        <h3 className="wordmark" style={{ margin: 0 }}>Trade</h3>
        <select className="select" value={toId} onChange={(e) => { setToId(e.target.value); setRequest([]); }}>
          {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <p className="muted">You give</p>
        {mine.map((index) => (
          <label key={index} className="checkline">
            <input type="checkbox" checked={offer.includes(index)} onChange={() => toggle(offer, setOffer, index)} />
            {spaceAt(index).name}
          </label>
        ))}
        <label className="muted">Cash you add
          <input className="textin" type="number" min={0} value={offerCash} onChange={(e) => setOfferCash(Number(e.target.value))} />
        </label>
        <p className="muted">You ask</p>
        {theirs.map((index) => (
          <label key={index} className="checkline">
            <input type="checkbox" checked={request.includes(index)} onChange={() => toggle(request, setRequest, index)} />
            {spaceAt(index).name}
          </label>
        ))}
        <label className="muted">Cash you ask
          <input className="textin" type="number" min={0} value={requestCash} onChange={(e) => setRequestCash(Number(e.target.value))} />
        </label>
        <div className="row">
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              onAct({
                type: "PROPOSE",
                toId,
                offerProperties: offer,
                offerCash,
                offerCards: [],
                requestProperties: request,
                requestCash,
                requestCards: [],
              });
              onClose();
            }}
          >
            Offer
          </button>
          <button className="btn" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function TradeReview({ state, onAct }: { state: GameState; onAct: (a: Action) => void }) {
  const trade = state.trade;
  if (!trade) return null;
  const from = state.players.find((p) => p.id === trade.fromId);
  const names = (ids: number[]) => ids.map((i) => spaceAt(i).name).join(", ") || "no deeds";
  return (
    <div className="sheet">
      <strong>{from?.name} offers a trade</strong>
      <p>Gives {names(trade.offerProperties)} and {marks(trade.offerCash)}</p>
      <p>Wants {names(trade.requestProperties)} and {marks(trade.requestCash)}</p>
      <div className="row">
        <button className="btn primary" type="button" onClick={() => onAct({ type: "ACCEPT" })}>Accept</button>
        <button className="btn" type="button" onClick={() => onAct({ type: "REJECT" })}>Refuse</button>
        <button className="btn ghost" type="button" onClick={() => onAct({ type: "CANCEL_TRADE" })}>Withdraw</button>
      </div>
    </div>
  );
}

function Pause({ state, setup, onClose, onExit, onResign }: { state: GameState; setup: CreateConfig; onClose: () => void; onExit: () => void; onResign: () => void }) {
  const file = useMemo(() => JSON.stringify({ state, setup }), [state, setup]);
  return (
    <div className="overlay">
      <div className="modal">
        <h3 className="wordmark" style={{ margin: 0 }}>Paused</h3>
        <p className="muted">Seed {state.seed}. The match is already saved on this device.</p>
        <div className="row">
          <button className="btn primary" type="button" onClick={onClose}>Resume</button>
          <button className="btn" type="button" onClick={onExit}>Menu</button>
          <button className="btn" type="button" onClick={() => download("aurelia-match.json", file)}>Export</button>
          <button className="btn danger" type="button" onClick={onResign}>Resign seat</button>
        </div>
      </div>
    </div>
  );
}

function GameOver({ state, onExit, onRematch }: { state: GameState; onExit: () => void; onRematch: () => void }) {
  const rows = standings(state);
  const winner = rows.find((r) => r.id === state.winnerId);
  return (
    <div className="overlay">
      <div className="modal">
        <div className="eyebrow">The harbor is settled</div>
        <h3 className="wordmark" style={{ margin: 0, fontSize: "2.4rem" }}>{winner?.name ?? "No owner"}</h3>
        <p className="muted">{state.endReason}</p>
        {rows.map((row) => (
          <p key={row.id}>{row.name} · {row.bankrupt ? "bankrupt" : `${marks(row.netWorth)} net · ${row.properties} deeds`}</p>
        ))}
        <div className="row">
          <button className="btn primary" type="button" onClick={onRematch}>Rematch</button>
          <button className="btn" type="button" onClick={onExit}>Return to the quay</button>
        </div>
      </div>
    </div>
  );
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export type { TokenId };
