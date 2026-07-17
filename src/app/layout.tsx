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
  applicationName: "MeadowBrook CRM",
  title: "MeadowBrook CRM",
  description: "Local business account and contact management for MeadowBrook",
  manifest: "/manifest.webmanifest",
  icons: {
    apple: [
      {
        url: "/icons/meadowbrook-crm-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    icon: [
      {
        url: "/icons/meadowbrook-crm-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/icons/meadowbrook-crm-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  },
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
