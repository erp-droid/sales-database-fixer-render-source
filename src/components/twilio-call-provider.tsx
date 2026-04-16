"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { formatPhoneForDisplay, formatPhoneForTwilioDial } from "@/lib/phone";

import styles from "./twilio-call-provider.module.css";

type StartCallResponse = {
  callSid: string;
  sessionId?: string;
  callerDisplayName?: string;
  callerId?: string;
  userPhone?: string;
  targetPhone?: string;
  deduped?: boolean;
};

type CallStatusResponse = {
  active: boolean;
  answered: boolean;
  endedAt: string | null;
  outcome: string;
  sessionId: string;
  updatedAt?: string;
};

type CallerPhoneResponse = {
  phoneNumber?: string | null;
  error?: string;
};

type CallerVerificationResponse =
  | {
      status: "idle";
      phoneNumber: null;
    }
  | {
      status: "pending";
      phoneNumber: string;
      validationCode: string;
      callSid: string;
      updatedAt: string;
    }
  | {
      status: "verified";
      phoneNumber: string;
      verifiedAt: string | null;
      updatedAt: string;
    }
  | {
      status: "failed";
      phoneNumber: string;
      message: string;
      updatedAt: string;
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

const CALL_STATUS_POLL_INTERVAL_MS_INITIAL = 5_000;
const CALL_STATUS_POLL_INTERVAL_MS_ACTIVE = 15_000;
const CALL_STATUS_POLL_INTERVAL_MS_CONNECTED = 20_000;
const CALL_STATUS_POLL_BACKOFF_AFTER_MS = 30_000;
const CALL_STATUS_STALE_UNANSWERED_AFTER_MS = 2 * 60_000;
const CALL_STATUS_RECHECK_TIMEOUT_MS = 8_000;
const CALL_START_RECHECK_COOLDOWN_MS = 10_000;

const TwilioCallContext = createContext<TwilioCallContextValue | null>(null);

function buildCallNumberLines(
  userPhone: string | null,
  targetPhone: string | null,
  isInitializing: boolean,
): {
  userPhoneLine: string | null;
  targetPhoneLine: string | null;
} {
  const formattedUserPhone = formatPhoneForDisplay(userPhone);
  const formattedTargetPhone = formatPhoneForDisplay(targetPhone);

  return {
    userPhoneLine:
      formattedUserPhone
        ? `Your phone: ${formattedUserPhone}`
        : isInitializing && formattedTargetPhone
          ? "Your phone: resolving..."
          : null,
    targetPhoneLine: formattedTargetPhone ? `Calling: ${formattedTargetPhone}` : null,
  };
}

function parseErrorMessage(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Calling is unavailable right now.";
  }

  const value = (payload as Record<string, unknown>).error;
  return typeof value === "string" && value.trim()
    ? value
    : "Calling is unavailable right now.";
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message.toLowerCase().includes("aborted"))
  );
}

async function fetchJsonWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function startServerCall(
  phone: string,
  context?: StartCallContext,
): Promise<StartCallResponse> {
  let response: Response;
  try {
    response = await fetchJsonWithTimeout(
      "/api/twilio/call",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: phone,
          context,
        }),
      },
      20000,
    );
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(
        "Call setup timed out while resolving the signed-in employee phone. Please retry.",
      );
    }
    throw error;
  }
  const payload = (await response.json().catch(() => null)) as
    | StartCallResponse
    | { error?: string }
    | null;

  if (!response.ok || !payload || typeof (payload as StartCallResponse).callSid !== "string") {
    throw new Error(parseErrorMessage(payload));
  }

  return payload as StartCallResponse;
}

function isLikelyStaleUnansweredCall(status: CallStatusResponse): boolean {
  if (!status.active || status.answered) {
    return false;
  }

  const updatedAtMs = Date.parse(status.updatedAt ?? "");
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  return Date.now() - updatedAtMs >= CALL_STATUS_STALE_UNANSWERED_AFTER_MS;
}

