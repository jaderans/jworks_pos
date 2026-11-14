import { useCallback } from 'react';
import { useLocal } from '../hooks/data';
import { announceCall } from './channel';
import { DEFAULT_DISPLAY, type DisplaySettings } from './slides';

/**
 * Calling an order out loud at the booth: a two-note chime, then the
 * laptop's own English voice ("Order Q A zero seven, for Leanna. Your order
 * is ready."). It's the browser's built-in speech, so in Chrome and Edge on
 * Windows it works with no internet. It plays from the window that asks, so
 * the cashier's tap is what lets the browser make sound.
 */

const DIGIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** "QA-07" → "Q A zero seven": letters one by one and digits as words, so the voice can't misread it. */
export function spokenNumber(number: string): string {
  return number
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .split('')
    .map((c) => (/\d/.test(c) ? DIGIT[Number(c)] : c))
    .join(' ');
}

export function callText(number: string, name?: string): string {
  const first = (name ?? '').trim().split(/\s+/)[0];
  return `Order ${spokenNumber(number)}${first ? `, for ${first}` : ''}. Your order is ready. Please come to the counter.`;
}

/** A soft ding-dong, so people look up before the voice starts. */
export function chime(): Promise<void> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return Promise.resolve();
  const ctx = new Ctx();
  const note = (freq: number, at: number) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
    g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.9);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + at);
    o.stop(ctx.currentTime + at + 1);
  };
  note(880, 0);
  note(660, 0.35);
  return new Promise((done) => window.setTimeout(() => void ctx.close().then(done, done), 1300));
}

type VoiceLike = Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'localService'>;

/**
 * Women's English voices that sound natural, best first. Edge's "Natural"
 * voices (Rosa speaks Philippine English) and Google's need internet;
 * Windows' own Zira, Hazel and Susan work offline. Browsers don't say which
 * voices are women's, so they're known by name.
 */
const PREFERRED = [
  /Rosa.*Natural/i, /Aria.*Natural/i, /Jenny.*Natural/i, /Michelle.*Natural/i, /Ava.*Natural/i, /Emma.*Natural/i, /Sonia.*Natural/i, /Libby.*Natural/i, /Natasha.*Natural/i, /Natural.*Female/i,
  /Google US English/i, /Google UK English Female/i,
  /Zira/i, /Hazel/i, /Susan/i, /Samantha/i, /Karen/i, /Moira/i, /Tessa/i,
];
const rank = (v: VoiceLike) => {
  const i = PREFERRED.findIndex((re) => re.test(v.name));
  return i < 0 ? PREFERRED.length : i;
};

/** The laptop's English voices, the best women's voices first. */
export function rankVoices<V extends VoiceLike>(voices: readonly V[]): V[] {
  return voices.filter((v) => v.lang.toLowerCase().startsWith('en')).sort((a, b) => rank(a) - rank(b) || Number(b.localService) - Number(a.localService));
}

/** The voice to use: the one picked in Settings if it's here, else the best; offline, the best that works offline. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], chosen = '', online = true): V | null {
  const ranked = rankVoices(voices);
  const picked = chosen ? ranked.find((v) => v.name === chosen) : undefined;
  if (picked && (online || picked.localService)) return picked;
  return (online ? ranked[0] : ranked.find((v) => v.localService)) ?? ranked[0] ?? null;
}

/** The voices, once the browser has loaded them (Chrome loads them a moment after the page). */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  if (!synth) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((done) => {
    const finish = () => done(synth.getVoices());
    synth.addEventListener?.('voiceschanged', finish, { once: true });
    window.setTimeout(finish, 1500);
  });
}

function say(text: string, voice: SpeechSynthesisVoice | null): Promise<'done' | 'failed'> {
  return new Promise((done) => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? 'en-US';
    u.rate = 0.95;
    u.onend = () => done('done');
    u.onerror = () => done('failed');
    window.speechSynthesis.speak(u);
    // Some browsers never fire onend: don't hang.
    window.setTimeout(() => done('done'), 12_000);
  });
}

/** Say it in a natural woman's voice, falling back to one that works offline if the internet one can't. */
export async function speak(text: string, chosen = ''): Promise<void> {
  const synth = window.speechSynthesis;
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
  const voices = await loadVoices();
  const voice = pickVoice(voices, chosen, navigator.onLine);
  synth.cancel();
  if ((await say(text, voice)) === 'failed' && voice && !voice.localService) await say(text, pickVoice(voices, '', false));
}

/** Chime, then the call: twice, so people at the back hear it. */
export async function callOrder(number: string, name?: string, voice = ''): Promise<void> {
  const text = callText(number, name);
  await chime();
  await speak(text, voice);
  await speak(text, voice);
}

/**
 * Call an order: the voice from this window (the cashier's tap lets it play)
 * and "Now calling" on the customer screen. Off in Settings → Customer
 * screen, unless asked for again with Call.
 */
export function useCallOrder(): (number: string, name: string, again?: boolean) => void {
  const saved = useLocal<Partial<DisplaySettings>>('display', DEFAULT_DISPLAY);
  const { callOut: on, voice } = { ...DEFAULT_DISPLAY, ...(saved ?? {}) };
  return useCallback(
    (number: string, name: string, again = false) => {
      if (!on && !again) return;
      announceCall({ number, name: name.trim().split(/\s+/)[0] ?? '' });
      void callOrder(number, name, voice);
    },
    [on, voice],
  );
}
