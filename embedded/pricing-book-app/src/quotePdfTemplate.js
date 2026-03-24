import { readFile } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function cleanString(value) {
  return String(value ?? "").trim();
}

function normalizeScopeMarkers(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/^(\d+)\.\s*\.\s*(?=[A-Za-z(])/gm, "$1. ")
    .replace(/(\b\d+)\.\.(?=\s*[A-Za-z(])/g, "$1. ")
    .replace(/\b(\d+)\s*\.\s*(\d+)\b/g, "$1.$2")
    .replace(/(\b\d+(?:\.\d+)*\.?)\s*\n\s*(?=[A-Za-z(])/g, "$1 ")
    .replace(/(\b\d+(?:\.\d+)+)(?=[A-Za-z(])/g, "$1 ")
    .replace(/(\b\d+\.)(?=[A-Za-z(])/g, "$1 ")
    .replace(/\b(\d+)\s*\.\s*(?=[A-Za-z])/g, "$1. ")
    .replace(/(\d+\.\s*[A-Za-z][^\n]*?)\s+(?=\d+\.\s*[A-Za-z])/g, "$1\n")
    .replace(/\s+(?=\d+\.\d{1,3}(?:\.\d{1,3})*\s*[A-Za-z(])/g, "\n")
    .replace(/\s+(?=\d+\.\s*[A-Za-z(])/g, "\n")
    .replace(/[ \t]+\n/g, "\n");
}

function normalizeStatementOfWorkText(value) {
  const rawLines = normalizeScopeMarkers(value)
    .split(/\r?\n/)
    .map((line) => cleanString(line));
  const lines = [];
  let paragraph = "";
  const isStructuredListLine = (line) =>
    /^-\s+/.test(line) ||
    /^\d+[.)]\s+/.test(line) ||
    /^\d+(?:\.\d+)+\s+/.test(line) ||
    /^[A-Za-z][.)]\s+/.test(line);

  const flushParagraph = () => {
    if (!paragraph) return;
    lines.push(paragraph);
    paragraph = "";
  };

  const pushBlankLine = () => {
    if (!lines.length || lines[lines.length - 1] === "") return;
    lines.push("");
  };

  for (const rawLine of rawLines) {
    if (!rawLine) {
      flushParagraph();
      pushBlankLine();
      continue;
    }

    const line = rawLine
      .replace(/^[*•]\s*/, "- ")
      .replace(/^-(\S)/, "- $1");
    const isBullet = isStructuredListLine(line);
    const isHeading =
      /^[A-Z0-9][A-Z0-9 &/().,#:'"-]{2,}$/.test(line) &&
      line.length <= 80;

    if (isBullet || isHeading) {
      flushParagraph();
      if (isHeading) pushBlankLine();
      lines.push(line);
      continue;
    }

    paragraph = paragraph ? `${paragraph} ${line}` : line;
  }

  flushParagraph();

  while (lines.length && lines[0] === "") lines.shift();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();

  const compact = [];
  for (const line of lines) {
    if (line === "" && compact[compact.length - 1] === "") continue;
    const previous = cleanString(compact[compact.length - 1]);
    const normalizedCurrent = cleanString(line).replace(/[.:;,\-]+$/g, "").toLowerCase();
    const normalizedPrevious = previous.replace(/[.:;,\-]+$/g, "").toLowerCase();
    if (normalizedCurrent && normalizedCurrent === normalizedPrevious) continue;
    compact.push(line);
  }

  return compact.join("\n");
}

function isStructuredStatementLine(line = "") {
  return (
    /^-\s+/.test(line) ||
    /^\d+[.)]\s+/.test(line) ||
    /^\d+(?:\.\d+)+\s+/.test(line) ||
    /^[A-Za-z][.)]\s+/.test(line)
  );
}

function formatStatementScopeLine(line = "") {
  const text = cleanString(line);
  if (!text) return "";
  if (isStructuredStatementLine(text) || /:$/.test(text)) return text;
  return `- ${text}`;
}

function toWinAnsiSafeText(value) {
  return String(value ?? "")
    .replace(/\u2044/g, "/")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, "\"")
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E\r\n]/g, "")
    .trim();
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(parseNumber(value));
}

