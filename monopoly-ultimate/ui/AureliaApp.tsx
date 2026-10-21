import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Play, Settings, Trophy, Users } from "lucide-react";
import {
  CLASSIC_RULES,
  RULE_PRESETS,
  createGame,
  dispatch,
  importGame,
  makeRules,
  playUntilDone,
  rulesSummary,
  standings,
  type Action,
  type CreateConfig,
  type Difficulty,
  type GameState,
  type Personality,
  type PlayerSetup,
  type TokenId,
} from "../engine/index.ts";
import { setMusic, sfx, unlockAudio } from "./audio.ts";
import {
  DEFAULT_PREFS,
  loadHistory,
  loadPrefs,
  loadSave,
  loadTourney,
  pushHistory,
  savePrefs,
  saveTourney,
  writeSave,
  type HistoryRow,
  type Prefs,
  type TourneyRow,
} from "./storage.ts";
import { Table } from "./table.tsx";
import { TOKEN_IDS, TokenMark } from "./tokens.tsx";

type Screen = "menu" | "setup" | "rules" | "settings" | "tournament" | "play";
type Mode = CreateConfig["mode"];

type Draft = {
  name: string;
  human: boolean;
  token: TokenId;
  difficulty: Difficulty;
  personality: Personality;
};

const DIFFS: Difficulty[] = ["easy", "normal", "hard", "expert"];
const PEOPLE: Personality[] = ["balanced", "aggressive", "banker", "trader", "collector", "risk"];

function freshDraft(mode: Mode): Draft[] {
  if (mode === "hotseat") {
    return [
      { name: "Ada", human: true, token: "heron", difficulty: "normal", personality: "balanced" },
      { name: "Bea", human: true, token: "fox", difficulty: "normal", personality: "balanced" },
    ];
  }
  if (mode === "tournament") {
    return [
      { name: "Ivy", human: false, token: "heron", difficulty: "easy", personality: "banker" },
      { name: "Nico", human: false, token: "lantern", difficulty: "normal", personality: "trader" },
      { name: "Hale", human: false, token: "ferry", difficulty: "hard", personality: "aggressive" },
      { name: "Quill", human: false, token: "key", difficulty: "expert", personality: "collector" },
    ];
  }
  return [
    { name: "You", human: true, token: "heron", difficulty: "normal", personality: "balanced" },
    { name: "Ivy", human: false, token: "lantern", difficulty: "easy", personality: "banker" },
    { name: "Nico", human: false, token: "ferry", difficulty: "normal", personality: "trader" },
    { name: "Quill", human: false, token: "key", difficulty: "expert", personality: "collector" },
  ];
}

