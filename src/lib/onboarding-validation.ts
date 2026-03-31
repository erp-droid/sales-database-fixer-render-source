import { z } from "zod";

import type { OnboardingFormPayload } from "@/types/onboarding";

const addressSchema = z.object({
  line1: z.string().trim().min(1, "Billing address line 1 is required."),
  line2: z.string().trim().optional().default(""),
  city: z.string().trim().min(1, "City is required."),
  state: z.string().trim().min(1, "State/Province is required."),
  postalCode: z.string().trim().min(1, "Postal code is required."),
  country: z.string().trim().min(1, "Country is required."),
});

const existingContactSchema = z.object({
  mode: z.literal("existing"),
  contactId: z.number().int().positive(),
});

const newContactSchema = z.object({
  mode: z.literal("new"),
  name: z.string().trim().min(1, "Contact name is required."),
  email: z.string().trim().email("Contact email must be valid."),
  phone: z.string().trim().min(7, "Contact phone is required."),
});

const contactSelectionSchema = z.union([existingContactSchema, newContactSchema]);

const formSchema = z
  .object({
    billingName: z.string().trim().min(1, "Billing name is required."),
    billingAddress: addressSchema,
    invoiceContact: contactSelectionSchema,
    collectionsContact: z.object({
      sameAsInvoice: z.boolean(),
      selection: contactSelectionSchema.nullable(),
    }),
    paymentTermsDifferent: z.boolean(),
    paymentTermId: z.string().trim().min(1, "Payment terms are required."),
    poRequired: z.boolean(),
    poInstructions: z.string().trim().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.collectionsContact.sameAsInvoice === false && !value.collectionsContact.selection) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["collectionsContact", "selection"],
        message: "Select or add a payment inquiries contact.",
      });
    }

    if (value.poRequired && (!value.poInstructions || !value.poInstructions.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["poInstructions"],
        message: "Please describe the PO process.",
      });
    }

    if (!value.paymentTermsDifferent && !value.paymentTermId.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paymentTermId"],
        message: "Payment terms are required.",
      });
    }
  });

export function parseOnboardingFormPayload(value: unknown): OnboardingFormPayload {
  const parsed = formSchema.parse(value);
  return {
    ...parsed,
    poInstructions: parsed.poInstructions ?? null,
  };
}
