"use client";

import { usePathname } from "next/navigation";

type AppNavIconName =
  | "accounts"
  | "map"
  | "mail"
  | "calendar"
  | "dashboard"
  | "quality"
  | "audit"
  | "deletions"
  | "support";

const APP_NAV_ITEMS: Array<{
  href: string;
  label: string;
  icon: AppNavIconName;
}> = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/accounts", label: "Accounts", icon: "accounts" },
  { href: "/map", label: "Map view", icon: "map" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/mail", label: "Mail", icon: "mail" },
  { href: "/quality", label: "Data quality", icon: "quality" },
  { href: "/support", label: "CRM support", icon: "support" },
  { href: "/audit", label: "Audit", icon: "audit" },
  { href: "/deletions", label: "Deletion queue", icon: "deletions" },
] as const;

type AppPageNavProps = {
  activeClassName?: string;
  iconClassName?: string;
  linkClassName: string;
};

function AppNavIcon({
  className,
  icon,
}: {
  className?: string;
  icon: AppNavIconName;
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

  if (icon === "dashboard") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
        <path d="M4 5.5h7v6H4v-6ZM13 5.5h7v4h-7v-4ZM13 11.5h7v7h-7v-7ZM4 13.5h7v5H4v-5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
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

  if (icon === "support") {
    return (
      <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
        <path d="M12 3.5a7.5 7.5 0 0 0-7.5 7.5v3.5A2.5 2.5 0 0 0 7 17h1v-6H4.5M12 3.5a7.5 7.5 0 0 1 7.5 7.5v3.5A2.5 2.5 0 0 1 17 17h-1v-6h3.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        <path d="M16 17c0 2-1.8 3.5-4 3.5h-1.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
        <circle cx="9.5" cy="20.5" fill="currentColor" r="1" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="M6 7h12M8 7v12h8V7M10 7V5h4v2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M10.5 11v4M13.5 11v4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

export function AppPageNav({ activeClassName, iconClassName, linkClassName }: AppPageNavProps) {
  const pathname = usePathname();

  return APP_NAV_ITEMS.map((item) => {
    const isCurrent =
      pathname === item.href ||
      pathname.startsWith(`${item.href}/`) ||
      (item.href === "/dashboard" && pathname.startsWith("/dashboard"));
    const className = [linkClassName, isCurrent ? activeClassName : null]
      .filter(Boolean)
      .join(" ");

    return (
      <a
        aria-current={isCurrent ? "page" : undefined}
        className={className}
        href={item.href}
        key={item.href}
      >
        {iconClassName ? <AppNavIcon className={iconClassName} icon={item.icon} /> : null}
        <span>{item.label}</span>
      </a>
    );
  });
}
