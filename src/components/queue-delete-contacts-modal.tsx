"use client";

import { useEffect, useMemo, useState } from "react";

import styles from "./queue-delete-contacts-modal.module.css";

export type QueueDeleteContactTarget = {
  key: string;
  contactName: string | null;
  companyName: string | null;
};

type QueueDeleteContactsModalProps = {
  isOpen: boolean;
  isSubmitting: boolean;
  targets: QueueDeleteContactTarget[];
  title?: string;
  description?: string;
  reasonPlaceholder?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
};

function formatTargetLabel(target: QueueDeleteContactTarget): string {
  const companyName = target.companyName?.trim();
  const contactName = target.contactName?.trim();
  if (!contactName) {
    return companyName || "Unnamed record";
  }
  return companyName ? `${contactName} at ${companyName}` : contactName;
}

export function QueueDeleteContactsModal({
  isOpen,
  isSubmitting,
  targets,
  title,
  description,
  reasonPlaceholder,
  confirmLabel,
  onClose,
  onConfirm,
}: QueueDeleteContactsModalProps) {
  const [reason, setReason] = useState("");

  const targetSignature = useMemo(
    () => targets.map((target) => target.key).join("|"),
    [targets],
  );

  useEffect(() => {
    setReason("");
  }, [isOpen, targetSignature]);

  if (!isOpen) {
    return null;
  }

  const trimmedReason = reason.trim();
  const isBulk = targets.length > 1;

  return (
    <div
      className={styles.backdrop}
      onClick={() => {
        if (!isSubmitting) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        aria-labelledby="queue-delete-title"
        aria-modal="true"
        className={styles.modal}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className={styles.header}>
          <div>
            <h2 id="queue-delete-title">
              {title ?? (isBulk ? `Queue ${targets.length} contact deletions` : "Queue contact deletion")}
            </h2>
            <p className={styles.subtitle}>
              {description ??
                "The reason below will appear in the Deletion Queue under the `Reason` column."}
            </p>
          </div>
          <button
            className={styles.closeButton}
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.targets}>
            {targets.map((target) => (
              <div className={styles.targetRow} key={target.key}>
                {formatTargetLabel(target)}
              </div>
            ))}
          </div>

          <label className={styles.label}>
            Reason
            <textarea
              className={styles.textarea}
              disabled={isSubmitting}
              onChange={(event) => setReason(event.target.value)}
              placeholder={reasonPlaceholder ?? "Explain why this contact should be deleted."}
              rows={5}
              value={reason}
            />
          </label>
        </div>

        <div className={styles.actions}>
          <button
            className={styles.secondaryButton}
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className={styles.primaryButton}
            disabled={isSubmitting || trimmedReason.length === 0}
            onClick={() => {
              void onConfirm(trimmedReason);
            }}
            type="button"
          >
            {isSubmitting ? "Queueing..." : (confirmLabel ?? "Queue deletion")}
          </button>
        </div>
      </div>
    </div>
  );
}
