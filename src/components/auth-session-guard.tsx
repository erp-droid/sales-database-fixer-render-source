"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  fetchSessionCheckOutcome,
  shouldForceLogoutForApiResponse,
} from "@/lib/session-guard";

const SESSION_CHECK_INTERVAL_MS = 30_000;
const SESSION_INVALID_CONFIRMATION_DELAY_MS = 750;
const FORCED_SIGN_OUT_BROADCAST_KEY = "businessAccounts.authSignedOutAt.v1";

function isPublicPath(pathname: string | null): boolean {
  if (!pathname) {
    return false;
  }

  return pathname === "/signin" || pathname.startsWith("/onboarding");
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
        if (confirmedOutcome === "unauthenticated") {
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

      if (
        !cancelled &&
        !signingOutRef.current &&
        shouldForceLogoutForApiResponse(requestPath, response.status) &&
        !isPublicPath(pathnameRef.current)
      ) {
        void performForcedSignOut();
      }

      return response;
    };

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

    void checkSession();

    return () => {
      cancelled = true;
      window.fetch = originalFetch;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisibilityChange);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pathname, router]);

  return null;
}
