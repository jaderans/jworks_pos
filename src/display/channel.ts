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

type Message = { type: 'hello' } | { type: 'state'; state: DisplayState } | { type: 'call'; call: DisplayCall };

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

export function displayReceiver(onState: (s: DisplayState) => void, onCall?: (c: DisplayCall) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const ch = new BroadcastChannel(NAME);
  ch.onmessage = (e: MessageEvent<Message>) => {
    if (e.data?.type === 'state' && e.data.state?.v === 1) onState(e.data.state);
    if (e.data?.type === 'call' && e.data.call?.number) onCall?.(e.data.call);
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
