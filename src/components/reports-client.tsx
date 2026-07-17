"use client";

import { useEffect, useMemo, useState } from "react";

import { AppChrome } from "@/components/app-chrome";

import styles from "./reports-client.module.css";

type SalesRepOption = {
  id: string;
  name: string;
  accountCount: number;
};

type ReportOptionsResponse = {
  items?: SalesRepOption[];
  error?: string;
};

function filenameFromResponse(response: Response, fallbackName: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const quotedMatch = disposition.match(/filename="([^"]+)"/i);
  return quotedMatch?.[1] ?? fallbackName;
}
async function errorMessageFromResponse(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || `The report could not be generated (${response.status}).`;
  } catch {
    return `The report could not be generated (${response.status}).`;
  }
}

function triggerFileDownload(response: Response, blob: Blob, fallbackName: string): void {
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = filenameFromResponse(response, fallbackName);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);
}

export function ReportsClient({ initialLoginName }: { initialLoginName: string | null }) {
  const [options, setOptions] = useState<SalesRepOption[]>([]);
  const [selectedRepKey, setSelectedRepKey] = useState("");
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isDownloadingSpecial, setIsDownloadingSpecial] = useState(false);
  const [specialError, setSpecialError] = useState<string | null>(null);
  const [specialSuccess, setSpecialSuccess] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadOptions() {
      setIsLoadingOptions(true);
      setError(null);
      try {
        const response = await fetch("/api/reports/visitation-routes/options", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = (await response.json()) as ReportOptionsResponse;
        if (!response.ok) {
          throw new Error(body.error || "Sales reps could not be loaded.");
        }
        const items = body.items ?? [];
        setOptions(items);
        setSelectedRepKey((current) => current || (items[0] ? `${items[0].id}\u0000${items[0].name}` : ""));
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Sales reps could not be loaded.");
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingOptions(false);
        }
      }
    }
    void loadOptions();
    return () => controller.abort();
  }, []);

  const selectedRep = useMemo(
    () =>
      options.find((option) => `${option.id}\u0000${option.name}` === selectedRepKey) ?? null,
    [options, selectedRepKey],
  );

  async function downloadReport() {
    if (!selectedRep || isDownloading) {
      return;
    }
    setIsDownloading(true);
    setError(null);
    setSuccess(null);
    try {
      const params = new URLSearchParams({
        salesRepId: selectedRep.id,
        salesRepName: selectedRep.name,
      });
      const response = await fetch(`/api/reports/visitation-routes?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(await errorMessageFromResponse(response));
      }
      const blob = await response.blob();
      triggerFileDownload(
        response,
        blob,
        `${selectedRep.name}-12-week-visitation-routes.xlsx`,
      );

      const accountCount = response.headers.get("x-report-account-count") ?? String(selectedRep.accountCount);
      const mappedCount = response.headers.get("x-report-mapped-count");
      const mappingNote = mappedCount && mappedCount !== accountCount
        ? ` ${mappedCount} of ${accountCount} accounts had map coordinates; the rest are still included.`
        : "";
      setSuccess(
        `Downloaded all ${accountCount} A/B accounts in a 60-tab, 11×17 Excel workbook.${mappingNote}`,
      );
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "The report could not be downloaded.");
    } finally {
      setIsDownloading(false);
    }
  }

  async function downloadSpecialReport() {
    if (isDownloadingSpecial) {
      return;
    }
    setIsDownloadingSpecial(true);
    setSpecialError(null);
    setSpecialSuccess(null);
    try {
      const response = await fetch("/api/reports/jeff-special", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(await errorMessageFromResponse(response));
      }
      const blob = await response.blob();
      triggerFileDownload(response, blob, "jeff-special-report.xlsx");
      const accountCount = response.headers.get("x-report-account-count") ?? "20";
      const matchedCount = response.headers.get("x-report-matched-count") ?? accountCount;
      const missingCount = response.headers.get("x-report-missing-count") ?? "0";
      const differenceCount = response.headers.get("x-report-difference-count") ?? "0";
      const missingNote = missingCount === "0"
        ? ""
        : ` ${matchedCount} of ${accountCount} companies matched current CRM records; missing companies are clearly marked in the workbook.`;
      setSpecialSuccess(
        `Downloaded the Jeff Special Report for all ${accountCount} fixed companies with ${differenceCount} field differences listed.${missingNote}`,
      );
    } catch (downloadError) {
      setSpecialError(
        downloadError instanceof Error
          ? downloadError.message
          : "The Jeff Special Report could not be downloaded.",
      );
    } finally {
      setIsDownloadingSpecial(false);
    }
  }

  return (
    <AppChrome
      title="Reports"
      subtitle="Ready-to-print sales reports built from the latest account data."
      userName={initialLoginName}
    >
      <section className={styles.reportCard}>
        <div className={styles.cardHeading}>
          <div className={styles.fileIcon} aria-hidden="true">
            <svg fill="none" viewBox="0 0 24 24">
              <path d="M6 3.5h8l4 4V21H6V3.5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
              <path d="M14 3.5v4h4M9 12h6M9 15.5h6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
            </svg>
          </div>
          <div>
            <span className={styles.eyebrow}>Excel report</span>
            <h2>A/B visitation routes</h2>
            <p>
              Creates 12 weeks × 5 days of geographically grouped customer visits for one sales rep.
            </p>
          </div>
        </div>

        <div className={styles.steps} aria-label="Report contents">
          <span><strong>60</strong> daily tabs</span>
          <span><strong>11×17</strong> landscape print setup</span>
          <span><strong>1 click</strong> Excel download</span>
        </div>

        <div className={styles.formArea}>
          <label className={styles.fieldLabel} htmlFor="report-sales-rep">
            Sales rep
          </label>
          <select
            className={styles.select}
            disabled={isLoadingOptions || isDownloading || options.length === 0}
            id="report-sales-rep"
            onChange={(event) => {
              setSelectedRepKey(event.target.value);
              setError(null);
              setSuccess(null);
            }}
            value={selectedRepKey}
          >
            {isLoadingOptions ? <option value="">Loading sales reps…</option> : null}
            {!isLoadingOptions && options.length === 0 ? (
              <option value="">No sales reps with A/B accounts</option>
            ) : null}
            {options.map((option) => (
              <option key={`${option.id}:${option.name}`} value={`${option.id}\u0000${option.name}`}>
                {option.name} — {option.accountCount} A/B accounts
              </option>
            ))}
          </select>

          <button
            className={styles.downloadButton}
            disabled={!selectedRep || isDownloading || isLoadingOptions}
            onClick={() => void downloadReport()}
            type="button"
          >
            <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
              <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19.5h14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
            </svg>
            {isDownloading ? "Building your workbook…" : "Download 12-week Excel report"}
          </button>
          <p className={styles.helperText}>
            The workbook opens directly in Excel. Every day is already sized to one 11×17 landscape page, with route order, clickable map addresses, and note space.
          </p>
        </div>

        {error ? <div className={styles.errorMessage} role="alert">{error}</div> : null}
        {success ? <div className={styles.successMessage} role="status">{success}</div> : null}
      </section>

      <section className={`${styles.reportCard} ${styles.specialReportCard}`}>
        <div className={styles.cardHeading}>
          <div className={`${styles.fileIcon} ${styles.specialFileIcon}`} aria-hidden="true">
            <svg fill="none" viewBox="0 0 24 24">
              <path d="m12 3 2.1 4.7 5.1.5-3.8 3.5 1.1 5-4.5-2.6-4.5 2.6 1.1-5-3.8-3.5 5.1-.5L12 3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
            </svg>
          </div>
          <div>
            <span className={styles.specialEyebrow}>Fixed company list</span>
            <h2>Jeff Special Report</h2>
            <p>
              Recreates the original two-week route for the same companies, refreshed with the latest company and contact details from the CRM.
            </p>
          </div>
        </div>

        <div className={styles.steps} aria-label="Jeff Special Report contents">
          <span><strong>20</strong> specific companies</span>
          <span><strong>2</strong> route tabs</span>
          <span><strong>1</strong> changes tab</span>
        </div>

        <div className={styles.formArea}>
          <div className={styles.specialCallout}>
            The company list, visit order, times, and instructions stay fixed. Current CRM fields are refreshed every time, and a third tab highlights exactly what changed from the original report.
          </div>
          <button
            className={`${styles.downloadButton} ${styles.specialDownloadButton}`}
            disabled={isDownloadingSpecial}
            onClick={() => void downloadSpecialReport()}
            type="button"
          >
            <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
              <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19.5h14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
            </svg>
            {isDownloadingSpecial ? "Building Jeff Special Report…" : "Download Jeff Special Report"}
          </button>
          <p className={styles.helperText}>
            Opens in Excel with two route tabs, a changes comparison, clickable map addresses, original visit notes, and 11×17 landscape print settings.
          </p>
        </div>

        {specialError ? <div className={styles.errorMessage} role="alert">{specialError}</div> : null}
        {specialSuccess ? <div className={styles.successMessage} role="status">{specialSuccess}</div> : null}
      </section>
    </AppChrome>
  );
}