function formatTransactionDate(rawDate) {
  const trimmed = cleanString(rawDate);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;
  const date = trimmed ? new Date(trimmed) : new Date();
  if (!Number.isFinite(date.getTime())) return "";

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  return `${day}/${month}/${year}`;
}

function splitAddressLines(rawAddress) {
  const text = cleanString(rawAddress);
  if (!text) return [];
  return text
    .split(/\r?\n|,/)
    .map((line) => cleanString(line))
    .filter(Boolean);
}

function buildAddressLines(account = {}, override = {}) {
  const name = cleanString(override.name || account.name || "Customer");
  const accountAddress =
    account?.address && typeof account.address === "object" ? account.address : {};
  const explicitLines = [
    cleanString(override.addressLine1 || override.line1 || override.address1 || override.AddressLine1 || override.Line1 || override.Address1),
    cleanString(override.addressLine2 || override.line2 || override.address2 || override.AddressLine2 || override.Line2 || override.Address2)
  ].filter(Boolean);
  const accountExplicitLines = [
    cleanString(
      accountAddress.addressLine1 ||
        accountAddress.line1 ||
        accountAddress.address1 ||
        accountAddress.AddressLine1 ||
        accountAddress.Line1 ||
        accountAddress.Address1
    ),
    cleanString(
      accountAddress.addressLine2 ||
        accountAddress.line2 ||
        accountAddress.address2 ||
        accountAddress.AddressLine2 ||
        accountAddress.Line2 ||
        accountAddress.Address2
    )
  ].filter(Boolean);
  const addressSource =
    override.addressLines ||
    override.lines ||
    override.address ||
    override.Address ||
    override.street ||
    override.Street ||
    account.address;

  let addressLines = Array.isArray(addressSource)
    ? addressSource.map((line) => cleanString(line)).filter(Boolean)
    : splitAddressLines(addressSource);
  if (!addressLines.length) {
    addressLines = [...explicitLines, ...accountExplicitLines].filter(Boolean);
  }

  const city = cleanString(override.city || override.City || account.city || account.City || accountAddress.city || accountAddress.City);
  const state = cleanString(
    override.state ||
      override.province ||
      override.State ||
      override.Province ||
      account.state ||
      account.province ||
      account.State ||
      account.Province ||
      accountAddress.state ||
      accountAddress.province ||
      accountAddress.State ||
      accountAddress.Province
  );
  const zip = cleanString(
    override.zip ||
      override.postalCode ||
      override.PostalCode ||
      override.Zip ||
      override.ZipCode ||
      account.zip ||
      account.postalCode ||
      account.PostalCode ||
      account.Zip ||
      account.ZipCode ||
      accountAddress.zip ||
      accountAddress.postalCode ||
      accountAddress.PostalCode ||
      accountAddress.Zip ||
      accountAddress.ZipCode
  );
  const cityStateZip = [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const country = cleanString(
    override.country || override.Country || account.country || account.Country || accountAddress.country || accountAddress.Country
  );

  const detailLines = [...addressLines];
  if (cityStateZip) detailLines.push(cityStateZip);
  if (country) detailLines.push(country);

  return [name, ...detailLines].filter(Boolean);
}

function normalizeScopeLines(scope) {
  return normalizeScopeMarkers(scope)
    .split(/\r?\n/)
    .map((line) => cleanString(line))
    .filter(Boolean);
}

function extractQuoteReferenceFromText(text) {
  const value = cleanString(text);
  if (!value) return "";
  const match = value.match(/\bQ#\s*([A-Za-z0-9_-]+)/i);
  return match ? cleanString(match[1]) : "";
}

function buildDescriptionText(payload = {}, quoteNumber = "") {
  const divisions = Array.isArray(payload.divisions) ? payload.divisions.filter((item) => item?.isSelected !== false) : [];
  const quoteRef = cleanString(quoteNumber);
  const multiDivision = divisions.length > 1;

  const scopeOutput = [];
  for (const division of divisions) {
    const scopeLines = normalizeScopeLines(division.scope);
    if (!scopeLines.length) continue;
    if (multiDivision) {
      scopeOutput.push("");
      scopeOutput.push(`${cleanString(division.title || division.id) || "Division"}:`);
    }
    scopeOutput.push(...scopeLines.map((line) => formatStatementScopeLine(line)));
  }

  const lines = [];
  if (quoteRef) {
    lines.push(`Q#${quoteRef}`);
  }

  if (quoteRef) {
    while (scopeOutput.length && /^q#/i.test(scopeOutput[0])) {
      scopeOutput.shift();
    }
  }

  const hasProvideLine = scopeOutput.some((line) => /^provide all labour and materials/i.test(line));
  if (!hasProvideLine) {
    lines.push("Provide all labour and materials to complete the following,");
  }

  if (!scopeOutput.length) {
    lines.push("Scope of work to be confirmed.");
    return lines.join("\n");
  }

  lines.push(...scopeOutput);

  const compacted = [];
  for (const line of lines) {
    if (!line && !compacted.length) continue;
    if (compacted.length && compacted[compacted.length - 1] === line) continue;
    compacted.push(line);
  }
  if (compacted.length > 2) {
    const firstScopeIndex = compacted.findIndex((line) => /^provide all labour and materials/i.test(line));
    if (firstScopeIndex > 1) {
      compacted.splice(1, 1);
    }
  }

  return normalizeStatementOfWorkText(compacted.join("\n"));
}

function wrapTextByWidth(text, font, fontSize, maxWidth) {
  const wrapped = [];
  const paragraphs = toWinAnsiSafeText(text).split(/\r?\n/);

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      wrapped.push("");
      continue;
    }

    const words = trimmed.split(/\s+/);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const candidateWidth = font.widthOfTextAtSize(candidate, fontSize);
      if (candidateWidth <= maxWidth) {
        current = candidate;
      } else {
        if (current) wrapped.push(current);
        current = word;
      }
    }
    if (current) wrapped.push(current);
  }

  return wrapped;
}

