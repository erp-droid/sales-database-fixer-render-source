"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchSessionCheckOutcome } from "@/lib/session-guard";

const SESSION_CHECK_INTERVAL_MS = 15_000;
const INITIAL_SESSION_CHECK_DELAY_MS = 1_000;
const FORCED_SIGN_OUT_BROADCAST_KEY = "businessAccounts.authSignedOutAt.v1";

function isPublicPath(pathname: string | null): boolean {
  return (
    pathname === "/install" ||
    pathname === "/forgot-password" ||
    pathname === "/signin" ||
    pathname === "/tv" ||
    pathname?.startsWith("/tv/") === true
  );
}

function buildSignInHref(): string {
  const nextPath = `${window.location.pathname}${window.location.search}`.trim() || "/accounts";
  const params = new URLSearchParams();
  if (nextPath !== "/signin") {
    params.set("next", nextPath);
  }

  const query = params.toString();
  return query ? `/signin?${query}` : "/signin";
}

export function AuthSessionGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const signingOutRef = useRef(false);
  const sessionCheckInFlightRef = useRef(false);
  const pathnameRef = useRef<string | null>(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;

    if (isPublicPath(pathname)) {
      signingOutRef.current = false;
    }
  }, [pathname]);

  useEffect(() => {
    if (!pathname || isPublicPath(pathname)) {
      return;
    }

    let cancelled = false;
    const sessionFetch = window.fetch.bind(window);

    async function performForcedSignOut(): Promise<void> {
      if (cancelled || signingOutRef.current) {
        return;
      }

      signingOutRef.current = true;

      try {
        window.localStorage.setItem(
          FORCED_SIGN_OUT_BROADCAST_KEY,
          String(Date.now()),
        );
      } catch {
        // Ignore local storage failures and continue with logout.
      }

      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          keepalive: true,
        });
      } catch {
        // Clearing the local cookie is best effort before redirecting.
      }

      if (cancelled) {
        return;
      }

      router.replace(buildSignInHref());
      router.refresh();
    }

    async function checkSession(): Promise<void> {
      if (
        cancelled ||
        signingOutRef.current ||
        sessionCheckInFlightRef.current ||
        document.visibilityState === "hidden"
      ) {
        return;
      }

      sessionCheckInFlightRef.current = true;

      try {
        const outcome = await fetchSessionCheckOutcome(sessionFetch);

        if (cancelled || signingOutRef.current || outcome !== "unauthenticated") {
          return;
        }

        await performForcedSignOut();
      } catch {
        // Leave the user signed in on transient probe failures.
      } finally {
        sessionCheckInFlightRef.current = false;
      }
    }

    const initialCheckId = window.setTimeout(() => {
      void checkSession();
    }, INITIAL_SESSION_CHECK_DELAY_MS);
    const intervalId = window.setInterval(() => {
      void checkSession();
    }, SESSION_CHECK_INTERVAL_MS);

    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        void checkSession();
      }
    }

    function handleStorage(event: StorageEvent): void {
      if (
        event.key === FORCED_SIGN_OUT_BROADCAST_KEY &&
        event.newValue &&
        !isPublicPath(pathnameRef.current)
      ) {
        void performForcedSignOut();
      }
    }

    window.addEventListener("focus", handleVisibilityChange);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearTimeout(initialCheckId);
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisibilityChange);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pathname, router]);

  return null;
}
