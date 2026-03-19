export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";

import { getTwilioVoiceConfig } from "@/lib/twilio";
import { formatPhoneForTwilioDial } from "@/lib/phone";

function buildXmlResponse(xml: string): NextResponse {
  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function buildErrorVoiceResponse(message: string): NextResponse {
  const response = new twilio.twiml.VoiceResponse();
  response.say(message);
  return buildXmlResponse(response.toString());
}

async function readTargetPhone(request: NextRequest): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await request.formData();
    const value = formData.get("To");
    return typeof value === "string" ? value : null;
  }

  const json = await request.json().catch(() => null);
  if (json && typeof json === "object" && typeof (json as Record<string, unknown>).to === "string") {
    return (json as Record<string, unknown>).to as string;
  }

  return request.nextUrl.searchParams.get("To");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = getTwilioVoiceConfig();
  if (!config) {
    return buildErrorVoiceResponse("Twilio calling is not configured.");
  }

  const requestedTarget = await readTargetPhone(request);
  const dialTarget = formatPhoneForTwilioDial(requestedTarget);
  if (!dialTarget) {
    return buildErrorVoiceResponse("The requested phone number is invalid.");
  }

  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial({
    callerId: formatPhoneForTwilioDial(config.callerId) ?? config.callerId,
    answerOnBridge: true,
  });
  dial.number(dialTarget);
  return buildXmlResponse(response.toString());
}