function ellipsizeToWidth(text, font, fontSize, maxWidth) {
  const suffix = "...";
  if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) return text;
  let output = text;
  while (output.length > 1 && font.widthOfTextAtSize(`${output}${suffix}`, fontSize) > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output}${suffix}`;
}

function drawWrappedText({
  page,
  text,
  font,
  fontSize,
  x,
  y,
  maxWidth,
  maxLines,
  lineHeight
}) {
  const lines = wrapTextByWidth(text, font, fontSize, maxWidth);
  const lineLimit = Number.isFinite(maxLines) && maxLines > 0 ? maxLines : lines.length;
  const visible = lines.slice(0, lineLimit);
  if (lines.length > lineLimit && visible.length) {
    visible[visible.length - 1] = ellipsizeToWidth(visible[visible.length - 1], font, fontSize, maxWidth);
  }

  let cursorY = y;
  for (const line of visible) {
    if (line) {
      page.drawText(toWinAnsiSafeText(line), {
        x,
        y: cursorY,
        size: fontSize,
        font,
        color: rgb(0, 0, 0)
      });
    }
    cursorY -= lineHeight;
  }

  return {
    renderedLines: visible,
    remainingLines: lines.slice(lineLimit)
  };
}

function drawLines({
  page,
  lines,
  font,
  fontSize,
  x,
  y,
  maxLines,
  lineHeight
}) {
  const list = Array.isArray(lines) ? lines : [];
  const lineLimit = Number.isFinite(maxLines) && maxLines > 0 ? maxLines : list.length;
  const visible = list.slice(0, lineLimit);
  let cursorY = y;

  for (const line of visible) {
    if (line) {
      page.drawText(line, {
        x,
        y: cursorY,
        size: fontSize,
        font,
        color: rgb(0, 0, 0)
      });
    }
    cursorY -= lineHeight;
  }

  return list.slice(lineLimit);
}

function drawAddressBlock(page, label, lines, { x, yTop, width }, fonts) {
  const { regular, bold } = fonts;
  page.drawText(toWinAnsiSafeText(label), {
    x,
    y: yTop,
    size: 10,
    font: bold,
    color: rgb(0, 0, 0)
  });
  const maxLines = 5;
  const visibleLines = lines.slice(0, maxLines);
  drawWrappedText({
    page,
    text: toWinAnsiSafeText(visibleLines.join("\n")),
    font: regular,
    fontSize: 10,
    x,
    y: yTop - 14,
    maxWidth: width,
    maxLines: maxLines + 2,
    lineHeight: 12
  });
}

function drawRightAligned(page, text, rightX, y, font, size) {
  const normalized = toWinAnsiSafeText(cleanString(text));
  const width = font.widthOfTextAtSize(normalized, size);
  page.drawText(normalized, {
    x: rightX - width,
    y,
    size,
    font,
    color: rgb(0, 0, 0)
  });
}

function drawTotalsBlock(page, { subtotal, tax, total, topY, gap }, fonts) {
  const { regular, bold } = fonts;
  page.drawText("Subtotal:", {
    x: 460,
    y: topY,
    size: 10,
    font: regular,
    color: rgb(0, 0, 0)
  });
  page.drawText("Tax:", {
    x: 492,
    y: topY - gap,
    size: 10,
    font: regular,
    color: rgb(0, 0, 0)
  });
  page.drawText("Total:", {
    x: 486,
    y: topY - gap * 2,
    size: 10,
    font: regular,
    color: rgb(0, 0, 0)
  });

  drawRightAligned(page, formatCurrency(subtotal), 580, topY, bold, 10.5);
  drawRightAligned(page, formatCurrency(tax), 580, topY - gap, bold, 10.5);
  drawRightAligned(page, formatCurrency(total), 580, topY - gap * 2, bold, 10.5);
}

export async function renderQuoteBackupPdf(options = {}) {
  const templatePath = cleanString(options.templatePath);
  if (!templatePath) {
    throw new Error("PDF template path is required.");
  }

  const templateBytes = await readFile(templatePath);
  const pdfDoc = await PDFDocument.load(templateBytes);
  const page = pdfDoc.getPages()[0];
  if (!page) {
    throw new Error("Quote template PDF does not include page 1.");
  }

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fonts = { regular: helvetica, bold: helveticaBold };

  const payload = options.payload || {};
  const account = payload.account || {};
  const billToLines = buildAddressLines(account, options.billTo || {});
  const shipToLines = buildAddressLines(account, options.shipTo || {});
  const requestedQuoteNumber = cleanString(options.quoteNumber || options.quoteNbr || "");
  const transactionDate = formatTransactionDate(options.transactionDate);
  const salesRep = toWinAnsiSafeText(cleanString(options.salesRep || account.owner || account.contactName) || "TBD");
  const subtotal = parseNumber(options.subtotal);
  const tax = parseNumber(options.tax);
  const total = parseNumber(options.total);
  const normalizedStatement = normalizeStatementOfWorkText(
    cleanString(options.statementOfWork)
  );
  const descriptionText =
    toWinAnsiSafeText(normalizedStatement) ||
    toWinAnsiSafeText(buildDescriptionText(payload, requestedQuoteNumber));
  const inferredQuoteNumber =
    requestedQuoteNumber ||
    extractQuoteReferenceFromText(descriptionText) ||
    cleanString(payload.quoteNbr || payload.quoteNumber || payload.quoteId || "");
  const quoteNumber = toWinAnsiSafeText(inferredQuoteNumber || "PENDING");
  const safeTransactionDate = toWinAnsiSafeText(transactionDate);
  const descriptionFontSize = 10.5;
  const descriptionLineHeight = 11.5;
  const descriptionWidth = 420;
  const descriptionStartY = 428;
  const descriptionBox = { x: 18, y: 170, width: 567, height: 270 };
  const descriptionBottomPadding = 8;
  const firstPageDescriptionMaxLines = Math.max(
    1,
    Math.floor(
      (descriptionStartY - (descriptionBox.y + descriptionBottomPadding)) / descriptionLineHeight
    ) + 1
  );
  const totalsTopY = 233;
  const totalsGap = 22;
  const continuationMaxLines = 58;
  const descriptionLines = wrapTextByWidth(descriptionText, helvetica, descriptionFontSize, descriptionWidth);

  const white = rgb(1, 1, 1);
  page.drawRectangle({ x: 18, y: 540, width: 236, height: 98, color: white });
  page.drawRectangle({ x: 370, y: 540, width: 222, height: 98, color: white });
  page.drawRectangle({ x: 238, y: 618, width: 130, height: 12, color: white });
  page.drawRectangle({ x: 18, y: 430, width: 567, height: 80, color: white });
  page.drawRectangle({ x: 18, y: 490, width: 236, height: 48, color: white });
  page.drawRectangle({ x: 370, y: 490, width: 222, height: 48, color: white });
  // Wider/taller description canvas so full scope is visible.
  page.drawRectangle({ x: descriptionBox.x, y: descriptionBox.y, width: descriptionBox.width, height: descriptionBox.height, color: white });
  // Clear and redraw totals block to keep alignment stable across templates.
  page.drawRectangle({ x: 444, y: 166, width: 148, height: 90, color: white });

  drawAddressBlock(page, "Bill to", billToLines, { x: 22, yTop: 620, width: 216 }, fonts);
  drawAddressBlock(page, "Ship to", shipToLines, { x: 372, yTop: 620, width: 206 }, fonts);

  page.drawText(`Quote #: ${quoteNumber}`, {
    x: 22,
    y: 517,
    size: 10.5,
    font: helveticaBold,
    color: rgb(0, 0, 0)
  });
  page.drawText(`Transaction Date: ${safeTransactionDate}`, {
    x: 372,
    y: 517,
    size: 10,
    font: helvetica,
    color: rgb(0, 0, 0)
  });
  page.drawText(`Sales Rep: ${salesRep}`, {
    x: 372,
    y: 495,
    size: 10.5,
    font: helveticaBold,
    color: rgb(0, 0, 0)
  });

  page.drawText("Estimate is inclusive of labour, material and equipment as outlined in the statement of work:", {
    x: 22,
    y: 462,
    size: 10,
    font: helveticaBold,
    color: rgb(0, 0, 0)
  });
  page.drawRectangle({ x: 18, y: 441, width: 567, height: 14, color: rgb(0.82, 0.9, 0.95) });
  page.drawText("Description", {
    x: 277,
    y: 445,
    size: 10.5,
    font: helveticaBold,
    color: rgb(0, 0, 0)
  });

  let remainingDescriptionLines = drawLines({
    page,
    lines: descriptionLines,
    font: helvetica,
    fontSize: descriptionFontSize,
    x: 24,
    y: descriptionStartY,
    maxLines: firstPageDescriptionMaxLines,
    lineHeight: descriptionLineHeight
  });

  const hasOverflow = remainingDescriptionLines.length > 0;
  if (!hasOverflow) {
    drawTotalsBlock(
      page,
      { subtotal, tax, total, topY: totalsTopY, gap: totalsGap },
      { regular: helvetica, bold: helveticaBold }
    );
    return pdfDoc.save();
  }

  // Hide first-page totals/signature area when scope continues.
  page.drawRectangle({ x: 18, y: 92, width: 567, height: 170, color: white });

  while (remainingDescriptionLines.length > firstPageDescriptionMaxLines) {
    const continuationPage = pdfDoc.addPage([page.getWidth(), page.getHeight()]);
    continuationPage.drawText(`Quote #${quoteNumber} - Scope of Work (continued)`, {
      x: 24,
      y: 760,
      size: 13,
      font: helveticaBold,
      color: rgb(0, 0, 0)
    });
    continuationPage.drawRectangle({ x: 20, y: 745, width: 560, height: 2, color: rgb(0.82, 0.9, 0.95) });

    remainingDescriptionLines = drawLines({
      page: continuationPage,
      lines: remainingDescriptionLines,
      font: helvetica,
      fontSize: descriptionFontSize,
      x: 24,
      y: 724,
      maxLines: continuationMaxLines,
      lineHeight: descriptionLineHeight
    });
  }

  const templateSourceDoc = await PDFDocument.load(templateBytes);
  const [finalPageTemplate] = await pdfDoc.copyPages(templateSourceDoc, [0]);
  const finalPage = pdfDoc.addPage(finalPageTemplate);

  finalPage.drawRectangle({ x: 18, y: 540, width: 236, height: 98, color: white });
  finalPage.drawRectangle({ x: 370, y: 540, width: 222, height: 98, color: white });
  finalPage.drawRectangle({ x: 238, y: 618, width: 130, height: 12, color: white });
  finalPage.drawRectangle({ x: 18, y: 430, width: 567, height: 80, color: white });
  finalPage.drawRectangle({ x: 18, y: 490, width: 236, height: 48, color: white });
  finalPage.drawRectangle({ x: 370, y: 490, width: 222, height: 48, color: white });
  finalPage.drawRectangle({ x: descriptionBox.x, y: descriptionBox.y, width: descriptionBox.width, height: descriptionBox.height, color: white });
  finalPage.drawRectangle({ x: 444, y: 166, width: 148, height: 90, color: white });

  finalPage.drawText(`Quote #: ${quoteNumber} (Final Scope Page)`, {
    x: 22,
    y: 517,
    size: 10.5,
    font: helveticaBold,
    color: rgb(0, 0, 0)
  });
  finalPage.drawText(`Transaction Date: ${safeTransactionDate}`, {
    x: 372,
    y: 517,
    size: 10,
    font: helvetica,
    color: rgb(0, 0, 0)
  });
  finalPage.drawText(`Sales Rep: ${salesRep}`, {
    x: 372,
    y: 495,
    size: 10.5,
    font: helveticaBold,
    color: rgb(0, 0, 0)
  });
  finalPage.drawText("Estimate is inclusive of labour, material and equipment as outlined in the statement of work:", {
    x: 22,
    y: 462,
    size: 10,
    font: helveticaBold,
    color: rgb(0, 0, 0)
  });
  finalPage.drawRectangle({ x: 18, y: 441, width: 567, height: 14, color: rgb(0.82, 0.9, 0.95) });
  finalPage.drawText("Description (continued)", {
    x: 248,
    y: 445,
    size: 10.5,
    font: helveticaBold,
    color: rgb(0, 0, 0)
  });

  remainingDescriptionLines = drawLines({
    page: finalPage,
    lines: remainingDescriptionLines,
    font: helvetica,
    fontSize: descriptionFontSize,
    x: 24,
    y: descriptionStartY,
    maxLines: firstPageDescriptionMaxLines,
    lineHeight: descriptionLineHeight
  });

  if (remainingDescriptionLines.length) {
    const overflowWarning = "Scope continues beyond template space.";
    finalPage.drawText(overflowWarning, {
      x: 24,
      y: descriptionBox.y + 4,
      size: 9,
      font: helveticaBold,
      color: rgb(0.65, 0.18, 0.18)
    });
  }

  drawTotalsBlock(
    finalPage,
    { subtotal, tax, total, topY: totalsTopY, gap: totalsGap },
    { regular: helvetica, bold: helveticaBold }
  );

  return pdfDoc.save();
}

export const __test__ = {
  buildDescriptionText,
  formatStatementScopeLine,
  normalizeStatementOfWorkText
};
