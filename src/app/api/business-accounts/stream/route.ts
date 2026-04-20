export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue } from "@/lib/auth";
import { HttpError, getErrorMessage } from "@/lib/errors";
import { subscribeToBusinessAccountLive } from "@/lib/business-account-live";

const encoder = new TextEncoder();
const MAX_GLOBAL_STREAMS = readBoundedPositiveInteger(
  process.env.BUSINESS_ACCOUNTS_STREAM_MAX_GLOBAL,
  48,
  1,
  500,
);
const MAX_STREAMS_PER_IP = readBoundedPositiveInteger(
  process.env.BUSINESS_ACCOUNTS_STREAM_MAX_PER_IP,
  4,
  1,
  50,
);
const STREAM_RETRY_AFTER_SECONDS = readBoundedPositiveInteger(
  process.env.BUSINESS_ACCOUNTS_STREAM_RETRY_AFTER_SECONDS,
  5,
  1,
  60,
);

let activeStreamCount = 0;
const activeStreamCountByIp = new Map<string, number>();

function writeSseEvent(event: string, payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function readBoundedPositiveInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function readClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const fromForwarded = forwardedFor
    ?.split(",")
    .map((entry) => entry.trim())
    .find(Boolean);
  const fallback =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "unknown";
  return (fromForwarded ?? fallback).trim() || "unknown";
}

function acquireStreamSlot(clientIp: string):
  | {
      ok: true;
      release: () => void;
    }
  | {
      ok: false;
      scope: "global" | "ip";
      activeGlobal: number;
      activeForIp: number;
    } {
  const activeForIp = activeStreamCountByIp.get(clientIp) ?? 0;
  if (activeStreamCount >= MAX_GLOBAL_STREAMS) {
    return {
      ok: false,
      scope: "global",
      activeGlobal: activeStreamCount,
      activeForIp,
    };
  }

  if (activeForIp >= MAX_STREAMS_PER_IP) {
    return {
      ok: false,
      scope: "ip",
      activeGlobal: activeStreamCount,
      activeForIp,
    };
  }

  activeStreamCount += 1;
  activeStreamCountByIp.set(clientIp, activeForIp + 1);

  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) {
        return;
      }

      released = true;
      activeStreamCount = Math.max(0, activeStreamCount - 1);

      const nextCount = (activeStreamCountByIp.get(clientIp) ?? 1) - 1;
      if (nextCount <= 0) {
        activeStreamCountByIp.delete(clientIp);
      } else {
        activeStreamCountByIp.set(clientIp, nextCount);
      }
    },
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  let releaseSlot: (() => void) | null = null;

  try {
    requireAuthCookieValue(request);

    const clientIp = readClientIp(request);
    const slot = acquireStreamSlot(clientIp);
    if (!slot.ok) {
      return NextResponse.json(
        {
          error:
            slot.scope === "global"
              ? "Too many live-update streams are active. Wait a moment and retry."
              : "Too many live-update streams from this client. Close another tab and retry.",
          scope: slot.scope,
          activeGlobal: slot.activeGlobal,
          activeForIp: slot.activeForIp,
          limits: {
            global: MAX_GLOBAL_STREAMS,
            perIp: MAX_STREAMS_PER_IP,
          },
          retryAfterSeconds: STREAM_RETRY_AFTER_SECONDS,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(STREAM_RETRY_AFTER_SECONDS),
          },
        },
      );
    }

    releaseSlot = slot.release;

    let closed = false;
    let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
    let unsubscribe: (() => void) | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const close = () => {
          if (closed) {
            return;
          }

          closed = true;
          if (keepAliveTimer) {
            clearInterval(keepAliveTimer);
            keepAliveTimer = null;
          }
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
          if (releaseSlot) {
            releaseSlot();
            releaseSlot = null;
          }
          try {
            controller.close();
          } catch {
            // Ignore duplicate close attempts.
          }
        };

        controller.enqueue(
          writeSseEvent("ready", {
            at: new Date().toISOString(),
          }),
        );

        unsubscribe = subscribeToBusinessAccountLive((event) => {
          if (closed) {
            return;
          }

          controller.enqueue(writeSseEvent("changed", event));
        });

        keepAliveTimer = setInterval(() => {
          if (closed) {
            return;
          }

          controller.enqueue(encoder.encode(": ping\n\n"));
        }, 20_000);

        request.signal.addEventListener("abort", close);
      },
      cancel() {
        if (keepAliveTimer) {
          clearInterval(keepAliveTimer);
          keepAliveTimer = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (releaseSlot) {
          releaseSlot();
          releaseSlot = null;
        }
        closed = true;
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    if (releaseSlot) {
      releaseSlot();
      releaseSlot = null;
    }

    return error instanceof HttpError
      ? NextResponse.json({ error: error.message }, { status: error.status })
      : NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
