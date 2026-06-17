"use client";

import { useEffect, useRef } from "react";

import {
  readDeployCommit,
  shouldReloadForDeployVersion,
} from "@/lib/deploy-refresh";

const DEPLOY_CHECK_INTERVAL_MS = 60_000;
const DEPLOY_CHECK_INITIAL_DELAY_MS = 20_000;
const ACTIVE_INPUT_GRACE_MS = 20_000;
const FORCE_RELOAD_AFTER_MS = 5 * 60_000;
const MIN_RELOAD_RETRY_MS = 45_000;
const DEPLOY_REFRESH_BROADCAST_KEY = "businessAccounts.deployRefreshCommit.v1";
const DEPLOY_REFRESH_LAST_RELOAD_KEY = "businessAccounts.deployRefreshLastReload.v1";

type DeployRefreshGuardProps = {
  currentCommit: string | null;
};

function readNow(): number {
  return Date.now();
}

function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.isContentEditable) {
    return true;
  }

  const tagName = element.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function readLastReloadAt(): number | null {
  try {
    const value = window.sessionStorage.getItem(DEPLOY_REFRESH_LAST_RELOAD_KEY);
    if (!value) {
      return null;
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  } catch {
    return null;
  }
}

function writeLastReloadAt(value: number): void {
  try {
    window.sessionStorage.setItem(DEPLOY_REFRESH_LAST_RELOAD_KEY, String(value));
  } catch {
    // Session storage is best effort; reload still works without it.
  }
}

function broadcastDeployCommit(commit: string): void {
  try {
    window.localStorage.setItem(
      DEPLOY_REFRESH_BROADCAST_KEY,
      JSON.stringify({ commit, seenAt: new Date().toISOString() }),
    );
  } catch {
    // Other tabs will still discover the deploy through their own polling.
  }
}

export function DeployRefreshGuard({ currentCommit }: DeployRefreshGuardProps) {
  const currentCommitRef = useRef(currentCommit);
  const pendingCommitRef = useRef<string | null>(null);
  const pendingSinceRef = useRef<number | null>(null);
  const lastUserInputAtRef = useRef(0);
  const reloadTimeoutRef = useRef<number | null>(null);
  const checkInFlightRef = useRef(false);

  useEffect(() => {
    currentCommitRef.current = currentCommit;
  }, [currentCommit]);

  useEffect(() => {
    if (!currentCommit) {
      return;
    }

    let cancelled = false;

    function clearReloadTimer(): void {
      if (reloadTimeoutRef.current !== null) {
        window.clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
    }

    function isReloadSafe(now: number): boolean {
      if (document.visibilityState === "hidden") {
        return true;
      }

      if (isEditableElement(document.activeElement)) {
        return false;
      }

      return now - lastUserInputAtRef.current >= ACTIVE_INPUT_GRACE_MS;
    }

    function reloadForDeploy(): void {
      const now = readNow();
      const lastReloadAt = readLastReloadAt();
      if (lastReloadAt !== null && now - lastReloadAt < MIN_RELOAD_RETRY_MS) {
        return;
      }

      writeLastReloadAt(now);
      window.location.reload();
    }

    function scheduleReload(): void {
      if (cancelled || !pendingCommitRef.current) {
        return;
      }

      const now = readNow();
      const pendingSince = pendingSinceRef.current ?? now;
      const forced = now - pendingSince >= FORCE_RELOAD_AFTER_MS;

      if (forced || isReloadSafe(now)) {
        reloadForDeploy();
        return;
      }

      clearReloadTimer();
      reloadTimeoutRef.current = window.setTimeout(scheduleReload, ACTIVE_INPUT_GRACE_MS);
    }

    function markPendingDeploy(commit: string): void {
      if (
        cancelled ||
        !shouldReloadForDeployVersion({
          currentCommit: currentCommitRef.current,
          latestCommit: commit,
        })
      ) {
        return;
      }

      if (pendingCommitRef.current !== commit) {
        pendingCommitRef.current = commit;
        pendingSinceRef.current = readNow();
        broadcastDeployCommit(commit);
      }

      scheduleReload();
    }

    async function checkDeployVersion(): Promise<void> {
      if (cancelled || checkInFlightRef.current) {
        return;
      }

      checkInFlightRef.current = true;

      try {
        const response = await fetch(`/api/health?deployCheck=${Date.now()}`, {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
          },
        });
        const payload = await response.json().catch(() => null);
        const latestCommit = readDeployCommit({
          headerCommit: response.headers.get("x-mb-runtime-git-commit"),
          payload,
        });

        if (latestCommit) {
          markPendingDeploy(latestCommit);
        }
      } catch {
        // A failed version check should not interrupt the user's current work.
      } finally {
        checkInFlightRef.current = false;
      }
    }

    function handleUserInput(): void {
      lastUserInputAtRef.current = readNow();
    }

    function handleVisibilityOrFocus(): void {
      if (pendingCommitRef.current) {
        scheduleReload();
        return;
      }

      void checkDeployVersion();
    }

    function handleStorage(event: StorageEvent): void {
      if (event.key !== DEPLOY_REFRESH_BROADCAST_KEY || !event.newValue) {
        return;
      }

      try {
        const payload = JSON.parse(event.newValue) as { commit?: unknown };
        const commit = readDeployCommit({ headerCommit: payload.commit as string | null });
        if (commit) {
          markPendingDeploy(commit);
        }
      } catch {
        return;
      }
    }

    const intervalId = window.setInterval(() => {
      void checkDeployVersion();
    }, DEPLOY_CHECK_INTERVAL_MS);
    const initialTimeoutId = window.setTimeout(() => {
      void checkDeployVersion();
    }, DEPLOY_CHECK_INITIAL_DELAY_MS);

    window.addEventListener("focus", handleVisibilityOrFocus);
    window.addEventListener("pageshow", handleVisibilityOrFocus);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    document.addEventListener("input", handleUserInput, true);
    document.addEventListener("change", handleUserInput, true);
    document.addEventListener("keydown", handleUserInput, true);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.clearTimeout(initialTimeoutId);
      clearReloadTimer();
      window.removeEventListener("focus", handleVisibilityOrFocus);
      window.removeEventListener("pageshow", handleVisibilityOrFocus);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      document.removeEventListener("input", handleUserInput, true);
      document.removeEventListener("change", handleUserInput, true);
      document.removeEventListener("keydown", handleUserInput, true);
    };
  }, [currentCommit]);

  return null;
}
