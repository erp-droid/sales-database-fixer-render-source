export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { requireAuthCookieValue } from "@/lib/auth";
import { subscribeToDeferredActions } from "@/lib/deferred-actions-live";
import { HttpError, getErrorMessage } from "@/lib/errors";

const encoder = new TextEncoder();

function writeSseEvent(event: string, payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    requireAuthCookieValue(request);

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

        unsubscribe = subscribeToDeferredActions((event) => {
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
    const response =
      error instanceof HttpError
        ? NextResponse.json(
            {
              error: error.message,
            },
            { status: error.status },
          )
        : NextResponse.json(
            {
              error: getErrorMessage(error),
            },
            { status: 500 },
          );

    return response;
  }
}
