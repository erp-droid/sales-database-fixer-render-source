import Link from "next/link";
import { notFound } from "next/navigation";

import { resolveCompanyPhone } from "@/lib/business-accounts";
import { readBusinessAccountRowsFromReadModel } from "@/lib/read-model/accounts";
import { requireTvAccess } from "@/lib/tv-access";

import { TvChrome } from "../../tv-chrome";
import styles from "../../tv.module.css";

export const dynamic = "force-dynamic";

type TvAccountDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Never";
  }
  const numeric = Date.parse(value);
  if (!Number.isFinite(numeric)) {
    return "Unknown";
  }
  return new Date(numeric).toLocaleString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

export default async function TvAccountDetailPage({ params }: TvAccountDetailPageProps) {
  const { id } = await params;
  const { loginName } = await requireTvAccess(`/tv/accounts/${encodeURIComponent(id)}`);

  const rows = readBusinessAccountRowsFromReadModel(id);
  if (rows.length === 0) {
    notFound();
  }

  const primary = rows.find((row) => row.isPrimaryContact) ?? rows[0];
  const contacts = rows.filter((row) =>
    Boolean(clean(row.primaryContactName) || clean(row.primaryContactPhone) || clean(row.primaryContactEmail)),
  );

  return (
    <TvChrome
      active="accounts"
      headerActions={
        <Link className={styles.primaryActionLink} href={`/accounts?search=${encodeURIComponent(primary?.companyName ?? "")}`}>
          Open full app
        </Link>
      }
      subtitle={primary?.address || "No address"}
      title={primary?.companyName ?? "Account"}
      userName={loginName}
    >
      <div className={styles.statusBar}>
        <span className={styles.statusPill}>{primary?.category ?? "Blank"} category</span>
        <span>{rows.length.toLocaleString()} contact rows</span>
        <span>Last called {formatDateTime(primary?.lastCalledAt)}</span>
      </div>

      <section className={styles.detailGrid}>
        <div className={styles.panel}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Account</h2>
          </div>
          <div className={styles.accountFacts}>
            <div className={styles.fact}>
              <span>Business ID</span>
              <strong>{primary?.businessAccountId || "Unknown"}</strong>
            </div>
            <div className={styles.fact}>
              <span>Type</span>
              <strong>{primary?.accountType ?? "Lead"}</strong>
            </div>
            <div className={styles.fact}>
              <span>Sales rep</span>
              <strong>{primary?.salesRepName ?? "Not set"}</strong>
            </div>
            <div className={styles.fact}>
              <span>Company phone</span>
              <strong>{primary ? resolveCompanyPhone(primary) ?? "No phone" : "No phone"}</strong>
            </div>
            <div className={styles.fact}>
              <span>Trade</span>
              <strong>{primary?.industryType ?? "Not set"}</strong>
            </div>
            <div className={styles.fact}>
              <span>Region</span>
              <strong>{primary?.companyRegion ?? "Not set"}</strong>
            </div>
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Contacts</h2>
            <span className={styles.sectionMeta}>{contacts.length.toLocaleString()} visible</span>
          </div>
          {contacts.length === 0 ? (
            <p className={styles.empty}>No contacts on this account.</p>
          ) : (
            <ul className={styles.contactList}>
              {contacts.map((contact) => (
                <li className={styles.contactRow} key={contact.rowKey ?? `${contact.id}:${contact.contactId ?? "row"}`}>
                  <strong className={styles.contactName}>{contact.primaryContactName ?? "Unnamed contact"}</strong>
                  <span className={styles.contactMeta}>
                    {contact.primaryContactJobTitle ?? "No title"}{contact.isPrimaryContact ? " · Primary" : ""}
                  </span>
                  <div className={styles.contactChannels}>
                    {contact.primaryContactPhone ? (
                      <a className={styles.channel} href={`tel:${contact.primaryContactPhone}`}>
                        {contact.primaryContactPhone}
                      </a>
                    ) : (
                      <span className={styles.channel}>No phone</span>
                    )}
                    {contact.primaryContactEmail ? (
                      <a className={styles.channel} href={`mailto:${contact.primaryContactEmail}`}>
                        {contact.primaryContactEmail}
                      </a>
                    ) : (
                      <span className={styles.channel}>No email</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </TvChrome>
  );
}
