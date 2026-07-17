import Image from "next/image";

import { ForgotPasswordForm } from "@/components/forgot-password-form";

import styles from "@/app/signin/signin.module.css";

type ForgotPasswordPageProps = {
  searchParams?: Promise<{
    username?: string;
  }>;
};

export default async function ForgotPasswordPage({
  searchParams,
}: ForgotPasswordPageProps) {
  const resolvedParams = (await searchParams) ?? {};
  const initialUsername =
    typeof resolvedParams.username === "string"
      ? resolvedParams.username.slice(0, 254)
      : "";

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
        <h1 className={styles.title}>Reset your password</h1>
        <p className={styles.subtitle}>
          Enter your MeadowBrook username. We’ll send instructions to the email
          address on file.
        </p>
        <ForgotPasswordForm initialUsername={initialUsername} />
      </section>
    </main>
  );
}
