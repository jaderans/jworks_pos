import type { WheelSlice } from '../domain/wheel';
import { sliceUnderPointer, spinAngle } from '../domain/wheelSpin';

/**
 * The customer screen's sounds, made in the browser (Web Audio), so they work
 * offline with no files: the wheel's tick as each slice passes the pointer, an
 * upbeat tune while it spins, a fanfare for a prize, a "wah-wah" for Try again.
 * The owner's own files (Settings → Customer screen) can stand in for the tune
 * and the fanfare.
 *
 * Browsers only let a page play sound after someone clicks in it: the screen's
 * Full screen button, or the customer tapping the wheel, unlocks it.
 */

let ctx: AudioContext | null = null;

export function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  return ctx;
}

/** After a click: let this page play sound. True when it can. */
export async function unlockAudio(): Promise<boolean> {
  const c = audio();
  if (!c) return false;
  if (c.state !== 'running') await c.resume().catch(() => undefined);
  return c.state === 'running';
}

export const audioReady = (): boolean => audio()?.state === 'running';

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function bus(c: AudioContext, volume: number): GainNode {
  const g = c.createGain();
  g.gain.value = Math.max(0, Math.min(1, volume));
  g.connect(c.destination);
  return g;
}

function note(c: AudioContext, dest: AudioNode, o: { type: OscillatorType; midi: number; at: number; dur: number; gain: number; vibrato?: number }) {
  const osc = c.createOscillator();
  osc.type = o.type;
  osc.frequency.setValueAtTime(hz(o.midi), o.at);
  if (o.vibrato) {
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = o.vibrato;
    depth.gain.value = hz(o.midi) * 0.012;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(o.at);
    lfo.stop(o.at + o.dur + 0.05);
  }
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, o.at);
  g.gain.exponentialRampToValueAtTime(o.gain, o.at + 0.012);
  g.gain.setValueAtTime(o.gain, o.at + Math.max(0.012, o.dur - 0.06));
  g.gain.exponentialRampToValueAtTime(0.0001, o.at + o.dur);
  osc.connect(g).connect(dest);
  osc.start(o.at);
  osc.stop(o.at + o.dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext, dest: AudioNode, at: number, dur: number, gain: number, highpass: number) {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = highpass;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(at);
  src.stop(at + dur + 0.02);
}

/** The pointer's click as a slice goes past. */
function tick(c: AudioContext, dest: AudioNode, at: number) {
  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(2300, at);
  osc.frequency.exponentialRampToValueAtTime(800, at + 0.035);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.55, at + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
  osc.connect(g).connect(dest);
  osc.start(at);
  osc.stop(at + 0.06);
}

/**
 * When the ticks fall, in seconds from the start: each time a new slice comes
 * under the pointer. Early on the slices fly past, so ticks closer together
 * than `gap` merge into one.
 */
export function tickTimes(slices: readonly WheelSlice[], from: number, to: number, spinMs: number, gap = 0.04): number[] {
  const out: number[] = [];
  if (slices.length < 2 || spinMs <= 0) return out;
  let under = sliceUnderPointer(slices, from);
  for (let ms = 4; ms <= spinMs; ms += 4) {
    const s = sliceUnderPointer(slices, from + (to - from) * spinAngle(ms / spinMs));
    if (s === under) continue;
    under = s;
    const t = ms / 1000;
    if (!out.length || t - out[out.length - 1] >= gap) out.push(t);
  }
  return out;
}

/** An upbeat chiptune loop (C–G–Am–F at 150 bpm) for `seconds`, fading out as the wheel slows. */
function spinTune(c: AudioContext, dest: AudioNode, start: number, seconds: number) {
  const g = c.createGain();
  g.connect(dest);
  g.gain.setValueAtTime(1, start);
  g.gain.setValueAtTime(1, start + seconds * 0.62);
  g.gain.linearRampToValueAtTime(0.0001, start + seconds * 0.95);
  const eighth = 0.2;
  const chords = [
    { root: 48, notes: [72, 76, 79] },
    { root: 43, notes: [71, 74, 79] },
    { root: 45, notes: [69, 72, 76] },
    { root: 41, notes: [69, 72, 77] },
  ];
  const arp = [0, 1, 2, 1, 0, 1, 2, 1];
  for (let i = 0; i * eighth < seconds; i++) {
    const at = start + i * eighth;
    const chord = chords[Math.floor(i / 8) % chords.length];
    const step = i % 8;
    note(c, g, { type: 'square', midi: chord.notes[arp[step]] + (step >= 4 && step % 2 === 0 ? 12 : 0), at, dur: eighth * 0.9, gain: 0.06 });
    if (step % 2 === 0) note(c, g, { type: 'triangle', midi: chord.root + (step === 4 ? 7 : 0), at, dur: eighth * 1.6, gain: 0.22 });
    else noise(c, g, at, 0.04, 0.05, 7000);
    if (step === 0 || step === 4) {
      // A kick drum: a falling sine.
      const k = c.createOscillator();
      const kg = c.createGain();
      k.frequency.setValueAtTime(150, at);
      k.frequency.exponentialRampToValueAtTime(45, at + 0.14);
      kg.gain.setValueAtTime(0.5, at);
      kg.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      k.connect(kg).connect(g);
      k.start(at);
      k.stop(at + 0.18);
    }
  }
}