async function readServerCallStatus(
  sessionId: string,
): Promise<CallStatusResponse | null> {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return null;
  }

  let response: Response;
  try {
    response = await fetchJsonWithTimeout(
      `/api/twilio/call?sessionId=${encodeURIComponent(normalizedSessionId)}`,
      {
        cache: "no-store",
      },
      CALL_STATUS_RECHECK_TIMEOUT_MS,
    );
  } catch {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as
    | CallStatusResponse
    | null;
  if (!response.ok || !payload || typeof payload.active !== "boolean") {
    return null;
  }

  return payload;
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

async function readCallerPhone(): Promise<string | null> {
  const response = await fetch("/api/twilio/caller-profile", {
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as CallerPhoneResponse | null;
  if (!response.ok) {
    return null;
  }

  return typeof payload?.phoneNumber === "string" && payload.phoneNumber.trim()
    ? payload.phoneNumber
    : null;
}

async function saveCallerPhone(phoneNumber: string): Promise<string> {
  const response = await fetch("/api/twilio/caller-profile", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      phoneNumber,
    }),
  });
  const payload = (await response.json().catch(() => null)) as CallerPhoneResponse | null;
  if (!response.ok || typeof payload?.phoneNumber !== "string" || !payload.phoneNumber.trim()) {
    throw new Error(parseErrorMessage(payload));
  }

  return payload.phoneNumber;
}

async function startCallerVerificationRequest(): Promise<CallerVerificationResponse> {
  const response = await fetch("/api/twilio/caller-verification", {
    method: "POST",
  });
  const payload = (await response.json().catch(() => null)) as
    | CallerVerificationResponse
    | { error?: string }
    | null;

  if (!response.ok || !payload || typeof (payload as { status?: string }).status !== "string") {
    throw new Error(parseErrorMessage(payload));
  }

  return payload as CallerVerificationResponse;
}

async function readCallerVerificationStatus(): Promise<CallerVerificationResponse | null> {
  const response = await fetch("/api/twilio/caller-verification", {
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as
    | CallerVerificationResponse
    | { error?: string }
    | null;

  if (!response.ok) {
    return null;
  }

  return payload && typeof (payload as { status?: string }).status === "string"
    ? (payload as CallerVerificationResponse)
    : null;
}

function shouldOfferCallerVerification(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("verify that employee number in twilio first") ||
    normalized.includes("cannot present") ||
    normalized.includes("caller id")
  );
}

function shouldOfferCallerPhoneSetup(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("signed-in employee phone") ||
    normalized.includes("phone can be read from acumatica") ||
    normalized.includes("call setup timed out while resolving") ||
    normalized.includes("your phone number is configured")
  );
}

