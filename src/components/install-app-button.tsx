"use client";

import { useEffect, useState } from "react";

import styles from "@/app/install/install.module.css";

type InstallChoice = {
  outcome: "accepted" | "dismissed";
  platform: string;
};

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<InstallChoice>;
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches;
}

function isDesktopChrome(): boolean {
  const userAgent = window.navigator.userAgent;
  return /Chrome\//.test(userAgent) && !/(Edg|OPR)\//.test(userAgent);
}

export function InstallAppButton() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isChrome, setIsChrome] = useState(true);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [showManualSteps, setShowManualSteps] = useState(false);

  useEffect(() => {
    const initialStateTimer = window.setTimeout(() => {
      setIsChrome(isDesktopChrome());
      setIsInstalled(isStandalone());
    }, 0);

    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        // Chrome's menu installation remains available if registration fails.
      });
    }

    function handleBeforeInstallPrompt(event: Event): void {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setShowManualSteps(false);
    }

    function handleInstalled(): void {
      setInstallPrompt(null);
      setIsInstalled(true);
      setIsInstalling(false);
      setShowManualSteps(false);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.clearTimeout(initialStateTimer);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function installApp(): Promise<void> {
    if (!installPrompt) {
      setShowManualSteps(true);
      return;
    }

    setIsInstalling(true);
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;

    setInstallPrompt(null);
    setIsInstalling(false);
    setIsInstalled(choice.outcome === "accepted");
    setShowManualSteps(choice.outcome !== "accepted");
  }

  if (isInstalled) {
    return (
      <p aria-live="polite" className={styles.installedMessage}>
        MeadowBrook CRM is installed. You can open it from your computer&apos;s apps.
      </p>
    );
  }

  return (
    <div className={styles.installActions}>
      <button
        className={styles.installButton}
        disabled={isInstalling}
        onClick={() => void installApp()}
        type="button"
      >
        {isInstalling ? "Opening Chrome installer…" : "Install MeadowBrook CRM"}
      </button>

      {!isChrome ? (
        <p className={styles.installNote} role="status">
          Open this page in Google Chrome, then select the install button again.
        </p>
      ) : null}

      {showManualSteps && isChrome ? (
        <p className={styles.installNote} role="status">
          In Chrome, open the <strong>⋮</strong> menu, choose <strong>Cast, save and share</strong>,
          then <strong>Install page as app…</strong>
        </p>
      ) : null}
    </div>
  );
}