export interface SoundChoice {
  /** 0 to 1. */
  volume: number;
  /** The tune while it spins: the built-in one, none (ticks only), or the owner's file. */
  tune: 'built-in' | 'none' | Blob;
  /** For a prize: the built-in fanfare or the owner's file. */
  win: 'built-in' | Blob;
}

/** Play the owner's own sound file; returns a way to stop it. */
function playFile(blob: Blob, volume: number, fadeAfter?: number): () => void {
  const url = URL.createObjectURL(blob);
  const a = new Audio(url);
  a.volume = Math.max(0, Math.min(1, volume));
  void a.play().catch(() => undefined);
  let fade = 0;
  if (fadeAfter) {
    fade = window.setTimeout(() => {
      const t = window.setInterval(() => {
        a.volume = Math.max(0, a.volume - 0.06);
        if (a.volume <= 0.01) {
          window.clearInterval(t);
          a.pause();
        }
      }, 80);
    }, fadeAfter);
  }
  return () => {
    window.clearTimeout(fade);
    a.pause();
    URL.revokeObjectURL(url);
  };
}

/** The spin: the tune, and ticks in time with the slices passing. Returns a way to stop it. */
export function playSpin(slices: readonly WheelSlice[], turn: number, spinMs: number, s: SoundChoice, ticks = true): () => void {
  const c = audio();
  if (!c || c.state !== 'running') return () => undefined;
  const out = bus(c, s.volume);
  const start = c.currentTime + 0.05;
  // Ticks worked out ahead, when the wheel itself isn't here to tick as it turns (see playTick).
  if (ticks) for (const t of tickTimes(slices, 0, turn, spinMs)) tick(c, out, start + t);
  let stopFile = () => undefined as void;
  if (s.tune === 'built-in') spinTune(c, out, start, spinMs / 1000);
  else if (s.tune instanceof Blob) stopFile = playFile(s.tune, s.volume * 0.8, spinMs * 0.7);
  return () => {
    stopFile();
    out.gain.cancelScheduledValues(c.currentTime);
    out.gain.setValueAtTime(out.gain.value, c.currentTime);
    out.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.15);
    window.setTimeout(() => out.disconnect(), 400);
  };
}

let lastTick = 0;
let tickOut: GainNode | null = null;
/** One tick now, as the wheel on this screen passes a slice. Ticks closer than 35 ms merge. */
export function playTick(volume: number): void {
  const c = audio();
  if (!c || c.state !== 'running' || c.currentTime - lastTick < 0.035) return;
  lastTick = c.currentTime;
  // One output for every tick, so a spin doesn't leave hundreds of nodes behind.
  tickOut ??= bus(c, volume);
  tickOut.gain.value = Math.max(0, Math.min(1, volume));
  tick(c, tickOut, c.currentTime + 0.005);
}

/** Where it lands: a fanfare for a prize, a "wah-wah" for Try again. */
export function playLanding(won: boolean, s: SoundChoice): void {
  const c = audio();
  if (!c || c.state !== 'running') return;
  if (won && s.win instanceof Blob) {
    playFile(s.win, s.volume);
    return;
  }
  const out = bus(c, s.volume);
  const at = c.currentTime + 0.03;
  if (won) {
    [67, 72, 76, 79].forEach((m, i) => {
      note(c, out, { type: 'square', midi: m, at: at + i * 0.11, dur: 0.12, gain: 0.12 });
      note(c, out, { type: 'triangle', midi: m, at: at + i * 0.11, dur: 0.12, gain: 0.2 });
    });
    for (const m of [72, 76, 79, 84]) note(c, out, { type: 'triangle', midi: m, at: at + 0.46, dur: 1.1, gain: 0.16, vibrato: 5.5 });
    note(c, out, { type: 'square', midi: 84, at: at + 0.46, dur: 1.1, gain: 0.05 });
    [96, 100, 103, 108, 103, 108].forEach((m, i) => note(c, out, { type: 'sine', midi: m, at: at + 0.55 + i * 0.07, dur: 0.1, gain: 0.07 }));
  } else {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1300;
    lp.connect(out);
    [67, 66, 65].forEach((m, i) => note(c, lp, { type: 'sawtooth', midi: m, at: at + i * 0.32, dur: 0.3, gain: 0.16 }));
    note(c, lp, { type: 'sawtooth', midi: 64, at: at + 0.96, dur: 1.0, gain: 0.16, vibrato: 6 });
  }
}

/** A bright "ding" when the wheel comes up for them to tap. */
export function playInvite(volume: number): void {
  const c = audio();
  if (!c || c.state !== 'running') return;
  const out = bus(c, volume);
  const at = c.currentTime + 0.02;
  note(c, out, { type: 'sine', midi: 84, at, dur: 0.18, gain: 0.25 });
  note(c, out, { type: 'sine', midi: 91, at: at + 0.12, dur: 0.35, gain: 0.22 });
}
