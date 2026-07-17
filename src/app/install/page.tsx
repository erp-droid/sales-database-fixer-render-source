import Image from "next/image";
import Link from "next/link";

import { InstallAppButton } from "@/components/install-app-button";

import styles from "./install.module.css";

export default function InstallPage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <Image
          alt="MeadowBrook CRM icon"
          className={styles.appIcon}
          height={176}
          priority
          src="/icons/meadowbrook-crm-512.png"
          width={176}
        />
        <p className={styles.eyebrow}>MeadowBrook</p>
        <h1 className={styles.title}>Install MeadowBrook CRM</h1>
        <p className={styles.subtitle}>
          Add the CRM to your Windows or Mac computer for fast access in Google Chrome.
        </p>

        <InstallAppButton />

        <Link className={styles.browserLink} href="/accounts">
          Continue in the browser
        </Link>
      </section>
    </main>
  );
}