export function AureliaApp() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [screen, setScreen] = useState<Screen>("menu");
  const [mode, setMode] = useState<Mode>("solo");
  const [draft, setDraft] = useState<Draft[]>(freshDraft("solo"));
  const [preset, setPreset] = useState("classic");
  const [rules, setRules] = useState({ ...CLASSIC_RULES });
  const [state, setState] = useState<GameState | null>(null);
  const [setup, setSetup] = useState<CreateConfig | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [recorded, setRecorded] = useState("");
  const [intro, setIntro] = useState(false);

  useEffect(() => {
    const loaded = loadPrefs();
    setPrefs(loaded);
    setHistory(loadHistory());
    if (!loaded.seenIntro) setIntro(true);
  }, []);

  useEffect(() => {
    savePrefs(prefs);
    setMusic(screen === "menu" || screen === "play", prefs);
  }, [prefs, screen]);

  useEffect(() => {
    if (!state?.gameOver || recorded === state.id) return;
    const winner = state.players.find((p) => p.id === state.winnerId);
    pushHistory({
      id: state.id,
      at: Date.now(),
      winner: winner?.name ?? "No one",
      players: state.players.map((p) => p.name).join(", "),
      rounds: state.round,
      reason: state.endReason ?? "",
    });
    setHistory(loadHistory());
    setRecorded(state.id);
    sfx("win", prefs);
  }, [state, recorded, prefs]);

  const saved = useMemo(() => (typeof window === "undefined" ? null : loadSave()), [screen]);

  const updatePrefs = (next: Prefs) => setPrefs(next);

  const begin = (config: CreateConfig) => {
    try {
      const next = createGame(config);
      setSetup(config);
      setState(next);
      setError("");
      setReason("");
      setRecorded("");
      writeSave({ state: next, setup: config });
      setScreen("play");
      sfx("click", prefs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start");
    }
  };

  const act = useCallback(
    (action: Action) => {
      if (!state || !setup) return;
      const result = dispatch(state, action);
      if (!result.ok) {
        setError(result.error);
        sfx("no", prefs);
        return;
      }
      setError("");
      if (action.type === "ROLL" || action.type === "ROLL_JAIL") sfx("dice", prefs);
      else if (action.type === "BUY" || action.type === "PAY_DEBT" || action.type === "BID") sfx("coin", prefs);
      else if (action.type === "ACK") sfx("card", prefs);
      else sfx("click", prefs);
      if (result.state.log.at(-1)?.message.includes("Lockup")) sfx("jail", prefs);
      setState(result.state);
      if (!result.state.gameOver) writeSave({ state: result.state, setup });
      else writeSave(null);
    },
    [state, setup, prefs],
  );

  const openSetup = (next: Mode) => {
    setMode(next);
    setDraft(freshDraft(next));
    setPreset("classic");
    setRules({ ...CLASSIC_RULES, ...RULE_PRESETS.classic });
    setError("");
    setScreen("setup");
    unlockAudio();
  };

  return (
    <div
      className="app"
      data-theme={prefs.theme}
      data-contrast={prefs.contrast ? "high" : "off"}
      data-colorblind={prefs.colorblind ? "on" : "off"}
      data-scale={prefs.scale}
      data-motion={prefs.reducedMotion ? "off" : "on"}
    >
      {screen === "menu" && (
        <Menu
          saved={saved}
          history={history}
          intro={intro}
          onDismissIntro={() => {
            setIntro(false);
            updatePrefs({ ...prefs, seenIntro: true });
          }}
          onPlay={openSetup}
          onContinue={() => {
            if (!saved) return;
            const back = importGame(JSON.stringify(saved.state));
            if (!back.ok) {
              setError(back.error);
              return;
            }
            setState(back.state);
            setSetup(saved.setup);
            setScreen("play");
          }}
          onRules={() => setScreen("rules")}
          onSettings={() => setScreen("settings")}
          onTourney={() => setScreen("tournament")}
        />
      )}
      {screen === "setup" && (
        <Setup
          mode={mode ?? "solo"}
          draft={draft}
          setDraft={setDraft}
          preset={preset}
          rules={rules}
          error={error}
          onPreset={(name) => {
            setPreset(name);
            setRules({ ...CLASSIC_RULES, ...RULE_PRESETS[name] });
          }}
          onRules={setRules}
          onBack={() => setScreen("menu")}
          onStart={() => {
            const config: CreateConfig = {
              mode,
              seed: Math.floor(Math.random() * 1_000_000_000) + 1,
              rules,
              players: draft.map((p) => ({
                name: p.name,
                human: p.human,
                token: p.token,
                difficulty: p.difficulty,
                personality: p.personality,
              })),
            };
            begin(config);
          }}
        />
      )}
      {screen === "rules" && <Rules onBack={() => setScreen("menu")} />}
      {screen === "settings" && <SettingsScreen prefs={prefs} onChange={updatePrefs} onBack={() => setScreen("menu")} />}
      {screen === "tournament" && <Tournament onBack={() => setScreen("menu")} />}
      {screen === "play" && state && setup && (
        <Table
          state={state}
          setup={setup}
          prefs={prefs}
          reason={reason}
          error={error}
          onAct={act}
          onPrefs={updatePrefs}
          onExit={() => setScreen("menu")}
          onRematch={() => begin({ ...setup, seed: Math.floor(Math.random() * 1_000_000_000) + 1, id: undefined })}
        />
      )}
    </div>
  );
}

