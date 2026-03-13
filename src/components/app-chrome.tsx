"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { AppPageNav } from "@/components/app-page-nav";

import styles from "./app-chrome.module.css";

function buildUserInitials(userName: string | null | undefined): string {
  const value = userName?.trim() ?? "";
  if (!value) {
    return "MB";
  }

  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0]?.slice(0, 2).toUpperCase() ?? "MB";
  }

  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase() || "MB";
}

export function AppChrome({
  title,
  subtitle,
  statusLine,
  headerActions,
  children,
  userName,
  onSignOut,
  contentClassName,
}: {
  title: string;
  subtitle?: ReactNode;
  statusLine?: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
  userName?: string | null;
  onSignOut?: () => void | Promise<void>;
  contentClassName?: string;
}) {
  const router = useRouter();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const resolvedUserName = userName?.trim() || "Signed in";
  const userInitials = useMemo(() => buildUserInitials(userName), [userName]);

  useEffect(() => {
    if (!isUserMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        userMenuRef.current?.contains(event.target)
      ) {
        return;
      }

      setIsUserMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsUserMenuOpen(false);
      }
    }

    function handleResize() {
      setIsUserMenuOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isUserMenuOpen]);

  async function handleSignOut() {
    setIsUserMenuOpen(false);

    if (onSignOut) {
      await onSignOut();
      return;
    }

    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/signin");
    router.refresh();
  }

  return (
    <main className={styles.page}>
      <header className={styles.appBar}>
        <div className={styles.appBrand}>
          <Image
            alt="MeadowBrook"
            className={styles.appLogo}
            height={136}
            priority
            src="/mb-logo.png"
            width={478}
          />
        </div>
        <nav aria-label="Primary" className={styles.appNav}>
          <AppPageNav
            activeClassName={styles.appNavLinkActive}
            linkClassName={styles.appNavLink}
          />
        </nav>
        <div className={styles.appBarActions}>
          <div className={styles.userMenu} ref={userMenuRef}>
            <button
              aria-expanded={isUserMenuOpen}
              aria-haspopup="menu"
              className={styles.userMenuTrigger}
              onClick={(event) => {
                event.stopPropagation();
                setIsUserMenuOpen((current) => !current);
              }}
              type="button"
            >
              <span className={styles.avatar}>{userInitials}</span>
              <span className={styles.userName}>{resolvedUserName}</span>
              <span className={styles.chevron} aria-hidden="true">
                ▾
              </span>
            </button>
            {isUserMenuOpen ? (
              <div className={styles.dropdownMenu} role="menu">
                <div className={styles.dropdownMenuHeader}>
                  <strong>{resolvedUserName}</strong>
                  <span>Signed in</span>
                </div>
                <button className={styles.dropdownMenuAction} onClick={() => void handleSignOut()} type="button">
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <section className={styles.pageHeader}>
        <div className={styles.pageHeaderCopy}>
          <h1 className={styles.title}>{title}</h1>
          {subtitle ? <div className={styles.subtitle}>{subtitle}</div> : null}
          {statusLine ? <div className={styles.statusLine}>{statusLine}</div> : null}
        </div>
        {headerActions ? <div className={styles.pageHeaderActions}>{headerActions}</div> : null}
      </section>

      <div className={[styles.content, contentClassName].filter(Boolean).join(" ")}>{children}</div>
    </main>
  );
}
