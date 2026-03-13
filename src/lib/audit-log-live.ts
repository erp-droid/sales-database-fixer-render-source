type AuditLogLiveEvent = {
  type: "changed";
  at: string;
  reason: string;
};

type AuditLogListener = (event: AuditLogLiveEvent) => void;

let nextListenerId = 1;
const listeners = new Map<number, AuditLogListener>();

export function subscribeToAuditLog(listener: AuditLogListener): () => void {
  const id = nextListenerId;
  nextListenerId += 1;
  listeners.set(id, listener);

  return () => {
    listeners.delete(id);
  };
}

export function publishAuditLogChanged(reason: string): void {
  const event: AuditLogLiveEvent = {
    type: "changed",
    at: new Date().toISOString(),
    reason,
  };

  for (const listener of listeners.values()) {
    listener(event);
  }
}
