/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const test = require("node:test");

const { selectContact, toExportAccount } = require("./export-accounts.cjs");

function contactRow(overrides = {}) {
  const {
    contactId = null,
    primaryContactId = null,
    isPrimaryContact = false,
    sourceTable = "account_rows",
    rowKey = String(contactId ?? "no-contact"),
    ...contactFields
  } = overrides;
  return {
    isPrimaryContact,
    sourceTable,
    rowKey,
    payload: {
      contactId,
      primaryContactId,
      isPrimaryContact,
      primaryContactName: null,
      primaryContactJobTitle: null,
      primaryContactPhone: null,
      primaryContactExtension: null,
      primaryContactEmail: null,
      ...contactFields,
    },
  };
}

test("selects the contact whose ID matches the primary contact ID without mixing fields", () => {
  const selected = selectContact({
    rows: [
      contactRow({
        contactId: 10,
        primaryContactId: "010",
        primaryContactName: "Alex Primary",
        primaryContactPhone: "905-555-0010",
      }),
      contactRow({
        contactId: 20,
        primaryContactId: 10,
        isPrimaryContact: true,
        primaryContactName: "Blair Flagged",
        primaryContactJobTitle: "Buyer",
        primaryContactPhone: "905-555-0020",
        primaryContactExtension: "220",
        primaryContactEmail: "blair@example.com",
      }),
    ],
  });

  assert.equal(selected.primaryContactName, "Alex Primary");
  assert.equal(selected.primaryContactPhone, "905-555-0010");
  assert.equal(selected.primaryContactJobTitle, null);
  assert.equal(selected.primaryContactEmail, null);
});

test("falls back to the flagged primary contact, then the sole named contact", () => {
  const flagged = selectContact({
    rows: [
      contactRow({ contactId: 1, primaryContactName: "First Contact" }),
      contactRow({
        contactId: 2,
        isPrimaryContact: true,
        primaryContactName: "Flagged Contact",
      }),
    ],
  });
  assert.equal(flagged.primaryContactName, "Flagged Contact");

  const soleNamed = selectContact({
    rows: [
      contactRow({ contactId: 1, primaryContactPhone: "905-555-0001" }),
      contactRow({ contactId: 2, primaryContactName: "Only Named Contact" }),
    ],
  });
  assert.equal(soleNamed.primaryContactName, "Only Named Contact");
});

test("selects the most-complete named contact with an order-independent tie-break", () => {
  const contacts = [
    contactRow({
      contactId: 2,
      rowKey: "row-b",
      primaryContactName: "Less Complete",
      primaryContactPhone: "905-555-0002",
    }),
    contactRow({
      contactId: 4,
      rowKey: "row-d",
      primaryContactName: "Tie Two",
      primaryContactJobTitle: "Director",
      primaryContactPhone: "905-555-0004",
      primaryContactEmail: "two@example.com",
    }),
    contactRow({
      contactId: 3,
      rowKey: "row-c",
      primaryContactName: "Tie One",
      primaryContactJobTitle: "Director",
      primaryContactPhone: "905-555-0003",
      primaryContactEmail: "one@example.com",
    }),
  ];

  assert.equal(selectContact({ rows: contacts }).contactId, "3");
  assert.equal(selectContact({ rows: [...contacts].reverse() }).contactId, "3");
});

test("exports all fields from the selected contact and preserves existing account fields", () => {
  const exported = toExportAccount({
    accountRecordId: "account-1",
    businessAccountId: "BA001",
    companyName: "Example Company",
    companyPhone: "905-555-0100",
    phoneNumber: "905-555-0101",
    rows: [
      contactRow({
        contactId: 7,
        primaryContactId: 7,
        primaryContactName: "Casey Buyer",
        primaryContactJobTitle: "Purchasing Manager",
        primaryContactPhone: "416-555-0102",
        primaryContactExtension: "123",
        primaryContactEmail: "casey@example.com",
      }),
    ],
  });

  assert.equal(exported.companyPhone, "905-555-0100");
  assert.equal(exported.phoneNumber, "905-555-0101");
  assert.deepEqual(
    {
      name: exported.primaryContactName,
      jobTitle: exported.primaryContactJobTitle,
      phone: exported.primaryContactPhone,
      extension: exported.primaryContactExtension,
      email: exported.primaryContactEmail,
    },
    {
      name: "Casey Buyer",
      jobTitle: "Purchasing Manager",
      phone: "416-555-0102",
      extension: "123",
      email: "casey@example.com",
    },
  );
});
