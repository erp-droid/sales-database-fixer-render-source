"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import styles from "@/app/signin/signin.module.css";

const REMEMBER_PASSWORD_STORAGE_KEY = "businessAccounts.rememberPassword.v1";
const COLUMN_PREF_RESET_STORAGE_KEY = "businessAccounts.resetColumnsOnNextLoad.v1";
const SESSION_CHECK_TIMEOUT_MS = 6000;
const LOGIN_TIMEOUT_MS = 35000;

type StoredCredentials = {
  username: string;
  password: string;
  remember: boolean;
};

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message.toLowerCase().includes("aborted"))
  );
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

export function SignInForm({
  initialError = null,
  nextPath,
}: {
  initialError?: string | null;
  nextPath: string;
}) {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberPassword, setRememberPassword] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
  const [error, setError] = useState<string | null>(initialError);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isActive = true;
    let sessionCheckSettled = false;
    const fallbackTimeout = window.setTimeout(() => {
      if (!isActive || sessionCheckSettled) {
        return;
      }

      sessionCheckSettled = true;
      setIsCheckingSession(false);
      setError((current) => current ?? "Session check took too long. You can still sign in.");
    }, SESSION_CHECK_TIMEOUT_MS + 1000);

    async function restoreSessionIfActive() {
      const response = await fetchWithTimeout(
        "/api/auth/session",
        { cache: "no-store" },
        SESSION_CHECK_TIMEOUT_MS,
      );
      const payload = (await response.json().catch(() => null)) as
        | { authenticated?: boolean; degraded?: boolean }
        | null;

      if (!isActive || sessionCheckSettled) {
        return;
      }

      sessionCheckSettled = true;
      window.clearTimeout(fallbackTimeout);

      if (response.ok && payload?.authenticated && !payload.degraded) {
        router.replace(nextPath);
        router.refresh();
        return;
      }

      setIsCheckingSession(false);
    }

    restoreSessionIfActive().catch(() => {
      // Ignore session-check errors on sign-in page.
      if (isActive && !sessionCheckSettled) {
        sessionCheckSettled = true;
        window.clearTimeout(fallbackTimeout);
        setIsCheckingSession(false);
      }
    });

    return () => {
      isActive = false;
      window.clearTimeout(fallbackTimeout);
    };
  }, [nextPath, router]);

  useEffect(() => {
    if (retryAfterSeconds <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setRetryAfterSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [retryAfterSeconds]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(REMEMBER_PASSWORD_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as Partial<StoredCredentials>;
      if (!parsed.remember) {
        return;
      }

      setUsername(typeof parsed.username === "string" ? parsed.username : "");
      setPassword(typeof parsed.password === "string" ? parsed.password : "");
      setRememberPassword(true);
    } catch {
      // Ignore invalid local storage payload.
    }
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (retryAfterSeconds > 0) {
      return;
    }

    setError(null);
    setIsCheckingSession(false);
    setIsSubmitting(true);

    try {
      const response = await fetchWithTimeout(
        "/api/auth/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ username, password }),
        },
        LOGIN_TIMEOUT_MS,
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;

        if (response.status === 429) {
          setRetryAfterSeconds(8);
        }

        throw new Error(payload?.error ?? "Sign-in failed.");
      }

      if (rememberPassword) {
        const stored: StoredCredentials = {
          username,
          password,
          remember: true,
        };
        window.localStorage.setItem(
          REMEMBER_PASSWORD_STORAGE_KEY,
          JSON.stringify(stored),
        );
      } else {
        window.localStorage.removeItem(REMEMBER_PASSWORD_STORAGE_KEY);
      }

      window.sessionStorage.setItem(COLUMN_PREF_RESET_STORAGE_KEY, "1");
      router.replace(nextPath);
      router.refresh();
    } catch (submitError) {
      if (isAbortError(submitError)) {
        setError("Sign-in timed out. Please retry.");
        return;
      }
      setError(submitError instanceof Error ? submitError.message : "Sign-in failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form action="/api/auth/login" className={styles.form} method="post" onSubmit={onSubmit}>
      <input name="next" type="hidden" value={nextPath} />
      <label className={styles.label}>
        Username
        <input
          autoComplete="username"
          className={styles.input}
          name="username"
          onChange={(event) => setUsername(event.target.value)}
          required
          value={username}
        />
      </label>

      <label className={styles.label}>
        Password
        <input
          autoComplete="current-password"
          className={styles.input}
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>

      <label className={styles.rememberRow}>
        <input
          checked={rememberPassword}
          className={styles.rememberCheckbox}
          onChange={(event) => setRememberPassword(event.target.checked)}
          type="checkbox"
        />
        Remember my password
      </label>

      <a
        className={styles.forgotPassword}
        href="/api/auth/forgot-password"
        rel="noopener noreferrer"
        target="_blank"
      >
        Forgot your password?
      </a>

      {error ? <p className={styles.error}>{error}</p> : null}
      {isCheckingSession ? (
        <p className={styles.hint}>
          Checking for an existing session in the background. You can still sign in now.
        </p>
      ) : null}

      <button
        className={styles.submit}
        disabled={isSubmitting || retryAfterSeconds > 0}
        type="submit"
      >
        {retryAfterSeconds > 0
          ? `Try again in ${retryAfterSeconds}s`
          : isSubmitting
            ? "Signing in..."
            : isCheckingSession
              ? "Continue to sign in"
              : "Sign in"}
      </button>
    </form>
  );
}
