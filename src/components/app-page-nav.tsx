"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const APP_NAV_ITEMS = [
  { href: "/accounts", label: "Accounts" },
  { href: "/map", label: "Map view" },
  { href: "/mail", label: "Mail" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/quotes", label: "Quotes" },
  { href: "/quality", label: "Data quality" },
  { href: "/audit", label: "Audit" },
  { href: "/deletions", label: "Deletion queue" },
] as const;

type AppPageNavProps = {
  activeClassName?: string;
  linkClassName: string;
};

export function AppPageNav({ activeClassName, linkClassName }: AppPageNavProps) {
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
      <Link
        aria-current={isCurrent ? "page" : undefined}
        className={className}
        href={item.href}
        key={item.href}
      >
        {item.label}
      </Link>
    );
  });
}
