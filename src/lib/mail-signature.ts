export const GMAIL_SIGNATURE_ATTRIBUTE = 'data-mb-gmail-signature="true"';

const GMAIL_SIGNATURE_MARKER_PATTERN =
  /data-mb-gmail-signature\s*=\s*["']true["']/i;

function isVisuallyBlankHtml(html: string): boolean {
  return html
    .replace(/<br\s*\/?\s*>/gi, "")
    .replace(/&nbsp;|&#160;/gi, "")
    .replace(/<[^>]*>/g, "")
    .trim().length === 0;
}

export function appendGmailSignatureToComposeHtml(
  htmlBody: string,
  sanitizedSignatureHtml: string,
): string {
  const signature = sanitizedSignatureHtml.trim();
  if (!signature || GMAIL_SIGNATURE_MARKER_PATTERN.test(htmlBody)) {
    return htmlBody;
  }

  const body = isVisuallyBlankHtml(htmlBody) ? "" : htmlBody.trim();
  return `${body}<div><br></div><div ${GMAIL_SIGNATURE_ATTRIBUTE}>${signature}</div>`;
}
