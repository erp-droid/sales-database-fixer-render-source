import {
  enforceSinglePrimaryPerAccountRows,
} from "@/lib/business-accounts";
import type { BusinessAccountRow } from "@/types/business-account";

export type DeferredDeleteContactPreview = {
  actionType: "deleteContact";
  contactId: number;
  rowKey: string | null;
};

export type DeferredMergeContactsPreview = {
  actionType: "mergeContacts";
  keepContactId: number;
  loserContactIds: number[];
  setKeptAsPrimary: boolean;
  mergedPrimaryContactName: string | null;
  mergedPrimaryContactPhone: string | null;
  mergedPrimaryContactEmail: string | null;
  mergedNotes: string | null;
};

export type DeferredContactOperationPreview =
  | DeferredDeleteContactPreview
  | DeferredMergeContactsPreview;

function getRowKey(row: BusinessAccountRow): string {
  return row.rowKey ?? `${row.accountRecordId ?? row.id}:contact:${row.contactId ?? "row"}`;
}

export function getDeferredActionAccountKey(row: BusinessAccountRow): string {
  return row.accountRecordId?.trim() || row.id.trim() || row.businessAccountId.trim();
}

export function applyDeferredDeleteContactToRows(
  rows: BusinessAccountRow[],
  preview: DeferredDeleteContactPreview,
): BusinessAccountRow[] {
  const deletedWasPrimary = rows.some((row) => {
    const matchesRowKey = preview.rowKey ? getRowKey(row) === preview.rowKey : false;
    const matchesContactId =
      row.contactId !== null &&
      row.contactId !== undefined &&
      row.contactId === preview.contactId;

    if (!matchesRowKey && !matchesContactId) {
      return false;
    }

    return row.isPrimaryContact === true || row.primaryContactId === preview.contactId;
  });

  const remainingRows = rows.filter((row) => {
    if (preview.rowKey && getRowKey(row) === preview.rowKey) {
      return false;
    }

    return !(
      row.contactId !== null &&
      row.contactId !== undefined &&
      row.contactId === preview.contactId
    );
  });

  if (remainingRows.length === 0) {
    const fallbackRow = rows[0];
    if (!fallbackRow) {
      return [];
    }

    return [
      {
        ...fallbackRow,
        rowKey: `${getDeferredActionAccountKey(fallbackRow)}:primary`,
        contactId: null,
        isPrimaryContact: false,
        primaryContactId: null,
        primaryContactName: null,
        primaryContactPhone: null,
        primaryContactEmail: null,
        notes: null,
      },
    ];
  }

  if (!deletedWasPrimary) {
    return enforceSinglePrimaryPerAccountRows(remainingRows);
  }

  return enforceSinglePrimaryPerAccountRows(
    remainingRows.map((row) => ({
      ...row,
      primaryContactId:
        row.primaryContactId === preview.contactId ? null : row.primaryContactId,
      isPrimaryContact: false,
    })),
  );
}

export function applyDeferredMergeContactsToRows(
  rows: BusinessAccountRow[],
  preview: DeferredMergeContactsPreview,
): BusinessAccountRow[] {
  const loserIds = new Set(preview.loserContactIds);
  const remainingRows = rows.filter((row) => {
    const contactId = row.contactId ?? null;
    return contactId === null ? true : !loserIds.has(contactId);
  });

  if (remainingRows.length === 0) {
    return rows;
  }

  const keeperIndex = remainingRows.findIndex(
    (row) => (row.contactId ?? null) === preview.keepContactId,
  );
  if (keeperIndex < 0) {
    return enforceSinglePrimaryPerAccountRows(remainingRows);
  }

  const nextRows = remainingRows.map((row, index) => {
    const isKeeper = index === keeperIndex;
    const nextRow: BusinessAccountRow = isKeeper
      ? {
          ...row,
          primaryContactName:
            preview.mergedPrimaryContactName ?? row.primaryContactName ?? null,
          primaryContactPhone:
            preview.mergedPrimaryContactPhone ?? row.primaryContactPhone ?? null,
          primaryContactEmail:
            preview.mergedPrimaryContactEmail ?? row.primaryContactEmail ?? null,
          notes: preview.mergedNotes ?? row.notes ?? null,
        }
      : row;

    if (!preview.setKeptAsPrimary) {
      return nextRow;
    }

    return {
      ...nextRow,
      primaryContactId: preview.keepContactId,
      isPrimaryContact: isKeeper,
    };
  });

  return enforceSinglePrimaryPerAccountRows(nextRows);
}

export function applyDeferredContactOperationToRows(
  rows: BusinessAccountRow[],
  preview: DeferredContactOperationPreview,
): BusinessAccountRow[] {
  if (preview.actionType === "deleteContact") {
    return applyDeferredDeleteContactToRows(rows, preview);
  }

  return applyDeferredMergeContactsToRows(rows, preview);
}
