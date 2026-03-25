"use client";

import type { MouseEvent } from "react";

import { useTwilioCall } from "@/components/twilio-call-provider";

import styles from "./call-phone-button.module.css";

type CallPhoneButtonProps = {
  phone: string | null | undefined;
  label?: string;
  className?: string;
  context?: {
    sourcePage?: "accounts" | "map" | "tasks" | "quality";
    linkedBusinessAccountId?: string | null;
    linkedAccountRowKey?: string | null;
    linkedContactId?: number | null;
    linkedCompanyName?: string | null;
    linkedContactName?: string | null;
  };
};

export function CallPhoneButton({
  phone,
  label,
  className,
  context,
}: CallPhoneButtonProps) {
  const { startCall, isInitializing, activeLabel } = useTwilioCall();
  const trimmedPhone = phone?.trim() ?? "";

  if (!trimmedPhone) {
    return null;
  }

  const isActive = activeLabel === (label ?? trimmedPhone);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    void startCall(trimmedPhone, label ?? trimmedPhone, context);
  }

  return (
    <button
      className={className ? `${styles.button} ${className}` : styles.button}
      disabled={isInitializing || activeLabel !== null}
      onClick={handleClick}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      type="button"
    >
      {isActive ? "Calling..." : "Call"}
    </button>
  );
}
