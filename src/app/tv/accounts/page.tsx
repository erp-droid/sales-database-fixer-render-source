import Link from "next/link";

import { queryReadModelBusinessAccounts } from "@/lib/read-model/accounts";
import { resolveCompanyPhone } from "@/lib/business-accounts";
import { requireTvAccess } from "@/lib/tv-access";
import type { Category } from "@/types/business-account";

import { TvChrome } from "../tv-chrome";
import styles from "../tv.module.css";

export const dynamic = "force-dynamic";

type TvAccountsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const CATEGORY_VALUES: Category[] = ["A", "B", "C", "D"];
const PAGE_SIZE = 18;

function readParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0]?.trim() ?? "" : value?.trim() ?? "";
}

function readPage(value: string): number {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 1;
}

function readCategory(value: string): Category | undefined {
  const upper = value.toUpperCase();
  return CATEGORY_VALUES.includes(upper as Category) ? (upper as Category) : undefined;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "Never";
  }
  const numeric = Date.parse(value);
  if (!Number.isFinite(numeric)) {
    return "Unknown";
  }
  return new Date(numeric).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildPageHref(options: { q: string; category?: Category; page: number }): string {
  const params = new URLSearchParams();
  if (options.q) {
    params.set("q", options.q);
  }
  if (options.category) {
    params.set("category", options.category);
  }
  if (options.page > 1) {
    params.set("page", String(options.page));
  }
  const query = params.toString();
  return query ? `/tv/accounts?${query}` : "/tv/accounts";
}

export default async function TvAccountsPage({ searchParams }: TvAccountsPageProps) {
  const resolvedParams = (await searchParams) ?? {};
  const q = readParam(resolvedParams.q);
  const category = readCategory(readParam(resolvedParams.category));
  const page = readPage(readParam(resolvedParams.page));
  const currentPath = buildPageHref({ q, category, page });
  const { loginName } = await requireTvAccess(currentPath);

  const result = queryReadModelBusinessAccounts({
    q,
    category,
    sortBy: "companyName",
    sortDir: "asc",
    page,
    pageSize: PAGE_SIZE,
  });
  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const previousHref = buildPageHref({ q, category, page: Math.max(1, page - 1) });
  const nextHref = buildPageHref({ q, category, page: Math.min(pageCount, page + 1) });

  return (
    <TvChrome
      active="accounts"
      headerActions={<Link className={styles.primaryActionLink} href="/accounts">Open full app</Link>}
      subtitle={`${result.total.toLocaleString()} matching contacts and accounts`}
      title="Accounts"
      userName={loginName}
    >
      <script
        dangerouslySetInnerHTML={{
          __html: "setTimeout(function(){ window.location.reload(); }, 120000);",
        }}
      />

      <div className={styles.statusBar}>
        <span className={styles.statusPill}>Read-only</span>
        <span>Page {result.page.toLocaleString()} of {pageCount.toLocaleString()}</span>
      </div>

      <section className={styles.panel}>
        <form action="/tv/accounts" className={styles.toolbar} method="get">
            <label className={styles.field}>
              Search
              <input
                className={styles.input}
                defaultValue={q}
                name="q"
                placeholder="Company, contact, phone, email"
                type="search"
              />
            </label>
            <label className={styles.field}>
              Category
              <select className={styles.select} defaultValue={category ?? ""} name="category">
                <option value="">All</option>
                {CATEGORY_VALUES.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
            <button className={`${styles.button} ${styles.buttonPrimary}`} type="submit">Search</button>
            <Link className={styles.button} href="/tv/accounts">Reset</Link>
        </form>

          {result.items.length === 0 ? (
            <p className={styles.empty}>No accounts matched.</p>
          ) : (
            <ul className={styles.accountList}>
              {result.items.map((row) => {
                const accountId = row.accountRecordId ?? row.id;
                return (
                  <li className={styles.accountCard} key={row.rowKey ?? `${accountId}:${row.contactId ?? "row"}`}>
                    <div className={styles.accountCardHeader}>
                      <div>
                        <Link className={styles.companyName} href={`/tv/accounts/${encodeURIComponent(accountId)}`}>
                          {row.companyName}
                        </Link>
                        <div className={styles.accountMeta}>
                          {row.address || "No address"} · {row.category ?? "Blank"}
                        </div>
                      </div>
                      <span className={styles.badge}>{row.accountType ?? "Lead"}</span>
                    </div>
                    <div className={styles.accountFacts}>
                      <div className={styles.fact}>
                        <span>Contact</span>
                        <strong>{row.primaryContactName ?? "No contact"}</strong>
                      </div>
                      <div className={styles.fact}>
                        <span>Phone</span>
                        <strong>{row.primaryContactPhone ?? resolveCompanyPhone(row) ?? "No phone"}</strong>
                      </div>
                      <div className={styles.fact}>
                        <span>Email</span>
                        <strong>{row.primaryContactEmail ?? "No email"}</strong>
                      </div>
                      <div className={styles.fact}>
                        <span>Last called</span>
                        <strong>{formatDate(row.lastCalledAt)}</strong>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

        <div className={styles.pagination}>
          <span className={styles.sectionMeta}>
            Showing {result.items.length.toLocaleString()} of {result.total.toLocaleString()}
          </span>
          <div className={styles.paginationLinks}>
            <Link className={styles.button} href={previousHref}>Previous</Link>
            <Link className={styles.button} href={nextHref}>Next</Link>
          </div>
        </div>
      </section>
    </TvChrome>
  );
}
