import type { DisplayState } from '../domain/display';

/**
 * The register and the customer screen talk over a BroadcastChannel: both are
 * windows of the app on the same computer, so it works with no internet. The
 * screen says hello when it opens and the register answers with its state.
 */

const NAME = 'jwpos-customer-screen';

/** An order called out loud: the customer screen shows it while the voice speaks. */
export interface DisplayCall {
  number: string;
  name: string;
  at: number;
}

/**
 * The photo booth on the customer screen. live: the camera in its frame (the
 * screen opens the same camera). countdown: 3, 2, 1. preview: the photo as a
 * sticker, with the question to keep it. kept: its number and what to do next.
 * The booth page repeats it every few seconds; the screen drops it when that stops.
 */
export interface BoothShow {
  stage: 'live' | 'countdown' | 'preview' | 'kept';
  camera: string;
  frame: string;
  mirror: boolean;
  count: number | null;
  photo: Blob | null;
  number: string | null;
  eventName: string;
  date: string;
  /** "from ₱100": what a sticker illustration of the photo starts at. */
  offer: string;
  at: number;
}

type Message = { type: 'hello' } | { type: 'state'; state: DisplayState } | { type: 'call'; call: DisplayCall } | { type: 'booth'; booth: BoothShow | null };

export interface DisplaySender {
  send(state: DisplayState): void;
  close(): void;
}

export function displaySender(): DisplaySender {
  if (typeof BroadcastChannel === 'undefined') return { send: () => undefined, close: () => undefined };
  const ch = new BroadcastChannel(NAME);
  let last: DisplayState | null = null;
  ch.onmessage = (e: MessageEvent<Message>) => {
    if (e.data?.type === 'hello' && last) ch.postMessage({ type: 'state', state: last } satisfies Message);
  };
  return {
    send(state) {
      last = state;
      ch.postMessage({ type: 'state', state } satisfies Message);
    },
    close: () => ch.close(),
  };
}

export function displayReceiver(onState: (s: DisplayState) => void, onCall?: (c: DisplayCall) => void, onBooth?: (b: BoothShow | null) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const ch = new BroadcastChannel(NAME);
  ch.onmessage = (e: MessageEvent<Message>) => {
    if (e.data?.type === 'state' && e.data.state?.v === 1) onState(e.data.state);
    if (e.data?.type === 'call' && e.data.call?.number) onCall?.(e.data.call);
    if (e.data?.type === 'booth') onBooth?.(e.data.booth ? { ...e.data.booth, at: Date.now() } : null);
  };
  ch.postMessage({ type: 'hello' } satisfies Message);
  return () => ch.close();
}

/** Show "Now calling" on the customer screen, from any page of the app on this computer. */
export function announceCall(call: Omit<DisplayCall, 'at'>): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const ch = new BroadcastChannel(NAME);
  ch.postMessage({ type: 'call', call: { ...call, at: Date.now() } } satisfies Message);
  ch.close();
}

/** The booth page's line to the customer screen. Answers a new screen's hello, and repeats itself so the screen knows it's still open. */
export function boothSender(): { send(b: BoothShow | null): void; close(): void } {
  if (typeof BroadcastChannel === 'undefined') return { send: () => undefined, close: () => undefined };
  const ch = new BroadcastChannel(NAME);
  let last: BoothShow | null = null;
  const post = () => ch.postMessage({ type: 'booth', booth: last } satisfies Message);
  ch.onmessage = (e: MessageEvent<Message>) => {
    if (e.data?.type === 'hello' && last) post();
  };
  const beat = window.setInterval(() => last && post(), 4000);
  return {
    send(b) {
      last = b;
      post();
    },
    close() {
      window.clearInterval(beat);
      last = null;
      post();
      ch.close();
    },
  };
}
