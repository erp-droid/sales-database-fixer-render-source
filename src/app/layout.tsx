import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

import { AuthSessionGuard } from "@/components/auth-session-guard";
import { TwilioCallProvider } from "@/components/twilio-call-provider";
import { getAppBranding } from "@/lib/app-variant";

import "./globals.css";

const displayFont = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

const monoFont = IBM_Plex_Mono({
  variable: "--font-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export function generateMetadata(): Metadata {
  const branding = getAppBranding();

  return {
    title: branding.appTitle,
    description: "Business account and contact management with live Acumatica updates",
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${monoFont.variable}`}>
        <TwilioCallProvider>
          <AuthSessionGuard />
          {children}
        </TwilioCallProvider>
      </body>
    </html>
  );
}
