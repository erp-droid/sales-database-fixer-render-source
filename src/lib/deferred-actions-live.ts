import { publishBusinessAccountChanged } from "@/lib/business-account-live";

type DeferredActionsLiveEvent = {
  type: "changed";
  at: string;
  reason: string;
};

type DeferredActionsListener = (event: DeferredActionsLiveEvent) => void;

let nextListenerId = 1;
const listeners = new Map<number, DeferredActionsListener>();

export function subscribeToDeferredActions(
  listener: DeferredActionsListener,
): () => void {
  const id = nextListenerId;
  nextListenerId += 1;
  listeners.set(id, listener);

  return () => {
    listeners.delete(id);
  };
}

export function publishDeferredActionsChanged(reason: string): void {
  const event: DeferredActionsLiveEvent = {
    type: "changed",
    at: new Date().toISOString(),
    reason,
  };

  for (const listener of listeners.values()) {
    listener(event);
  }

  // Keep account tables in sync across browsers when deferred visibility changes.
  publishBusinessAccountChanged({
    accountRecordId: "__deferred_actions__",
    businessAccountId: null,
    targetContactId: null,
    reason: "full-sync",
  });
}
