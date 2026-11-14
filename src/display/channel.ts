import type { DisplayState } from '../domain/display';

/**
 * The register and the customer screen talk over a BroadcastChannel: both are
 * windows of the app on the same computer, so it works with no internet. The
 * screen says hello when it opens and the register answers with its state.
 */

const NAME = 'jwpos-customer-screen';

type Message = { type: 'hello' } | { type: 'state'; state: DisplayState };

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

export function displayReceiver(onState: (s: DisplayState) => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const ch = new BroadcastChannel(NAME);
  ch.onmessage = (e: MessageEvent<Message>) => {
    if (e.data?.type === 'state' && e.data.state?.v === 1) onState(e.data.state);
  };
  ch.postMessage({ type: 'hello' } satisfies Message);
  return () => ch.close();
}
