import styles from "@/app/install/install.module.css";

const INSTALLER_PATH = "/downloads/MeadowBrook-CRM-Setup.exe";

export function WindowsInstallerDownload() {
  return (
    <div className={styles.installActions}>
      <a className={styles.installButton} download href={INSTALLER_PATH}>
        Download for Windows
      </a>
      <p className={styles.installNote}>
        Run the downloaded setup once. It automatically creates the MeadowBrook CRM shortcut
        on your desktop and opens the CRM in Google Chrome.
      </p>
      <p className={styles.signingNote}>
        Testing build: if Microsoft Defender SmartScreen appears, select <strong>More info</strong>,
        then <strong>Run anyway</strong>. The installer is not code-signed yet.
      </p>
    </div>
  );
}
