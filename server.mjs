import "dotenv/config";
import express from "express";
import next from "next";

import { app as pricingBookApp, startPricingBookAutoSync } from "./embedded/pricing-book-app/src/index.js";

function logProcessEvent(label, detail) {
  if (detail instanceof Error) {
    console.error(label, {
      message: detail.message,
      stack: detail.stack,
    });
    return;
  }

  console.error(label, detail);
}

process.on("uncaughtExceptionMonitor", (error, origin) => {
  logProcessEvent("[process] uncaught exception", {
    origin,
    error,
  });
});

process.on("unhandledRejection", (reason) => {
  logProcessEvent("[process] unhandled rejection", reason);
});

process.on("SIGTERM", () => {
  console.warn("[process] received SIGTERM");
});

process.on("SIGINT", () => {
  console.warn("[process] received SIGINT");
});

process.on("exit", (code) => {
  console.warn("[process] exiting", { code });
});

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
});
