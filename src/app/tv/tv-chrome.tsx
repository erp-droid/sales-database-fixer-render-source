import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import styles from "./tv.module.css";

type TvChromeActive = "dashboard" | "accounts";

const appVersion = (process.env.NEXT_PUBLIC_APP_VERSION || "3.1.1").trim();
const appBuild = (process.env.NEXT_PUBLIC_APP_BUILD || "").trim();
const appVersionLabel = appBuild
  ? `Version ${appVersion} (${appBuild})`
  : `Version ${appVersion}`;

const NAV_ITEMS: Array<{
  href: string;
  label: string;
  icon: "dashboard" | "accounts" | "map" | "calendar" | "mail" | "quality" | "audit" | "deletions";
  key: TvChromeActive | "map" | "calendar" | "mail" | "quality" | "audit" | "deletions";
}> = [
  { href: "/tv/dashboard", label: "Dashboard", icon: "dashboard", key: "dashboard" },
  { href: "/tv/accounts", label: "Accounts", icon: "accounts", key: "accounts" },
  { href: "/map", label: "Map view", icon: "map", key: "map" },
  { href: "/calendar", label: "Calendar", icon: "calendar", key: "calendar" },
  { href: "/mail", label: "Mail", icon: "mail", key: "mail" },
  { href: "/quality", label: "Data quality", icon: "quality", key: "quality" },
  { href: "/audit", label: "Audit", icon: "audit", key: "audit" },
  { href: "/deletions", label: "Deletion queue", icon: "deletions", key: "deletions" },
];

function buildUserInitials(userName: string): string {
  const value = userName.trim();
  if (!value) {
    return "JS";
  }

  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0]?.slice(0, 2).toUpperCase() ?? "JS";
  }

  return `${parts[0]?.[0] ?? ""}${parts[parts.length - 1]?.[0] ?? ""}`.toUpperCase() || "JS";
}

function TvNavIcon({
  className,
  icon,
}: {
  className: string;
  icon: (typeof NAV_ITEMS)[number]["icon"];
}) {
  if (icon === "accounts") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
        <path d="M5 21V5.5L13 3v18" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="M13 9h6v12" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="M8 8h2M8 12h2M8 16h2M16 13h1.5M16 17h1.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }

  if (icon === "map") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
        <path d="m9 18-5 2V6l5-2 6 2 5-2v14l-5 2-6-2Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="M9 4v14M15 6v14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }

  if (icon === "mail") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
        <rect height="13" rx="2" stroke="currentColor" strokeWidth="1.8" width="17" x="3.5" y="5.5" />
        <path d="m5.25 8 6.75 5 6.75-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    );
  }

  if (icon === "calendar") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
        <rect height="15" rx="2" stroke="currentColor" strokeWidth="1.8" width="17" x="3.5" y="5" />
        <path d="M3.5 9.5h17" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 3v4M16 3v4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        <path d="M7.5 13h3M7.5 16.5h3M13.5 13h3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }

  if (icon === "quality") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
        <path d="m5 13 4 4L19 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
        <path d="M4.5 4.5h15v15h-15v-15Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    );
  }

  if (icon === "audit") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
        <path d="M8 6h9M8 11h9M8 16h5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        <path d="M5 6h.01M5 11h.01M5 16h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2.6" />
      </svg>
    );
  }

  if (icon === "deletions") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
        <path d="M6 7h12M8 7v12h8V7M10 7V5h4v2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="M10.5 11v4M13.5 11v4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="M4 5.5h7v6H4v-6ZM13 5.5h7v4h-7v-4ZM13 11.5h7v7h-7v-7ZM4 13.5h7v5H4v-5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

export function TvChrome({
  active,
  children,
  headerActions,
  subtitle,
  title,
  userName,
}: {
  active: TvChromeActive;
  children: ReactNode;
  headerActions?: ReactNode;
  subtitle?: ReactNode;
  title: string;
  userName: string;
}) {
  const resolvedUserName = userName.trim() || "jserrano";

  return (
    <main className={styles.page}>
      <header className={styles.appBar}>
        <div className={styles.brandBlock}>
          <Image
            alt="MeadowBrook"
            className={styles.appLogo}
            height={136}
            priority
            src="/mb-logo.png"
            width={478}
          />
          <div className={styles.brandText}>
            <strong>Sales MeadowBrook</strong>
            <span className={styles.brandSubtitle}>Account Management Platform</span>
            <span className={styles.appVersion}>{appVersionLabel}</span>
          </div>
        </div>

        <div className={styles.tvSearch}>TV-safe dashboard view</div>

        <div className={styles.userBadge} aria-label={`Signed in as ${resolvedUserName}`}>
          <span className={styles.avatar}>{buildUserInitials(resolvedUserName)}</span>
          <span>{resolvedUserName}</span>
        </div>
      </header>

      <div className={styles.shellBody}>
        <aside className={styles.sidebar}>
          <nav aria-label="Primary" className={styles.appNav}>
            <span className={styles.appNavSectionLabel}>Overview</span>
            {NAV_ITEMS.map((item) => {
              const isCurrent = item.key === active;
              return (
                <Link
                  aria-current={isCurrent ? "page" : undefined}
                  className={`${styles.appNavLink} ${isCurrent ? styles.appNavLinkActive : ""}`}
                  href={item.href}
                  key={item.href}
                >
                  <TvNavIcon className={styles.appNavIcon} icon={item.icon} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className={styles.mainPane}>
          <section className={styles.pageHeader}>
            <div className={styles.pageHeaderCopy}>
              <h1 className={styles.pageTitle}>{title}</h1>
              {subtitle ? <div className={styles.pageSubtitle}>{subtitle}</div> : null}
            </div>
            {headerActions ? <div className={styles.pageHeaderActions}>{headerActions}</div> : null}
          </section>

          <div className={styles.content}>{children}</div>
        </div>
      </div>
    </main>
  );
}
