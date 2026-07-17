"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import styles from "@/app/signin/signin.module.css";

const RESET_TIMEOUT_MS = 20_000;

export function ForgotPasswordForm({ initialUsername }: { initialUsername: string }) {
  const [username, setUsername] = useState(initialUsername);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), RESET_TIMEOUT_MS);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username }),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Password reset could not be requested.");
      }

      setMessage(
        payload?.message ??
          "If that username matches a MeadowBrook account, password-reset instructions will arrive at the email address on file.",
      );
    } catch (submitError) {
      const isAbortError =
        submitError instanceof Error && submitError.name === "AbortError";
      setError(
        isAbortError
          ? "The request took too long. Please try again."
          : submitError instanceof Error
            ? submitError.message
            : "Password reset could not be requested.",
      );
    } finally {
      window.clearTimeout(timeoutId);
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <form className={styles.form} onSubmit={onSubmit}>
        <label className={styles.label}>
          Username or MeadowBrook email
          <input
            autoComplete="username"
            autoFocus
            className={styles.input}
            disabled={isSubmitting}
            maxLength={254}
            name="username"
            onChange={(event) => setUsername(event.target.value)}
            required
            value={username}
          />
        </label>

        {message ? (
          <p aria-live="polite" className={styles.success}>
            {message}
          </p>
        ) : null}
        {error ? (
          <p aria-live="assertive" className={styles.error}>
            {error}
          </p>
        ) : null}

        <button className={styles.submit} disabled={isSubmitting} type="submit">
          {isSubmitting ? "Sending..." : "Send reset email"}
        </button>
      </form>

      <Link className={styles.backLink} href="/signin">
        Back to sign in
      </Link>
    </>
  );
}
