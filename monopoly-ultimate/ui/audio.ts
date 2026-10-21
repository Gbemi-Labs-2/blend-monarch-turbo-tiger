import type { Prefs } from "./storage.ts";

let ctx: AudioContext | null = null;
let padTimer = 0;
let padNodes: { stop: () => void } | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

export function unlockAudio() {
  const audio = context();
  if (audio?.state === "suspended") void audio.resume();
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0) {
  const audio = context();
  if (!audio) return;
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.value = gain;
  osc.connect(amp);
  amp.connect(audio.destination);
  const t = audio.currentTime + when;
  osc.start(t);
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.stop(t + dur + 0.02);
}

export function sfx(kind: "click" | "dice" | "coin" | "card" | "jail" | "win" | "no", prefs: Prefs) {
  if (prefs.muted || prefs.sfx <= 0 || prefs.master <= 0) return;
  unlockAudio();
  const g = prefs.master * prefs.sfx * 0.08;
  if (kind === "click") tone(520, 0.06, "triangle", g);
  if (kind === "dice") {
    tone(180, 0.08, "square", g);
    tone(240, 0.09, "square", g * 0.7, 0.07);
  }
  if (kind === "coin") {
    tone(880, 0.08, "sine", g);
    tone(1320, 0.12, "sine", g * 0.6, 0.06);
  }
  if (kind === "card") tone(420, 0.14, "triangle", g);
  if (kind === "jail") tone(110, 0.22, "sawtooth", g * 0.6);
  if (kind === "win") {
    tone(523, 0.16, "triangle", g, 0);
    tone(659, 0.18, "triangle", g, 0.12);
    tone(784, 0.28, "triangle", g, 0.24);
  }
  if (kind === "no") tone(140, 0.12, "square", g * 0.5);
}

export function setMusic(on: boolean, prefs: Prefs) {
  padNodes?.stop();
  padNodes = null;
  window.clearInterval(padTimer);
  if (!on || prefs.muted || prefs.music <= 0 || prefs.master <= 0) return;
  const audio = context();
  if (!audio) return;
  const play = () => {
    if (prefs.muted) return;
    tone(196, 1.6, "sine", prefs.master * prefs.music * 0.015);
    tone(247, 1.8, "sine", prefs.master * prefs.music * 0.01, 0.4);
  };
  play();
  padTimer = window.setInterval(play, 4200);
  padNodes = { stop: () => window.clearInterval(padTimer) };
}