export function TwilioCallProvider({ children }: { children: ReactNode }) {
  const [callSid, setCallSid] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [cachedCallerPhone, setCachedCallerPhone] = useState<string | null>(null);
  const [activeUserPhone, setActiveUserPhone] = useState<string | null>(null);
  const [activeTargetPhone, setActiveTargetPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callerVerification, setCallerVerification] = useState<CallerVerificationResponse | null>(null);
  const [isStartingCallerVerification, setIsStartingCallerVerification] = useState(false);
  const [isSavingCallerPhone, setIsSavingCallerPhone] = useState(false);
  const [lastCallRequest, setLastCallRequest] = useState<{
    phone: string;
    label?: string;
    context?: StartCallContext;
  } | null>(null);
  const statusPollFailureCountRef = useRef(0);
  const callStartedAtRef = useRef<number | null>(null);
  const lastStartRecheckAtRef = useRef(0);

  function clearActiveCallState(): void {
    setCallSid(null);
    setSessionId(null);
    setActiveLabel(null);
    setStatusText(null);
    setActiveUserPhone(null);
    setActiveTargetPhone(null);
    statusPollFailureCountRef.current = 0;
    callStartedAtRef.current = null;
    lastStartRecheckAtRef.current = 0;
  }

  useEffect(() => {
    let cancelled = false;

    void readCallerPhone()
      .then((phoneNumber) => {
        if (!cancelled) {
          setCachedCallerPhone(phoneNumber);
        }
      })
      .catch(() => undefined);
    void readCallerVerificationStatus()
      .then((verification) => {
        if (!cancelled && verification && verification.status !== "idle") {
          setCallerVerification(verification);
          if (verification.phoneNumber) {
            setCachedCallerPhone(verification.phoneNumber);
          }
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

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

    const normalizedActiveTarget = formatPhoneForTwilioDial(activeTargetPhone);
    if (isInitializing || callSid || sessionId || activeLabel) {
      if (normalizedActiveTarget && normalizedActiveTarget === dialTarget) {
        return;
      }

      if (!isInitializing && sessionId) {
        const now = Date.now();
        const startedAtMs = callStartedAtRef.current;
        const hasStaleLocalState =
          typeof startedAtMs === "number" &&
          Number.isFinite(startedAtMs) &&
          now - startedAtMs >= CALL_STATUS_STALE_UNANSWERED_AFTER_MS;
        if (!hasStaleLocalState) {
          setError("A call is already in progress. Hang up before starting another.");
          return;
        }

        if (now - lastStartRecheckAtRef.current < CALL_START_RECHECK_COOLDOWN_MS) {
          setError("A call is already in progress. Hang up before starting another.");
          return;
        }
        lastStartRecheckAtRef.current = now;

        const status = await readServerCallStatus(sessionId);
        if (status && (!status.active || isLikelyStaleUnansweredCall(status))) {
          clearActiveCallState();
        } else if (!status && hasStaleLocalState) {
          clearActiveCallState();
        } else {
          setError("A call is already in progress. Hang up before starting another.");
          return;
        }
      } else {
        setError("A call is already in progress. Hang up before starting another.");
        return;
      }
    }

    setLastCallRequest({
      phone,
      label,
      context,
    });
    setError(null);
    setCallerVerification(null);
    setIsInitializing(true);
    statusPollFailureCountRef.current = 0;
    callStartedAtRef.current = Date.now();
    setActiveLabel(label ?? phone);
    setStatusText("Calling your phone...");
    setActiveUserPhone(cachedCallerPhone);
    setActiveTargetPhone(dialTarget);

    try {
      if (callSid) {
        await endServerCall(callSid);
      }

      const payload = await startServerCall(dialTarget, context);
      setCallSid(payload.callSid);
      setSessionId(payload.sessionId ?? null);
      setActiveUserPhone(payload.userPhone ?? cachedCallerPhone ?? null);
      if (payload.userPhone) {
        setCachedCallerPhone(payload.userPhone);
      }
      setActiveTargetPhone(payload.targetPhone ?? dialTarget);
      setStatusText(
        payload.deduped
          ? "Call already in progress."
          : "Answer your phone to connect the call.",
      );
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : "Calling failed.");
      clearActiveCallState();
    } finally {
      setIsInitializing(false);
    }
  }

  async function beginCallerVerification(): Promise<void> {
    setIsStartingCallerVerification(true);
    setError(null);

    try {
      const verification = await startCallerVerificationRequest();
      setCallerVerification(verification);
      if (verification.phoneNumber) {
        setCachedCallerPhone(verification.phoneNumber);
      }
    } catch (verificationError) {
      setError(
        verificationError instanceof Error
          ? verificationError.message
          : "Unable to start phone verification.",
      );
    } finally {
      setIsStartingCallerVerification(false);
    }
  }

  async function configureCallerPhone(): Promise<void> {
    const initialValue = formatPhoneForDisplay(cachedCallerPhone) ?? "";
    const enteredPhone = window.prompt(
      "Enter the phone number Twilio should ring for you.",
      initialValue,
    );
    if (!enteredPhone?.trim()) {
      return;
    }

    setIsSavingCallerPhone(true);
    setError(null);

    try {
      const savedPhone = await saveCallerPhone(enteredPhone);
      setCachedCallerPhone(savedPhone);
      setActiveUserPhone(savedPhone);
      await beginCallerVerification();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save your phone number.",
      );
    } finally {
      setIsSavingCallerPhone(false);
    }
  }

  useEffect(() => {
    if (callerVerification?.status !== "pending") {
      return;
    }

    let cancelled = false;

    async function pollVerification(): Promise<void> {
      try {
        const verification = await readCallerVerificationStatus();
        if (!verification || cancelled) {
          return;
        }

        setCallerVerification(verification);
        if (verification.phoneNumber) {
          setCachedCallerPhone(verification.phoneNumber);
        }
      } catch {
        // Keep polling on transient failures.
      }
    }

    void pollVerification();
    const intervalId = window.setInterval(() => {
      void pollVerification();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [callerVerification]);

  useEffect(() => {
    if (!activeLabel || activeUserPhone || !cachedCallerPhone) {
      return;
    }

    setActiveUserPhone(cachedCallerPhone);
  }, [activeLabel, activeUserPhone, cachedCallerPhone]);

  useEffect(() => {
    if (!activeLabel || activeUserPhone) {
      return;
    }

    let cancelled = false;

    void readCallerPhone()
      .then((phoneNumber) => {
        if (cancelled || !phoneNumber) {
          return;
        }

        setCachedCallerPhone(phoneNumber);
        setActiveUserPhone(phoneNumber);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [activeLabel, activeUserPhone]);

  async function endCall(): Promise<void> {
    const activeCallSid = callSid;
    clearActiveCallState();

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
    let timeoutId: number | null = null;
    let lastKnownAnswered = false;

    function computeNextPollDelay(answered: boolean): number {
      if (answered) {
        return CALL_STATUS_POLL_INTERVAL_MS_CONNECTED;
      }

      const startedAt = callStartedAtRef.current;
      if (startedAt && Date.now() - startedAt >= CALL_STATUS_POLL_BACKOFF_AFTER_MS) {
        return CALL_STATUS_POLL_INTERVAL_MS_ACTIVE;
      }

      return CALL_STATUS_POLL_INTERVAL_MS_INITIAL;
    }

    function scheduleNextPoll(answered: boolean): void {
      if (cancelled) {
        return;
      }

      timeoutId = window.setTimeout(() => {
        void pollStatus();
      }, computeNextPollDelay(answered));
    }

    async function pollStatus() {
      try {
        const response = await fetch(
          `/api/twilio/call?sessionId=${encodeURIComponent(activeSessionId)}`,
          {
            cache: "no-store",
          },
        );
        const payload = (await response.json().catch(() => null)) as CallStatusResponse | null;
        if (cancelled) {
          return;
        }

        if (!response.ok || !payload) {
          statusPollFailureCountRef.current += 1;
          if (
            response.status === 401 ||
            response.status === 404 ||
            statusPollFailureCountRef.current >= 3
          ) {
            clearActiveCallState();
            setError("The previous call session could not be verified. You can start a new call.");
            return;
          }
          scheduleNextPoll(lastKnownAnswered);
          return;
        }

        statusPollFailureCountRef.current = 0;

        if (payload.active) {
          if (isLikelyStaleUnansweredCall(payload)) {
            clearActiveCallState();
            setError("The previous call attempt appears stale. You can start a new call.");
            return;
          }

          lastKnownAnswered = payload.answered;
          setStatusText(
            payload.answered
              ? "Call connected."
              : "Answer your phone to connect the call.",
          );
          scheduleNextPoll(payload.answered);
          return;
        }

        clearActiveCallState();
      } catch {
        statusPollFailureCountRef.current += 1;
        if (statusPollFailureCountRef.current >= 3) {
          clearActiveCallState();
          setError("The previous call session timed out. You can start a new call.");
          return;
        }

        scheduleNextPoll(lastKnownAnswered);
      }
    }

    void pollStatus();

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [activeLabel, sessionId]);

  const callNumberLines = buildCallNumberLines(
    activeUserPhone,
    activeTargetPhone,
    isInitializing,
  );
  const shouldShowVerifyAction = Boolean(error && shouldOfferCallerVerification(error));
  const shouldShowCallerPhoneSetup = Boolean(error && shouldOfferCallerPhoneSetup(error));
  const verificationPhoneLine =
    callerVerification?.phoneNumber
      ? `Phone to verify: ${formatPhoneForDisplay(callerVerification.phoneNumber)}`
      : null;

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
              {callNumberLines.userPhoneLine ? (
                <p className={styles.callNumbers}>{callNumberLines.userPhoneLine}</p>
              ) : null}
              {callNumberLines.targetPhoneLine ? (
                <p className={styles.callNumbers}>{callNumberLines.targetPhoneLine}</p>
              ) : null}
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
              {shouldShowVerifyAction ? (
                <div className={styles.actionRow}>
                  <button
                    className={styles.actionButton}
                    disabled={isStartingCallerVerification}
                    onClick={() => {
                      void beginCallerVerification();
                    }}
                    type="button"
                  >
                    {isStartingCallerVerification ? "Starting..." : "Verify my number"}
                  </button>
                </div>
              ) : null}
              {shouldShowCallerPhoneSetup ? (
                <div className={styles.actionRow}>
                  <button
                    className={styles.actionButton}
                    disabled={isSavingCallerPhone}
                    onClick={() => {
                      void configureCallerPhone();
                    }}
                    type="button"
                  >
                    {isSavingCallerPhone ? "Saving..." : "Set my phone"}
                  </button>
                </div>
              ) : null}
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
      {callerVerification && callerVerification.status !== "idle" ? (
        <div className={`${styles.dock} ${styles.verification}`}>
          <div>
            <p className={styles.statusLabel}>Verify your phone number</p>
            {callerVerification.status === "pending" ? (
              <>
                <p className={styles.statusMeta}>
                  Twilio is calling your employee phone now. Answer it and enter this code on the keypad.
                </p>
                <p className={styles.verificationCode}>{callerVerification.validationCode}</p>
              </>
            ) : null}
            {callerVerification.status === "verified" ? (
              <p className={styles.statusMeta}>
                Your employee phone number is now verified in Twilio. Retry the call.
              </p>
            ) : null}
            {callerVerification.status === "failed" ? (
              <p className={styles.statusMeta}>{callerVerification.message}</p>
            ) : null}
            {verificationPhoneLine ? (
              <p className={styles.callNumbers}>{verificationPhoneLine}</p>
            ) : null}
          </div>
          <div className={styles.actionRow}>
            {callerVerification.status === "pending" ? (
              <button
                className={styles.actionButton}
                onClick={() => {
                  void beginCallerVerification();
                }}
                type="button"
              >
                Call again
              </button>
            ) : null}
            {callerVerification.status === "failed" ? (
              <button
                className={styles.actionButton}
                onClick={() => {
                  void beginCallerVerification();
                }}
                type="button"
              >
                Try again
              </button>
            ) : null}
            {callerVerification.status === "verified" && lastCallRequest ? (
              <button
                className={styles.actionButton}
                onClick={() => {
                  void startCall(
                    lastCallRequest.phone,
                    lastCallRequest.label,
                    lastCallRequest.context,
                  );
                }}
                type="button"
              >
                Retry call
              </button>
            ) : null}
            <button
              className={styles.secondaryActionButton}
              onClick={() => setCallerVerification(null)}
              type="button"
            >
              Close
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
