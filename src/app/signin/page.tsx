import Image from "next/image";

import { SignInForm } from "@/components/signin-form";

import styles from "./signin.module.css";

type SignInPageProps = {
  searchParams?: Promise<{
    error?: string;
    next?: string;
  }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const resolvedParams = (await searchParams) ?? {};
  const initialError = typeof resolvedParams.error === "string" ? resolvedParams.error : null;
  const nextPath = resolvedParams.next || "/accounts";

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brandTop} aria-label="MeadowBrook logo">
          <Image
            alt="MeadowBrook"
            className={styles.brandLogo}
            height={202}
            priority
            src="/mb-logo.png"
            width={712}
          />
        </div>
        <p className={styles.eyebrow}></p>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>
          Use the same credentials and cookie-backed session used by your internal web tools.
        </p>
        <SignInForm initialError={initialError} nextPath={nextPath} />
      </section>
    </main>
  );
}
