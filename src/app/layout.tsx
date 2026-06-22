import type { Metadata } from "next";
import { IBM_Plex_Mono, Space_Grotesk } from "next/font/google";

import { AuthSessionGuard } from "@/components/auth-session-guard";
import { DeployRefreshGuard } from "@/components/deploy-refresh-guard";
import { TwilioCallProvider } from "@/components/twilio-call-provider";

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

export const metadata: Metadata = {
  title: "Sales MeadowBrook",
  description: "Local business account and contact management for MeadowBrook",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const currentCommit =
    process.env.RENDER_GIT_COMMIT?.trim() || process.env.GIT_COMMIT_SHA?.trim() || null;

  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${monoFont.variable}`}>
        <TwilioCallProvider>
          <DeployRefreshGuard currentCommit={currentCommit} />
          <AuthSessionGuard />
          {children}
        </TwilioCallProvider>
      </body>
    </html>
  );
}
