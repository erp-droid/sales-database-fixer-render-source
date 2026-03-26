import "dotenv/config";
import express from "express";
import next from "next";

import { app as pricingBookApp, startPricingBookAutoSync } from "./embedded/pricing-book-app/src/index.js";

function normalizeMountPath(value, fallback = "/quotes") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const prefixed = raw.startsWith("/") ? raw : `/${raw}`;
  return prefixed === "/" ? fallback : prefixed.replace(/\/+$/, "");
}

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const quotesMountPath = normalizeMountPath(process.env.MBQ_BASE_PATH, "/quotes");

const nextApp = next({
  dev,
  hostname,
  port,
});

await nextApp.prepare();

const handle = nextApp.getRequestHandler();
const server = express();

server.disable("x-powered-by");
server.use(quotesMountPath, pricingBookApp);
server.all("*", (req, res) => handle(req, res));

server.listen(port, hostname, () => {
  console.log(`sales-database-fixer listening on http://${hostname}:${port}`);
  console.log(`embedded pricing-book-app mounted at ${quotesMountPath}`);
  startPricingBookAutoSync(console);

  // Watchdog: check for stuck/failed jobs every 5 minutes
  const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;
  setInterval(async () => {
    try {
      const { runWatchdog } = await import("./src/lib/watchdog.ts");
      const report = await runWatchdog();

      if (report.actions.length === 0) {
        console.log(`[watchdog] ✓ All clear — checked ${report.checked} jobs in ${report.durationMs}ms`);
        return;
      }

      const fixed = report.actions.filter((a) => a.result === "fixed").length;
      const requeued = report.actions.filter((a) => a.result === "requeued").length;
      const skipped = report.actions.filter((a) => a.result === "skipped").length;
      const failed = report.actions.filter((a) => a.result === "failed").length;

      const parts = [];
      if (fixed > 0) parts.push(`${fixed} fixed`);
      if (requeued > 0) parts.push(`${requeued} requeued`);
      if (skipped > 0) parts.push(`${skipped} skipped`);
      if (failed > 0) parts.push(`${failed} failed`);

      const icon = failed > 0 ? "⚠️" : "✅";
      console.log(`[watchdog] ${icon} ${parts.join(", ")} — checked ${report.checked} jobs in ${report.durationMs}ms`);

      for (const action of report.actions) {
        console.log(`[watchdog]   ${action.sessionId}: ${action.issue} → ${action.result} — ${action.detail}`);
      }
    } catch (error) {
      console.error("[watchdog] Cycle failed:", error);
    }
  }, WATCHDOG_INTERVAL_MS);
  console.log(`[watchdog] Started — checking every ${WATCHDOG_INTERVAL_MS / 1000}s`);
});
