import express from "express";

import { app, startPricingBookAutoSync } from "./index.js";

const parsedPort = Number.parseInt(process.env.PORT || "8080", 10);
const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 8080;
const rawMountPath = String(process.env.MBQ_BASE_PATH || "/quotes").trim();
const mountPath = `/${rawMountPath.replace(/^\/+|\/+$/g, "")}`;
const standaloneApp = express();

standaloneApp.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
standaloneApp.use(mountPath, app);

const server = standaloneApp.listen(port, () => {
  console.log(`pricing-book-app listening on port ${port}`);
  startPricingBookAutoSync(console);
});

function shutdown(signal) {
  console.log(`pricing-book-app received ${signal}; shutting down`);
  server.close((error) => {
    if (error) {
      console.error("pricing-book-app shutdown failed", error);
      process.exitCode = 1;
    }
    process.exit();
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
