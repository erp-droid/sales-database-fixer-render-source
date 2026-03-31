import Image from "next/image";

import { SignInForm } from "@/components/signin-form";
import { getAppBranding } from "@/lib/app-variant";

import styles from "./signin.module.css";

type SignInPageProps = {
  searchParams?: Promise<{
    next?: string;
  }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const resolvedParams = (await searchParams) ?? {};
  const nextPath = resolvedParams.next || "/accounts";
  const branding = getAppBranding();

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brandTop} aria-label={`${branding.companyName} logo`}>
          <Image
            alt={branding.logoAlt}
            className={styles.brandLogo}
            height={branding.logoHeight}
            priority
            src={branding.logoSrc}
            width={branding.logoWidth}
          />
        </div>
        <p className={styles.eyebrow}></p>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>
          Use the same credentials and cookie-backed session used by your internal web tools.
        </p>
        <SignInForm nextPath={nextPath} />
      </section>
    </main>
  );
}