function Menu({
  saved, history, intro, onDismissIntro, onPlay, onContinue, onRules, onSettings, onTourney,
}: {
  saved: { state: GameState } | null;
  history: HistoryRow[];
  intro: boolean;
  onDismissIntro: () => void;
  onPlay: (mode: Mode) => void;
  onContinue: () => void;
  onRules: () => void;
  onSettings: () => void;
  onTourney: () => void;
}) {
  return (
    <main className="menu">
      <section className="harbor" aria-hidden="false">
        <div className="moon" />
        <div className="skyline">
          {[46, 70, 38, 88, 54, 76, 42, 64, 50].map((h, i) => (
            <i key={i} style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="water" />
        <div className="menu-copy">
          <div className="eyebrow">Harbor city</div>
          <h1>Aurelia</h1>
          <p>Claim the wards, raise the roofs, and leave the last light burning.</p>
        </div>
      </section>
      <section className="menu-panel">
        {intro && (
          <div className="panel">
            <strong>First tide</strong>
            <p className="muted">Roll, buy a ward or auction it, and build only when you own the whole color. Pass Harbor Gate to collect. Three doubles and the Lockup takes you.</p>
            <button className="btn" type="button" onClick={onDismissIntro}>I know the quay</button>
          </div>
        )}
        <div className="mode-grid">
          {saved && (
            <button className="mode-card wide" type="button" onClick={onContinue}>
              <Play size={18} />
              <strong>Continue</strong>
              <span>Pick up the saved match on this device.</span>
            </button>
          )}
          <button className="mode-card" type="button" onClick={() => onPlay("solo")}>
            <Play size={18} />
            <strong>Solo</strong>
            <span>One owner against rivals who actually price the wards.</span>
          </button>
          <button className="mode-card" type="button" onClick={() => onPlay("hotseat")}>
            <Users size={18} />
            <strong>Pass and play</strong>
            <span>Share this table. No connection after the page loads.</span>
          </button>
          <button className="mode-card" type="button" onClick={onTourney}>
            <Trophy size={18} />
            <strong>Tournament</strong>
            <span>A local series. Wins stay on this device.</span>
          </button>
          <button className="mode-card" type="button" onClick={() => onPlay("custom")}>
            <Settings size={18} />
            <strong>Custom</strong>
            <span>Cash, auctions, plaza pot, and round limits.</span>
          </button>
        </div>
        <div className="row">
          <button className="btn" type="button" onClick={onRules}><BookOpen size={16} /> Rules</button>
          <button className="btn" type="button" onClick={onSettings}>Settings</button>
        </div>
        {history.length > 0 && (
          <div className="panel">
            <div className="eyebrow">Recent tables</div>
            {history.slice(0, 3).map((row) => (
              <p key={row.id} className="muted">{row.winner} took {row.players}</p>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Setup({
  mode, draft, setDraft, preset, rules, error, onPreset, onRules, onBack, onStart,
}: {
  mode: Mode;
  draft: Draft[];
  setDraft: (d: Draft[]) => void;
  preset: string;
  rules: typeof CLASSIC_RULES;
  error: string;
  onPreset: (name: string) => void;
  onRules: (rules: typeof CLASSIC_RULES) => void;
  onBack: () => void;
  onStart: () => void;
}) {
  const taken = new Set(draft.map((p) => p.token));
  return (
    <main className="screen">
      <div className="eyebrow">{mode === "hotseat" ? "Pass and play" : mode === "custom" ? "Custom match" : "Solo table"}</div>
      <h2 className="wordmark" style={{ fontSize: "2.6rem", margin: 0 }}>Who sits down</h2>
      {draft.map((player, index) => (
        <div key={index} className="panel">
          <div className="player-edit">
            <input className="textin" value={player.name} aria-label={`Name ${index + 1}`} onChange={(e) => update(index, { name: e.target.value })} />
            <label className="checkline">
              <input type="checkbox" checked={player.human} onChange={(e) => update(index, { human: e.target.checked })} />
              Human
            </label>
            {!player.human && (
              <>
                <select className="select" value={player.difficulty} aria-label="Difficulty" onChange={(e) => update(index, { difficulty: e.target.value as Difficulty })}>
                  {DIFFS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select className="select" value={player.personality} aria-label="Personality" onChange={(e) => update(index, { personality: e.target.value as Personality })}>
                  {PEOPLE.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </>
            )}
          </div>
          <div className="tokens" role="group" aria-label="Token">
            {TOKEN_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className="token-btn"
                data-on={player.token === id ? "yes" : "no"}
                disabled={taken.has(id) && player.token !== id}
                aria-label={id}
                onClick={() => update(index, { token: id })}
              >
                <TokenMark id={id} />
              </button>
            ))}
          </div>
          {draft.length > 2 && <button className="btn ghost" type="button" onClick={() => setDraft(draft.filter((_, i) => i !== index))}>Remove</button>}
        </div>
      ))}
      {draft.length < 6 && (
        <button className="btn" type="button" onClick={() => setDraft([...draft, { name: `Owner ${draft.length + 1}`, human: mode === "hotseat", token: TOKEN_IDS.find((id) => !taken.has(id)) ?? "anchor", difficulty: "normal", personality: "balanced" }])}>
          Add owner
        </button>
      )}
      <div className="panel">
        <div className="eyebrow">Rules</div>
        <div className="row">
          {Object.keys(RULE_PRESETS).map((name) => (
            <button key={name} className={preset === name ? "btn primary" : "btn"} type="button" onClick={() => onPreset(name)}>{name}</button>
          ))}
        </div>
        <p className="muted">{rulesSummary(rules)}</p>
        <label className="muted">Starting marks
          <input className="textin" type="number" min={500} max={5000} value={rules.startingCash} onChange={(e) => onRules({ ...rules, startingCash: Number(e.target.value) })} />
        </label>
        <label className="checkline"><input type="checkbox" checked={rules.auctions} onChange={(e) => onRules({ ...rules, auctions: e.target.checked })} /> Auctions when a buy is declined</label>
        <label className="checkline"><input type="checkbox" checked={rules.trading} onChange={(e) => onRules({ ...rules, trading: e.target.checked })} /> Trading</label>
        <label className="checkline"><input type="checkbox" checked={rules.freeParkingPot} onChange={(e) => onRules({ ...rules, freeParkingPot: e.target.checked })} /> Free Plaza collects fees</label>
        <label className="checkline"><input type="checkbox" checked={rules.evenBuild} onChange={(e) => onRules({ ...rules, evenBuild: e.target.checked })} /> Even building</label>
        <label className="muted">Round limit (0 = last owner standing)
          <input className="textin" type="number" min={0} max={80} value={rules.roundLimit ?? 0} onChange={(e) => onRules({ ...rules, roundLimit: Number(e.target.value) || null })} />
        </label>
      </div>
      {error && <div className="toast">{error}</div>}
      <div className="row">
        <button className="btn primary" type="button" onClick={onStart}>Open the harbor</button>
        <button className="btn" type="button" onClick={onBack}>Back</button>
      </div>
    </main>
  );

  function update(index: number, patch: Partial<Draft>) {
    setDraft(draft.map((player, i) => (i === index ? { ...player, ...patch } : player)));
  }
}

function Rules({ onBack }: { onBack: () => void }) {
  return (
    <main className="screen">
      <h2 className="wordmark" style={{ fontSize: "2.6rem", margin: 0 }}>Rules of the harbor</h2>
      <article className="panel">
        <p>Aurelia uses a 40-space square. Owners roll two dice and move clockwise. Passing Harbor Gate pays the salary, normally 200.</p>
        <p>Unclaimed streets, ferries, and utilities may be bought at list price. Declining sends the deed to auction. Bids rise by 10 after the first coin. The last bidder still in pays and takes the deed. If everyone passes, it stays unclaimed.</p>
        <p>Rent on a street follows its schedule. A full unmortgaged ward with no buildings charges double the base rent. Houses must be built evenly, and a fifth building is a hotel. The bank holds 32 houses and 12 hotels.</p>
        <p>Ferries pay 25, 50, 100, or 200 by how many unmortgaged ferries that owner has. One utility charges 4 times the dice; both charge 10 times. A Tide Ledger “works inspection” rolls fresh dice and charges 10 times if the utility is owned.</p>
        <p>Doubles grant another roll. Three doubles in one turn send you to the Lockup without collecting salary. A key or pardon, 50 marks, or doubles will release you. On the third failed roll you must pay and then move that roll. Leaving on doubles does not grant an extra turn.</p>
        <p>Mortgaging pays half the list price and stops rent. Lifting it costs that sum plus 10 percent. Buildings must be sold back evenly, at half cost, before a ward can be mortgaged. Traded deeds cannot carry buildings. Receiving a mortgaged deed costs 10 percent interest immediately.</p>
        <p>If you cannot cover a debt after selling buildings and mortgaging, you are bankrupt. A rival creditor receives your cash and deeds. The bank returns deeds to the open market. Last owner standing wins. A round limit, if set, crowns the highest net worth.</p>
        <p>Easy rivals buy cheap and keep a blunt reserve. Normal rivals price rent against cost. Hard rivals watch liquidity and blocks. Experts also weigh the rent your next roll is likely to owe and pay up for a finished ward. Personalities tilt those weights: bankers hoard, collectors finish sets, traders offer for the missing deed.</p>
      </article>
      <button className="btn" type="button" onClick={onBack}>Back</button>
    </main>
  );
}

function SettingsScreen({ prefs, onChange, onBack }: { prefs: Prefs; onChange: (p: Prefs) => void; onBack: () => void }) {
  const set = (patch: Partial<Prefs>) => onChange({ ...prefs, ...patch });
  return (
    <main className="screen">
      <h2 className="wordmark" style={{ fontSize: "2.6rem", margin: 0 }}>Settings</h2>
      <div className="panel">
        <label className="checkline"><input type="checkbox" checked={prefs.theme === "day"} onChange={(e) => set({ theme: e.target.checked ? "day" : "night" })} /> Day ledger</label>
        <label className="checkline"><input type="checkbox" checked={prefs.contrast} onChange={(e) => set({ contrast: e.target.checked })} /> High contrast</label>
        <label className="checkline"><input type="checkbox" checked={prefs.colorblind} onChange={(e) => set({ colorblind: e.target.checked })} /> Patterns on ward colors</label>
        <label className="checkline"><input type="checkbox" checked={prefs.reducedMotion} onChange={(e) => set({ reducedMotion: e.target.checked })} /> Reduced motion</label>
        <label className="checkline"><input type="checkbox" checked={prefs.fastAi} onChange={(e) => set({ fastAi: e.target.checked })} /> Brisk rival turns</label>
        <label className="checkline"><input type="checkbox" checked={prefs.explainAi} onChange={(e) => set({ explainAi: e.target.checked })} /> Show why a rival acted</label>
        <label className="checkline"><input type="checkbox" checked={prefs.handoff} onChange={(e) => set({ handoff: e.target.checked })} /> Pass-and-play handoff</label>
        <label className="checkline"><input type="checkbox" checked={prefs.muted} onChange={(e) => set({ muted: e.target.checked })} /> Mute</label>
        <label className="muted">Interface scale
          <select className="select" value={prefs.scale} onChange={(e) => set({ scale: e.target.value as Prefs["scale"] })}>
            <option value="sm">Compact</option>
            <option value="md">Comfortable</option>
            <option value="lg">Large</option>
          </select>
        </label>
        <label className="muted">Effects {Math.round(prefs.sfx * 100)}
          <input className="textin" type="range" min={0} max={1} step={0.05} value={prefs.sfx} onChange={(e) => set({ sfx: Number(e.target.value) })} />
        </label>
        <label className="muted">Harbor tone {Math.round(prefs.music * 100)}
          <input className="textin" type="range" min={0} max={1} step={0.05} value={prefs.music} onChange={(e) => set({ music: Number(e.target.value) })} />
        </label>
      </div>
      <button className="btn" type="button" onClick={onBack}>Back</button>
    </main>
  );
}

function Tournament({ onBack }: { onBack: () => void }) {
  const [count, setCount] = useState(4);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [rows, setRows] = useState<TourneyRow[]>(loadTourney());
  const [last, setLast] = useState<string[]>([]);
  const lineup: PlayerSetup[] = freshDraft("tournament").map((p) => ({
    name: `${p.name} (${p.difficulty})`,
    human: false,
    token: p.token,
    difficulty: p.difficulty,
    personality: p.personality,
  }));

  function run() {
    setRunning(true);
    setDone(0);
    setLast([]);
    const board = new Map<string, TourneyRow>(loadTourney().map((r) => [r.name, { ...r }]));
    let i = 0;
    const notes: string[] = [];
    const step = () => {
      if (i >= count) {
        const next = [...board.values()].sort((a, b) => b.wins - a.wins || b.net - a.net);
        saveTourney(next);
        setRows(next);
        setLast(notes);
        setRunning(false);
        return;
      }
      const match = createGame({
        players: lineup,
        seed: 1000 + i * 17 + count,
        rules: makeRules({ roundLimit: 8 }),
        mode: "tournament",
      });
      const played = playUntilDone(match, 7000);
      const table = standings(played.state);
      const winner = table.find((r) => r.id === played.state.winnerId);
      notes.push(`${winner?.name ?? "No one"} after ${played.state.round} rounds`);
      for (const row of table) {
        const prev = board.get(row.name) ?? { name: row.name, wins: 0, matches: 0, net: 0 };
        prev.matches += 1;
        prev.net += row.netWorth;
        if (row.id === played.state.winnerId) prev.wins += 1;
        board.set(row.name, prev);
      }
      i += 1;
      setDone(i);
      window.setTimeout(step, 20);
    };
    window.setTimeout(step, 20);
  }

  return (
    <main className="screen">
      <h2 className="wordmark" style={{ fontSize: "2.6rem", margin: 0 }}>Tournament</h2>
      <p className="muted">Four rivals play sprint matches of eight rounds. Highest net worth takes a short table. This is simulated here, not online.</p>
      <label className="muted">Matches
        <input className="textin" type="number" min={1} max={12} value={count} onChange={(e) => setCount(Number(e.target.value))} />
      </label>
      <button className="btn primary" type="button" disabled={running} onClick={run}>{running ? `Playing ${done}/${count}` : "Run series"}</button>
      {last.map((line) => <p key={line}>{line}</p>)}
      <div className="panel">
        <div className="eyebrow">Local board</div>
        {rows.length === 0 && <p className="muted">No series yet.</p>}
        {rows.map((row) => (
          <p key={row.name}>{row.name} · {row.wins} wins in {row.matches}</p>
        ))}
      </div>
      <button className="btn" type="button" onClick={onBack}>Back</button>
    </main>
  );
}


