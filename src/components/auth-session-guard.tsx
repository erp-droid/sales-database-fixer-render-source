"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  fetchSessionCheckOutcome,
  shouldForceLogoutForApiResponse,
} from "@/lib/session-guard";

const SESSION_CHECK_INTERVAL_MS = 30_000;
const INITIAL_SESSION_CHECK_DELAY_MS = 5_000;
const SESSION_INVALID_CONFIRMATION_DELAY_MS = 750;
const FORCED_SIGN_OUT_BROADCAST_KEY = "businessAccounts.authSignedOutAt.v1";
const RECENT_SIGN_IN_STORAGE_KEY = "businessAccounts.authJustSignedInAt.v1";
const RECENT_SIGN_IN_GRACE_MS = 60_000;

function isPublicPath(pathname: string | null): boolean {
  return pathname === "/signin";
}

function resolveRequestPath(input: RequestInfo | URL): string | null {
  try {
    if (typeof input === "string") {
      const url = new URL(input, window.location.origin);
      return url.origin === window.location.origin ? url.pathname : null;
    }

    if (input instanceof URL) {
      return input.origin === window.location.origin ? input.pathname : null;
    }

    if (typeof Request !== "undefined" && input instanceof Request) {
      const url = new URL(input.url, window.location.origin);
      return url.origin === window.location.origin ? url.pathname : null;
    }
  } catch {
    return null;
  }

  return null;
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

function isWithinRecentSignInGrace(): boolean {
  try {
    const rawSignedInAt = window.sessionStorage.getItem(RECENT_SIGN_IN_STORAGE_KEY);
    const signedInAt = rawSignedInAt ? Number(rawSignedInAt) : 0;
    if (!Number.isFinite(signedInAt) || signedInAt <= 0) {
      return false;
    }

    const ageMs = Date.now() - signedInAt;
    if (ageMs >= 0 && ageMs < RECENT_SIGN_IN_GRACE_MS) {
      return true;
    }

    window.sessionStorage.removeItem(RECENT_SIGN_IN_STORAGE_KEY);
  } catch {
    // If storage is unavailable, fall through to normal session checks.
  }

  return false;
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
        const outcome = await fetchSessionCheckOutcome(originalFetch);

        if (cancelled || signingOutRef.current || outcome !== "unauthenticated") {
          return;
        }

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, SESSION_INVALID_CONFIRMATION_DELAY_MS);
        });

        if (cancelled || signingOutRef.current) {
          return;
        }

        const confirmedOutcome = await fetchSessionCheckOutcome(originalFetch);
        if (confirmedOutcome === "unauthenticated" && !isWithinRecentSignInGrace()) {
          await performForcedSignOut();
        }
      } catch {
        // Leave the user signed in on transient probe failures.
      } finally {
        sessionCheckInFlightRef.current = false;
      }
    }

    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      const requestPath = resolveRequestPath(input);
      const responsePayload =
        response.status === 401
          ? await response.clone().json().catch(() => null)
          : undefined;

      if (
        !cancelled &&
        !signingOutRef.current &&
        shouldForceLogoutForApiResponse(requestPath, response.status, responsePayload) &&
        !isWithinRecentSignInGrace() &&
        !isPublicPath(pathnameRef.current)
      ) {
        void performForcedSignOut();
      }

      return response;
    };

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
      window.fetch = originalFetch;
      window.clearTimeout(initialCheckId);
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisibilityChange);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pathname, router]);

  return null;
}
