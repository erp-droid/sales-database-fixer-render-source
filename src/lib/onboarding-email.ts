type OnboardingEmailInput = {
  companyName: string | null;
  contactName: string | null;
  onboardingUrl: string;
  supportEmail: string;
  opportunityId: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildOnboardingEmail(input: OnboardingEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const companyLabel = input.companyName?.trim() || "your team";
  const contactLabel = input.contactName?.trim() || "there";
  const subject = `Welcome to the MeadowBrook family`;

  const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f7fb;font-family:'Manrope',Segoe UI,Arial,sans-serif;color:#172033;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f4f7fb;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;background:#ffffff;border-radius:18px;box-shadow:0 18px 40px rgba(23,32,51,0.12);overflow:hidden;">
            <tr>
              <td style="background:linear-gradient(120deg,#0f84d8,#0b5ea8);padding:26px 30px;color:#ffffff;">
                <div style="font-size:14px;letter-spacing:0.12em;text-transform:uppercase;">MeadowBrook</div>
                <div style="font-size:24px;font-weight:600;margin-top:8px;">Welcome to the MeadowBrook family</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">
                  Hi ${escapeHtml(contactLabel)},
                </p>
                <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">
                  We are excited to welcome you to the MeadowBrook family. We can't wait to get
                  started.
                </p>
                <p style="font-size:16px;line-height:1.6;margin:0 0 16px;">
                  Please use the link below to complete the necessary details so we can begin work.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 16px;">
                  <tr>
                    <td align="center" style="background:#0f84d8;border-radius:12px;">
                      <a href="${escapeHtml(input.onboardingUrl)}" style="display:inline-block;padding:14px 26px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">
                        Complete details
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="font-size:13px;line-height:1.6;color:#5f708b;margin:0 0 6px;">
                  If the button does not work, copy and paste this link into your browser:
                </p>
                <p style="font-size:12px;line-height:1.6;color:#0b5ea8;word-break:break-all;margin:0 0 20px;">
                  ${escapeHtml(input.onboardingUrl)}
                </p>
                <p style="font-size:14px;line-height:1.6;color:#5f708b;margin:0;">
                  Need help? Reply to this email or contact ${escapeHtml(input.supportEmail)}.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;background:#f7f9fc;color:#98a2b3;font-size:12px;">
                This secure form is unique to ${escapeHtml(companyLabel)}.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();

  const text = `Hi ${contactLabel},

We are excited to welcome you to the MeadowBrook family. We can't wait to get started.

Please use the link below to complete the necessary details so we can begin work.

Complete details: ${input.onboardingUrl}

Need help? Reply to this email or contact ${input.supportEmail}.`;

  return { subject, html, text };
}
