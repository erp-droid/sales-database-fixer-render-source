"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { formatPhoneForTwilioDial } from "@/lib/phone";

import styles from "./twilio-call-provider.module.css";

type StartCallResponse = {
  callSid: string;
  sessionId?: string;
  callerDisplayName?: string;
  callerId?: string;
  userPhone?: string;
  targetPhone?: string;
};

type CallStatusResponse = {
  active: boolean;
  answered: boolean;
  endedAt: string | null;
  outcome: string;
  sessionId: string;
};

type StartCallContext = {
  sourcePage?: "accounts" | "map" | "tasks" | "quality";
  linkedBusinessAccountId?: string | null;
  linkedAccountRowKey?: string | null;
  linkedContactId?: number | null;
  linkedCompanyName?: string | null;
  linkedContactName?: string | null;
};

type TwilioCallContextValue = {
  startCall: (phone: string, label?: string, context?: StartCallContext) => Promise<void>;
  endCall: () => Promise<void>;
  isInitializing: boolean;
  activeLabel: string | null;
  error: string | null;
};

const TwilioCallContext = createContext<TwilioCallContextValue | null>(null);

function parseErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Calling is unavailable right now.";
  }

  const value = (payload as Record<string, unknown>).error;
  return typeof value === "string" && value.trim()
    ? value
    : "Calling is unavailable right now.";
}

async function startServerCall(
  phone: string,
  context?: StartCallContext,
): Promise<StartCallResponse> {
  const response = await fetch("/api/twilio/call", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: phone,
      context,
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    | StartCallResponse
    | { error?: string }
    | null;

  if (!response.ok || !payload || typeof (payload as StartCallResponse).callSid !== "string") {
    throw new Error(parseErrorMessage(payload));
  }

  return payload as StartCallResponse;
}

async function endServerCall(callSid: string): Promise<void> {
  const response = await fetch("/api/twilio/call", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      callSid,
    }),
  });
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;

  if (!response.ok) {
    throw new Error(parseErrorMessage(payload));
  }
}

export function TwilioCallProvider({ children }: { children: ReactNode }) {
  const [callSid, setCallSid] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startCall(
    phone: string,
    label?: string,
    context?: StartCallContext,
  ): Promise<void> {
    const dialTarget = formatPhoneForTwilioDial(phone);
    if (!dialTarget) {
      setError("This phone number cannot be called yet.");
      return;
    }

    setError(null);
    setIsInitializing(true);
    setActiveLabel(label ?? phone);
    setStatusText("Calling your phone...");

    try {
      if (callSid) {
        await endServerCall(callSid);
      }

      const payload = await startServerCall(dialTarget, context);
      setCallSid(payload.callSid);
      setSessionId(payload.sessionId ?? null);
      setStatusText("Answer your phone to connect the call.");
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : "Calling failed.");
      setCallSid(null);
      setSessionId(null);
      setActiveLabel(null);
      setStatusText(null);
    } finally {
      setIsInitializing(false);
    }
  }

  async function endCall(): Promise<void> {
    const activeCallSid = callSid;
    setCallSid(null);
    setSessionId(null);
    setActiveLabel(null);
    setStatusText(null);

    if (!activeCallSid) {
      return;
    }

    try {
      await endServerCall(activeCallSid);
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : "Unable to hang up the call.");
    }
  }

  useEffect(() => {
    if (!sessionId || !activeLabel) {
      return;
    }

    const activeSessionId = sessionId;
    let cancelled = false;

    async function pollStatus() {
      try {
        const response = await fetch(
          `/api/twilio/call?sessionId=${encodeURIComponent(activeSessionId)}`,
          {
            cache: "no-store",
          },
        );
        const payload = (await response.json().catch(() => null)) as CallStatusResponse | null;
        if (!response.ok || !payload || cancelled) {
          return;
        }

        if (payload.active) {
          setStatusText(
            payload.answered
              ? "Call connected."
              : "Answer your phone to connect the call.",
          );
          return;
        }

        setCallSid(null);
        setSessionId(null);
        setActiveLabel(null);
        setStatusText(null);
      } catch {
        // Ignore transient polling failures and keep the current dock state.
      }
    }

    void pollStatus();
    const intervalId = window.setInterval(() => {
      void pollStatus();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeLabel, sessionId]);

  return (
    <TwilioCallContext.Provider
      value={{
        startCall,
        endCall,
        isInitializing,
        activeLabel,
        error,
      }}
    >
      {children}
      {activeLabel ? (
        <div className={styles.dock}>
          <div className={styles.statusRow}>
            <div>
              <p className={styles.statusLabel}>{activeLabel}</p>
              <p className={styles.statusMeta}>
                {statusText ?? "Answer your phone to connect the call."}
              </p>
            </div>
            <button
              className={styles.hangupButton}
              onClick={() => {
                void endCall();
              }}
              type="button"
            >
              Hang up
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className={`${styles.dock} ${styles.error}`}>
          <div className={styles.statusRow}>
            <div>
              <p className={styles.statusLabel}>Call failed</p>
              <p className={styles.statusMeta}>{error}</p>
            </div>
            <button
              aria-label="Dismiss call error"
              className={styles.dismissButton}
              onClick={() => setError(null)}
              type="button"
            >
              x
            </button>
          </div>
        </div>
      ) : null}
    </TwilioCallContext.Provider>
  );
}

export function useTwilioCall(): TwilioCallContextValue {
  const context = useContext(TwilioCallContext);
  if (!context) {
    throw new Error("useTwilioCall must be used within TwilioCallProvider.");
  }

  return context;
}
