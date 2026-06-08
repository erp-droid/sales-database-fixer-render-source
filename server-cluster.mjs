import cluster from "node:cluster";
import { availableParallelism } from "node:os";

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const requestedWorkerCount = readPositiveInteger(process.env.WEB_CONCURRENCY, 1);
const workerCount = Math.max(1, requestedWorkerCount);
const shutdownTimeoutMs = readPositiveInteger(process.env.WEB_CLUSTER_SHUTDOWN_TIMEOUT_MS, 10_000);

if (workerCount <= 1) {
  await import("./server.mjs");
} else if (cluster.isPrimary) {
  let shuttingDown = false;
  const workerRoles = new Map();

  console.log("[cluster] primary starting", {
    pid: process.pid,
    webConcurrency: workerCount,
    availableParallelism: availableParallelism(),
  });

  function forkWorker({ backgroundTasks = false } = {}) {
    const worker = cluster.fork({
      ...process.env,
      SALES_MEADOWB_CLUSTER_WORKER: "1",
      SALES_MEADOWB_CLUSTER_BACKGROUND_TASKS: backgroundTasks ? "true" : "false",
    });
    workerRoles.set(worker.id, { backgroundTasks });

    console.log("[cluster] worker forked", {
      id: worker.id,
      pid: worker.process.pid,
      backgroundTasks,
    });

    return worker;
  }

  for (let index = 0; index < workerCount; index += 1) {
    forkWorker({ backgroundTasks: index === 0 });
  }

  cluster.on("exit", (worker, code, signal) => {
    const role = workerRoles.get(worker.id) ?? { backgroundTasks: false };
    workerRoles.delete(worker.id);

    console.error("[cluster] worker exited", {
      id: worker.id,
      pid: worker.process.pid,
      code,
      signal,
      shuttingDown,
      backgroundTasks: role.backgroundTasks,
    });

    if (shuttingDown) {
      return;
    }

    const restartTimer = setTimeout(() => {
      forkWorker({ backgroundTasks: role.backgroundTasks });
    }, 1_000);

    if (typeof restartTimer.unref === "function") {
      restartTimer.unref();
    }
  });

  function shutdown(signal) {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log("[cluster] shutdown requested", {
      signal,
      workers: Object.keys(cluster.workers ?? {}).length,
    });

    for (const worker of Object.values(cluster.workers ?? {})) {
      worker?.process.kill(signal);
    }

    const forceExitTimer = setTimeout(() => {
      console.warn("[cluster] shutdown timeout reached; exiting primary", {
        shutdownTimeoutMs,
      });
      process.exit(0);
    }, shutdownTimeoutMs);

    if (typeof forceExitTimer.unref === "function") {
      forceExitTimer.unref();
    }
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
} else {
  console.log("[cluster] worker starting server", {
    workerId: cluster.worker?.id,
    pid: process.pid,
  });
  await import("./server.mjs");
}
