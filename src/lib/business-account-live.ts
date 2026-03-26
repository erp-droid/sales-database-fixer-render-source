import type { BusinessAccountLiveEvent } from "@/types/business-account";

type BusinessAccountListener = (event: BusinessAccountLiveEvent) => void;

let nextListenerId = 1;
const listeners = new Map<number, BusinessAccountListener>();

export function subscribeToBusinessAccountLive(
  listener: BusinessAccountListener,
): () => void {
  const id = nextListenerId;
  nextListenerId += 1;
  listeners.set(id, listener);

  return () => {
    listeners.delete(id);
  };
}

export function publishBusinessAccountChanged(
  payload: Omit<BusinessAccountLiveEvent, "type" | "at">,
): void {
  const event: BusinessAccountLiveEvent = {
    type: "changed",
    at: new Date().toISOString(),
    ...payload,
  };

  for (const listener of listeners.values()) {
    listener(event);
  }
}
