function cleanString(value) {
  return String(value ?? "").trim();
}

function parseNumber(value) {
  const trimmed = cleanString(value);
  if (!trimmed) return 0;
  const parsed = Number(trimmed.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function formatMoney(value) {
  const amount = roundTo(parseNumber(value), 2);
  return `$${amount.toFixed(2)}`;
}

function formatQuantity(value) {
  const amount = roundTo(parseNumber(value), 2);
  if (Number.isInteger(amount)) return String(amount);
  return amount.toFixed(2);
}

function formatPercent(value, digits = 1) {
  const amount = roundTo(parseNumber(value), digits);
  return `${amount.toFixed(digits)}%`;
}

function toIsoDate(rawDate, fallbackIso) {
  const text = cleanString(rawDate);
  if (!text) return fallbackIso;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `${text}T00:00:00+00:00`;
  }

  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }

  return fallbackIso;
}

function buildDivisionMatchText(division) {
  const materialText = (division.materials?.lines || [])
    .map((line) => line.description)
    .filter(Boolean)
    .join(" ");
  const subcontractorText = (division.subcontractor?.lines || [])
    .map((line) => line.description)
    .filter(Boolean)
    .join(" ");

  return {
    scopeText: division.scope || "",
    materialText,
    subcontractorText
  };
}

function sumLineTotals(lines) {
  let costTotal = 0;
  let sellTotal = 0;

  lines.forEach((line) => {
    const cost = parseNumber(line.cost);
    const markup = parseNumber(line.markup);
    const selling = parseNumber(line.sellingPrice ?? line.sell);
    const lineSell = selling > 0 ? selling : cost > 0 ? cost * (1 + markup / 100) : 0;
    if (cost > 0) costTotal += cost;
    if (lineSell > 0) sellTotal += lineSell;
  });

  return {
    costTotal: roundTo(costTotal, 2),
    sellTotal: roundTo(sellTotal, 2),
    count: Array.isArray(lines) ? lines.length : 0
  };
}

function normalizeInputCostLine(line = {}) {
  const quantity = parseNumber(line.quantity) || 1;
  const enteredUnitCost = parseNumber(line.unitCost);
  const enteredCost = parseNumber(line.cost);
  const cost = enteredCost > 0 ? enteredCost : enteredUnitCost > 0 ? enteredUnitCost * quantity : 0;
  const markup = parseNumber(line.markup);
  const enteredSell = parseNumber(line.sellingPrice ?? line.sell);
  const enteredUnitPrice = parseNumber(line.unitPrice);
  const resolvedSell = enteredSell > 0 ? enteredSell : cost > 0 ? cost * (1 + markup / 100) : 0;
  const resolvedUnitCost = enteredUnitCost > 0 ? enteredUnitCost : quantity > 0 ? cost / quantity : cost;
  const resolvedUnitPrice = enteredUnitPrice > 0 ? enteredUnitPrice : quantity > 0 ? resolvedSell / quantity : resolvedSell;
  return {
    description: cleanString(line.description) || "Line item",
    quantity: roundTo(quantity, 2),
    uom: cleanString(line.uom) || "EACH",
    unitCost: roundTo(resolvedUnitCost, 2),
    unitPrice: roundTo(resolvedUnitPrice, 2),
    costCode: cleanString(line.costCode),
    expenseGroup: cleanString(line.expenseGroup),
    taxCategory: cleanString(line.taxCategory),
    cost: roundTo(cost, 2),
    markup: roundTo(markup, 2),
    sell: roundTo(resolvedSell, 2)
  };
}

function getLabourRoleConfigs(divisionKey = "") {
  if (cleanString(divisionKey).toLowerCase() === "glendale") {
    return [
      {
        label: "Design",
        hoursField: "technicianHours",
        rateField: "technicianRate",
        sellField: "technicianSellingPrice"
      },
      {
        label: "Architect",
        hoursField: "supervisionHours",
        rateField: "supervisionRate",
        sellField: "supervisionSellingPrice"
      },
      {
        label: "Engineer",
        hoursField: "engineerHours",
        rateField: "engineerRate",
        sellField: "engineerSellingPrice"
      },
      {
        label: "Sr. Engineer",
        hoursField: "seniorEngineerHours",
        rateField: "seniorEngineerRate",
        sellField: "seniorEngineerSellingPrice"
      },
      {
        label: "Project Manager",
        hoursField: "projectManagerHours",
        rateField: "projectManagerRate",
        sellField: "projectManagerSellingPrice"
      }
    ];
  }

  return [
    {
      label: "General Labour",
      hoursField: "technicianHours",
      rateField: "technicianRate",
      sellField: "technicianSellingPrice"
    },
    {
      label: "Supervision",
      hoursField: "supervisionHours",
      rateField: "supervisionRate",
      sellField: "supervisionSellingPrice"
    },
    {
      label: "Project Manager",
      hoursField: "projectManagerHours",
      rateField: "projectManagerRate",
      sellField: "projectManagerSellingPrice"
    }
  ];
}

function calcLabourTotals(labour, templateItem = {}, divisionKey = "") {
  const templateCostRate = parseNumber(templateItem.costRate);
  const templateSellRate = parseNumber(templateItem.sellRate);
  const labourRoles = getLabourRoleConfigs(divisionKey);

  let totalHours = 0;
  let totalCost = 0;
  let totalSelling = 0;

  labourRoles.forEach((role) => {
    const hours = parseNumber(labour?.[role.hoursField]);
    const rate = parseNumber(labour?.[role.rateField]) || templateCostRate;
    const sellOverride = parseNumber(labour?.[role.sellField]);
    const costTotal = hours * rate;
    const sellTotal = sellOverride > 0 ? sellOverride : hours * (templateSellRate || rate);
    totalHours += hours;
    totalCost += costTotal;
    totalSelling += sellTotal;
  });

  return {
    totalHours: roundTo(totalHours, 2),
    totalCost: roundTo(totalCost, 2),
    totalSelling: roundTo(totalSelling, 2)
  };
}

function toTradeLabel(divisionKey, division) {
  const title = cleanString(division?.title);
  if (title) return title;
  switch (divisionKey) {
    case "construction":
      return "Construction";
    case "electrical":
      return "Electrical";
    case "plumbing":
      return "Plumbing";
    case "hvac":
      return "HVAC";
    case "glendale":
      return "Glendale";
    default:
      return cleanString(division?.id) || "Division";
  }
}

function isGenericTemplateDescription(value = "", divisionKey = "") {
  const text = cleanString(value).toLowerCase();
  if (!text) return false;
  if (text.includes("generic scope")) return true;
  const canonicalDivisionTitle = cleanString(toTradeLabel(divisionKey, {})).toLowerCase();
  return Boolean(canonicalDivisionTitle) && text === `${canonicalDivisionTitle} generic scope`;
}

function buildNoteSection(division, divisionKey, templateItem = {}) {
  const labour = division.labour || {};
  const materials = division.materials || { lines: [] };
  const subcontractor = division.subcontractor || { lines: [] };
  const isGlendale = cleanString(divisionKey) === "glendale";
  const subcontractorLabel = isGlendale ? "Consultant" : "Subtrade";

  const labourTotals = labour.noCost ? { totalHours: 0, totalCost: 0, totalSelling: 0 } : calcLabourTotals(labour, templateItem, divisionKey);
  const materialTotals = materials.noCost ? { costTotal: 0, sellTotal: 0, count: 0 } : sumLineTotals(materials.lines || []);
  const subcontractorTotals = subcontractor.noCost ? { costTotal: 0, sellTotal: 0, count: 0 } : sumLineTotals(subcontractor.lines || []);
  const scope = cleanString(division.scope) || "No scope provided.";
  const unresolvedLabourPricing = labourTotals.totalHours > 0 && labourTotals.totalCost === 0 && labourTotals.totalSelling === 0;
  const labourSummary = unresolvedLabourPricing
    ? `${labourTotals.totalHours} hrs | Cost/Sell resolved from template at submit`
    : `${labourTotals.totalHours} hrs | Cost ${formatMoney(labourTotals.totalCost)} | Sell ${formatMoney(labourTotals.totalSelling)}`;
  const sectionLines = [
    `${toTradeLabel(divisionKey, division)}`,
    `Scope: ${scope}`,
    `Labour: ${labour.noCost ? "No cost" : labourSummary}`
  ];

  if (!isGlendale) {
    sectionLines.push(
      `Material: ${materials.noCost ? "No cost" : `${materialTotals.count} lines | Cost ${formatMoney(materialTotals.costTotal)} | Sell ${formatMoney(materialTotals.sellTotal)}`}`
    );
  }

  sectionLines.push(
    `${subcontractorLabel}: ${
      subcontractor.noCost
        ? "No cost"
        : `${subcontractorTotals.count} lines | Cost ${formatMoney(subcontractorTotals.costTotal)} | Sell ${formatMoney(subcontractorTotals.sellTotal)}`
    }`
  );

  return sectionLines.join("\n");
}

function buildLinePayload(base, overrides = {}) {
  return {
    manualPrice: true,
    manualDiscount: true,
    discount: 0,
    ...base,
    ...overrides
  };
}

function buildLabourNoteLines(labour, divisionKey = "") {
  if (labour.noCost) {
    return ["Labour: No cost"];
  }

  const labourRoleLines = getLabourRoleConfigs(divisionKey).map((role) => {
    return `- ${role.label}: ${formatQuantity(labour[role.hoursField])} hrs | Rate ${formatMoney(labour[role.rateField])} | Sell ${formatMoney(
      labour[role.sellField]
    )}`;
  });
  const totalLine = `- Total: ${formatQuantity(labour.totalHours)} hrs | Cost ${formatMoney(labour.totalCost)} | Sell ${formatMoney(labour.totalSelling)}`;

  return ["Labour Input:", ...labourRoleLines, totalLine];
}

function buildCostInputNoteLines(label, noCost, lines, totals) {
  if (noCost) {
    return [`${label}: No cost`];
  }
  if (!lines.length) {
    return [`${label}: No line items`];
  }

  const heading = `${label}:`;
  const itemLines = lines.map(
    (line, index) =>
      `- ${index + 1}) ${line.description} | Qty ${formatQuantity(line.quantity)} ${cleanString(line.uom || "EACH")} | Cost ${formatMoney(
        line.cost
      )} | Sell ${formatMoney(line.sell)}${cleanString(line.costCode) ? ` | Cost Code ${cleanString(line.costCode)}` : ""}`
  );
  const totalLine = `- Total: ${lines.length} lines | Cost ${formatMoney(totals.costTotal)} | Sell ${formatMoney(totals.sellTotal)}`;

  return [heading, ...itemLines, totalLine];
}

function buildEstimateNoteLines(estimateLines) {
  if (!estimateLines.length) {
    return ["Estimate Lines: No lines generated"];
  }

  const lines = estimateLines.map((line, index) => {
    const group = cleanString(line.expenseGroup || "?");
    const description = cleanString(line.description || "Line");
    const qty = formatQuantity(line.quantity);
    const uom = cleanString(line.uom || "EACH");
    const costCode = cleanString(line.costCode);
    const taxCategory = cleanString(line.taxCategory);
    const unitCost = formatMoney(line.unitCost);
    const unitPrice = formatMoney(line.unitPrice);
    return `- ${index + 1}) [${group}] ${description} | Qty ${qty} ${uom} | Unit Cost ${unitCost} | Unit Price ${unitPrice}${
      costCode ? ` | Cost Code ${costCode}` : ""
    }${taxCategory ? ` | Tax ${taxCategory}` : ""}`;
  });

  return ["Estimate Lines to Push:", ...lines];
}

function splitScopeIntoLines(scopeText) {
  const raw = cleanString(scopeText);
  if (!raw) return [];

  const normalizedLines = raw
    .split(/\r?\n+/)
    .map((line) =>
      cleanString(line)
        .replace(/^[*•▪◦·-]+\s*/, "")
        .replace(/^\d+(?:\.\d+)?[\)\].:\-\s]*/, "")
    )
    .filter(Boolean);

  if (normalizedLines.length > 1) return normalizedLines;

  const sentenceLines = raw
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((line) =>
      cleanString(line)
        .replace(/^[*•▪◦·-]+\s*/, "")
        .replace(/^\d+(?:\.\d+)?[\)\].:\-\s]*/, "")
    )
    .filter(Boolean);

  return sentenceLines.length ? sentenceLines : normalizedLines;
}

function getBreakdownSectionTotals(breakdown = {}) {
  const labour = breakdown?.labour || {};
  const materialTotals = breakdown?.material?.totals || {};
  const subcontractorTotals = breakdown?.subcontractor?.totals || {};

  const labourCost = roundTo(parseNumber(labour.totalCost), 2);
  const materialCost = roundTo(parseNumber(materialTotals.costTotal), 2);
  const subcontractorCost = roundTo(parseNumber(subcontractorTotals.costTotal), 2);
  const labourSell = roundTo(parseNumber(labour.totalSelling), 2);
  const materialSell = roundTo(parseNumber(materialTotals.sellTotal), 2);
  const subcontractorSell = roundTo(parseNumber(subcontractorTotals.sellTotal), 2);
  const totalCost = roundTo(labourCost + materialCost + subcontractorCost, 2);
  const totalSell = roundTo(labourSell + materialSell + subcontractorSell, 2);

  return {
    labourCost,
    materialCost,
    subcontractorCost,
    labourSell,
    materialSell,
    subcontractorSell,
    totalCost,
    totalSell
  };
}

function buildDetailedBreakdownSection(sectionNumber, breakdown) {
  const scope = cleanString(breakdown.scope) || "No scope provided.";
  const isGlendale = cleanString(breakdown.divisionKey) === "glendale";
  const subcontractorLabel = isGlendale ? "Consultant Inputs" : "Subtrade Inputs";
  const headerLine = `${sectionNumber}. ${cleanString(breakdown.tradeDivision) || "Division"}`;
  const taskLine = `Task: ${cleanString(breakdown.taskCd) || "N/A"} - ${cleanString(breakdown.taskDescription) || "No task description"}`;
  const costCodeLine = `Cost Code: ${cleanString(breakdown.costCode) || "Not provided"}`;
  const scopeLine = `Scope: ${scope}`;
  const labourLines = buildLabourNoteLines(breakdown.labour || {}, breakdown.divisionKey);
  const materialLines = isGlendale
    ? []
    : buildCostInputNoteLines(
        "Material Inputs",
        Boolean(breakdown.material?.noCost),
        breakdown.material?.lines || [],
        breakdown.material?.totals || { costTotal: 0, sellTotal: 0 }
      );
  const subcontractorLines = buildCostInputNoteLines(
    subcontractorLabel,
    Boolean(breakdown.subcontractor?.noCost),
    breakdown.subcontractor?.lines || [],
    breakdown.subcontractor?.totals || { costTotal: 0, sellTotal: 0 }
  );
  const estimateLines = buildEstimateNoteLines(breakdown.estimateLines || []);

  return [
    headerLine,
    taskLine,
    costCodeLine,
    scopeLine,
    ...labourLines,
    ...materialLines,
    ...subcontractorLines,
    ...estimateLines
  ].join("\n");
}

export function normalizeDivisionId(id) {
  const normalized = cleanString(id)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!normalized) return "";
  if (normalized.includes("plumb")) return "plumbing";
  if (normalized.includes("construct") || normalized === "con") return "construction";
  if (normalized.includes("hvac") || normalized.includes("mechanical") || normalized === "mec") return "hvac";
  if (normalized.includes("elect")) return "electrical";
  if (normalized.includes("glendale") || normalized === "gln") return "glendale";
  return normalized;
}

export async function buildTasksAndLines({ divisions, pickTemplate, quoteDate }) {
  const tasks = [];
  const lines = [];
  const breakdowns = [];
  const taskCodeUsage = new Map();
  const maxTaskCdLength = 10;
  const defaultQuoteDate = cleanString(quoteDate) || new Date().toISOString();

  for (const division of divisions) {
    const divisionKey = normalizeDivisionId(division.id || division.title);
    if (!divisionKey || divisionKey === "doordock") continue;

    const mapping = division.templateMapping || {};
    const overrideTaskCd = cleanString(mapping.taskCd);
    const needsRecommendedDefaults =
      !overrideTaskCd ||
      !cleanString(mapping.description) ||
      !cleanString(mapping.costCode) ||
      !cleanString(mapping.taxCategory) ||
      !cleanString(mapping.revenueGroup);

    let recommendedTemplateItem = null;
    if (needsRecommendedDefaults) {
      const { scopeText, materialText, subcontractorText } = buildDivisionMatchText(division);
      recommendedTemplateItem = await pickTemplate({
        division: divisionKey,
        scopeText,
        materialText,
        subcontractorText
      });
    }

    const overrideTemplateItem = overrideTaskCd
      ? {
          taskCd: overrideTaskCd,
          description: cleanString(mapping.description),
          type: cleanString(mapping.taskType),
          accountGroup: cleanString(mapping.revenueGroup),
          taxCategory: cleanString(mapping.taxCategory),
          costCode: cleanString(mapping.costCode),
          costRate: parseNumber(mapping.costRate),
          sellRate: parseNumber(mapping.sellRate),
          plannedStart: cleanString(mapping.plannedStartDate || mapping.plannedStart),
          plannedEnd: cleanString(mapping.plannedEndDate || mapping.plannedEnd),
          uom: cleanString(mapping.uom)
        }
      : null;

    const templateItem = {
      ...(recommendedTemplateItem || {}),
      ...(overrideTemplateItem || {})
    };

    if (!templateItem) continue;

    const baseTaskCd = cleanString(templateItem.taskCd);
    if (!baseTaskCd) continue;

    const taskKey = baseTaskCd.toLowerCase();
    const taskCount = taskCodeUsage.get(taskKey) || 0;
    taskCodeUsage.set(taskKey, taskCount + 1);
    const suffix = taskCount > 0 ? String(taskCount + 1) : "";
    const taskCd = `${baseTaskCd.slice(0, Math.max(1, maxTaskCdLength - suffix.length))}${suffix}`;

    const displayDivisionTitle = toTradeLabel(divisionKey, division);
    const canonicalDivisionTitle = toTradeLabel(divisionKey, {});
    const baseTaskDescription =
      cleanString(mapping.description) || cleanString(templateItem.description) || displayDivisionTitle;
    const taskDescription = isGenericTemplateDescription(baseTaskDescription, divisionKey)
      ? displayDivisionTitle || canonicalDivisionTitle || baseTaskDescription
      : displayDivisionTitle &&
          cleanString(displayDivisionTitle).toLowerCase() !== cleanString(baseTaskDescription).toLowerCase() &&
          cleanString(displayDivisionTitle).toLowerCase() !== cleanString(canonicalDivisionTitle).toLowerCase()
        ? `${displayDivisionTitle} - ${baseTaskDescription}`
        : baseTaskDescription;
    const taskType = cleanString(mapping.taskType) || cleanString(templateItem.type) || "Cost and Revenue Task";
    const taskPlannedStartDate = toIsoDate(cleanString(mapping.plannedStartDate || mapping.plannedStart) || templateItem.plannedStart, defaultQuoteDate);
    const taskPlannedEndDate = toIsoDate(
      cleanString(mapping.plannedEndDate || mapping.plannedEnd) || templateItem.plannedEnd,
      taskPlannedStartDate || defaultQuoteDate
    );
    const taxCategory = cleanString(mapping.taxCategory) || cleanString(templateItem.taxCategory) || "H";
    const revenueGroup = cleanString(mapping.revenueGroup) || cleanString(templateItem.accountGroup) || "R";
    const costCode = cleanString(mapping.costCode) || cleanString(templateItem.costCode);
    const labourUom = cleanString(mapping.labourUom) || "HOUR";
    const materialUom = cleanString(mapping.materialUom) || cleanString(templateItem.uom) || "EACH";
    const subtradeUom = cleanString(mapping.subtradeUom) || "EACH";
    const tradeDivision = displayDivisionTitle;
    const estimator =
      cleanString(mapping.estimator) || cleanString(division.estimator || division.estimatorId || division.estimatorCode);

    tasks.push({
      taskCd,
      description: taskDescription,
      type: taskType,
      default: false,
      taxCategory,
      plannedStartDate: taskPlannedStartDate,
      plannedEndDate: taskPlannedEndDate
    });

    const labour = division.labour || {};
    const materials = division.materials || { lines: [] };
    const subcontractor = division.subcontractor || { lines: [] };
    const isGlendale = divisionKey === "glendale";
    const subcontractorLabel = isGlendale ? "Consultant" : "Subtrade";
    const materialLineItems = (materials.lines || [])
      .map(normalizeInputCostLine)
      .filter((line) => line.cost > 0 || line.sell > 0 || cleanString(line.description));
    const subcontractorLineItems = (subcontractor.lines || [])
      .map(normalizeInputCostLine)
      .filter((line) => line.cost > 0 || line.sell > 0 || cleanString(line.description));
    const labourTotals = labour.noCost ? { totalHours: 0, totalCost: 0, totalSelling: 0 } : calcLabourTotals(labour, templateItem, divisionKey);
    const materialTotals = materials.noCost || isGlendale ? { costTotal: 0, sellTotal: 0, count: 0 } : sumLineTotals(materialLineItems);
    const subcontractorTotals = subcontractor.noCost ? { costTotal: 0, sellTotal: 0, count: 0 } : sumLineTotals(subcontractorLineItems);
    const divisionLineStart = lines.length;

    if (!labour.noCost) {
      const uom = labourUom;
      const templateCostRate = parseNumber(templateItem.costRate);
      const templateSellRate = parseNumber(templateItem.sellRate);
      getLabourRoleConfigs(divisionKey).forEach((role) => {
        const hours = parseNumber(labour[role.hoursField]);
        if (hours <= 0) return;
        const rate = parseNumber(labour[role.rateField]) || templateCostRate;
        const sellOverride = parseNumber(labour[role.sellField]);
        const unitPrice = sellOverride > 0 ? sellOverride / hours : templateSellRate || rate;
        lines.push(
          buildLinePayload({
            taskCd,
            description: `${taskDescription} - ${role.label}`,
            expenseGroup: "L",
            revenueGroup,
            costCode,
            uom,
            quantity: hours,
            unitCost: roundTo(rate, 2),
            unitPrice: roundTo(unitPrice || rate, 2),
            taxCategory,
            tradeDivision,
            ...(estimator ? { estimator } : {})
          })
        );
      });
    }

    if (!materials.noCost && !isGlendale) {
      materialLineItems.forEach((lineItem) => {
        const quantity = parseNumber(lineItem.quantity) || 1;
        const lineCost = parseNumber(lineItem.cost);
        const lineSell = parseNumber(lineItem.sell) > 0 ? parseNumber(lineItem.sell) : lineCost;
        lines.push(
          buildLinePayload({
            taskCd,
            description: `${taskDescription} - Material - ${cleanString(lineItem.description) || "Line item"}`,
            expenseGroup: cleanString(lineItem.expenseGroup) || "MQ",
            revenueGroup,
            // Keep estimation lines tied to the scope-mapped task cost code by default.
            costCode: costCode || cleanString(lineItem.costCode),
            uom: cleanString(lineItem.uom) || materialUom,
            quantity,
            unitCost: quantity > 0 ? roundTo(lineCost / quantity, 2) : roundTo(lineCost, 2),
            unitPrice: quantity > 0 ? roundTo(lineSell / quantity, 2) : roundTo(lineSell, 2),
            taxCategory: taxCategory || cleanString(lineItem.taxCategory),
            tradeDivision,
            ...(estimator ? { estimator } : {})
          })
        );
      });
    }

    if (!subcontractor.noCost) {
      subcontractorLineItems.forEach((lineItem) => {
        const quantity = parseNumber(lineItem.quantity) || 1;
        const lineCost = parseNumber(lineItem.cost);
        const lineSell = parseNumber(lineItem.sell) > 0 ? parseNumber(lineItem.sell) : lineCost;
        lines.push(
          buildLinePayload({
            taskCd,
            description: `${taskDescription} - ${subcontractorLabel} - ${cleanString(lineItem.description) || "Line item"}`,
            expenseGroup: cleanString(lineItem.expenseGroup) || "S",
            revenueGroup,
            // Keep estimation lines tied to the scope-mapped task cost code by default.
            costCode: costCode || cleanString(lineItem.costCode),
            uom: cleanString(lineItem.uom) || subtradeUom,
            quantity,
            unitCost: quantity > 0 ? roundTo(lineCost / quantity, 2) : roundTo(lineCost, 2),
            unitPrice: quantity > 0 ? roundTo(lineSell / quantity, 2) : roundTo(lineSell, 2),
            taxCategory: taxCategory || cleanString(lineItem.taxCategory),
            tradeDivision,
            ...(estimator ? { estimator } : {})
          })
        );
      });
    }

    breakdowns.push({
      divisionKey,
      sectionId: cleanString(division?.sectionId),
      tradeDivision,
      taskCd,
      taskDescription,
      costCode,
      templateMapping: {
        taskCd,
        description: taskDescription,
        costCode,
        revenueGroup,
        taxCategory,
        estimator,
        labourUom,
        materialUom,
        subtradeUom
      },
      scope: cleanString(division.scope),
      labour: {
        noCost: Boolean(labour.noCost),
        technicianHours: parseNumber(labour.technicianHours),
        technicianRate: parseNumber(labour.technicianRate) || parseNumber(templateItem.costRate),
        technicianSellingPrice:
          parseNumber(labour.technicianSellingPrice) > 0
            ? parseNumber(labour.technicianSellingPrice)
            : parseNumber(labour.technicianHours) * (parseNumber(templateItem.sellRate) || parseNumber(labour.technicianRate)),
        supervisionHours: parseNumber(labour.supervisionHours),
        supervisionRate: parseNumber(labour.supervisionRate) || parseNumber(templateItem.costRate),
        supervisionSellingPrice:
          parseNumber(labour.supervisionSellingPrice) > 0
            ? parseNumber(labour.supervisionSellingPrice)
            : parseNumber(labour.supervisionHours) * (parseNumber(templateItem.sellRate) || parseNumber(labour.supervisionRate)),
        engineerHours: parseNumber(labour.engineerHours),
        engineerRate: parseNumber(labour.engineerRate) || parseNumber(templateItem.costRate),
        engineerSellingPrice:
          parseNumber(labour.engineerSellingPrice) > 0
            ? parseNumber(labour.engineerSellingPrice)
            : parseNumber(labour.engineerHours) * (parseNumber(templateItem.sellRate) || parseNumber(labour.engineerRate)),
        seniorEngineerHours: parseNumber(labour.seniorEngineerHours),
        seniorEngineerRate: parseNumber(labour.seniorEngineerRate) || parseNumber(templateItem.costRate),
        seniorEngineerSellingPrice:
          parseNumber(labour.seniorEngineerSellingPrice) > 0
            ? parseNumber(labour.seniorEngineerSellingPrice)
            : parseNumber(labour.seniorEngineerHours) *
              (parseNumber(templateItem.sellRate) || parseNumber(labour.seniorEngineerRate)),
        projectManagerHours: parseNumber(labour.projectManagerHours),
        projectManagerRate: parseNumber(labour.projectManagerRate) || parseNumber(templateItem.costRate),
        projectManagerSellingPrice:
          parseNumber(labour.projectManagerSellingPrice) > 0
            ? parseNumber(labour.projectManagerSellingPrice)
            : parseNumber(labour.projectManagerHours) *
              (parseNumber(templateItem.sellRate) || parseNumber(labour.projectManagerRate)),
        totalHours: labourTotals.totalHours,
        totalCost: labourTotals.totalCost,
        totalSelling: labourTotals.totalSelling
      },
      material: {
        noCost: isGlendale ? true : Boolean(materials.noCost),
        totals: materialTotals,
        lines: isGlendale ? [] : materialLineItems
      },
      subcontractor: {
        noCost: Boolean(subcontractor.noCost),
        totals: subcontractorTotals,
        lines: subcontractorLineItems
      },
      estimateLines: lines.slice(divisionLineStart).map((line) => ({ ...line }))
    });
  }

  return { tasks, lines, breakdowns };
}

export function buildQuoteSummary(payload) {
  const accountName = payload.account?.name || payload.account?.displayName || "Unknown account";
  const type = payload.quoteType ? String(payload.quoteType).toLowerCase() : "quote";
  const date = new Date().toISOString().slice(0, 10);
  return `${accountName} ${type} ${date}`.trim();
}

export function buildQuoteDescription(payload, context = {}) {
  const summary = cleanString(context.summary || buildQuoteSummary(payload));
  const divisions = Array.isArray(payload.divisions) ? payload.divisions : [];
  const firstScope = cleanString(divisions.find((division) => cleanString(division.scope))?.scope);
  if (!firstScope) return summary;
  return `${firstScope} (${summary})`;
}

export function buildQuoteBackupSummary(payload, context = {}) {
  const summary = cleanString(context.summary || buildQuoteSummary(payload));
  const quoteType = cleanString(payload.quoteType || "production").toUpperCase();
  const accountName = payload.account?.name || payload.account?.displayName || "Unknown account";
  const breakdowns = Array.isArray(context.breakdowns) ? context.breakdowns.filter(Boolean) : [];
  const lines = Array.isArray(context.lines) ? context.lines : [];

  const totalsFromBreakdowns = breakdowns.reduce(
    (acc, breakdown) => {
      const sectionTotals = getBreakdownSectionTotals(breakdown);
      acc.totalCost += sectionTotals.totalCost;
      acc.totalSell += sectionTotals.totalSell;
      return acc;
    },
    { totalCost: 0, totalSell: 0 }
  );

  const totalsFromLines = {
    totalCost: lines.reduce((sum, line) => sum + parseNumber(line.unitCost) * parseNumber(line.quantity), 0),
    totalSell: lines.reduce((sum, line) => sum + parseNumber(line.unitPrice) * parseNumber(line.quantity), 0)
  };

  const totalCost = roundTo(
    breakdowns.length ? totalsFromBreakdowns.totalCost : totalsFromLines.totalCost,
    2
  );
  const totalSell = roundTo(
    breakdowns.length ? totalsFromBreakdowns.totalSell : totalsFromLines.totalSell,
    2
  );
  const markupPercent = totalCost > 0 ? roundTo(((totalSell - totalCost) / totalCost) * 100, 1) : 0;
  const marginPercent = totalSell > 0 ? roundTo(((totalSell - totalCost) / totalSell) * 100, 1) : 0;

  const sections = breakdowns.map((breakdown, index) => {
    const isGlendale = cleanString(breakdown.divisionKey) === "glendale";
    const subcontractorLabel = isGlendale ? "Consultant" : "Subtrade";
    const labour = breakdown.labour || {};
    const sectionTotals = getBreakdownSectionTotals(breakdown);
    const scopeLines = splitScopeIntoLines(breakdown.scope);
    const numberedScopeLines = scopeLines.length
      ? scopeLines.map((line, scopeIndex) => `${index + 1}.${String(scopeIndex + 1).padStart(2, "0")} ${line}`)
      : [`${index + 1}.01 No scope provided.`];
    const linesBySection = [
      `${index + 1}.00 ${cleanString(breakdown.tradeDivision) || "Division"}`,
      "Scope of Work",
      ...numberedScopeLines,
      `Template Task: ${cleanString(breakdown.taskCd) || "N/A"} - ${cleanString(breakdown.taskDescription) || "N/A"}`,
      `Labour: ${formatQuantity(labour.totalHours)} hrs | Cost ${formatMoney(sectionTotals.labourCost)} | Sell ${formatMoney(sectionTotals.labourSell)}`
    ];
    if (!isGlendale) {
      linesBySection.push(`Material: Cost ${formatMoney(sectionTotals.materialCost)} | Sell ${formatMoney(sectionTotals.materialSell)}`);
    }
    linesBySection.push(`${subcontractorLabel}: Cost ${formatMoney(sectionTotals.subcontractorCost)} | Sell ${formatMoney(sectionTotals.subcontractorSell)}`);
    linesBySection.push(
      `Division Totals: Budget ${formatMoney(sectionTotals.totalCost)} | Selling ${formatMoney(sectionTotals.totalSell)} | Margin ${formatPercent(
        sectionTotals.totalSell > 0 ? ((sectionTotals.totalSell - sectionTotals.totalCost) / sectionTotals.totalSell) * 100 : 0
      )}`
    );
    return linesBySection.join("\n");
  });

  const backupText = [
    "Main Estimate Backup (from template mapping)",
    `Summary: ${summary}`,
    `Account: ${accountName}`,
    `Quote Type: ${quoteType}`,
    `Built: ${new Date().toISOString().slice(0, 10)}`,
    `Generated At: ${new Date().toISOString()}`,
    `Project Budget: ${formatMoney(totalCost)}`,
    `Project Selling Price: ${formatMoney(totalSell)}`,
    `Markup: ${formatPercent(markupPercent)}`,
    `Margin: ${formatPercent(marginPercent)}`,
    `Grand Total: ${formatMoney(totalSell)}`,
    "",
    sections.length ? sections.join("\n\n") : "No division data available."
  ].join("\n");

  return backupText.length > 3900 ? `${backupText.slice(0, 3890)}...` : backupText;
}

export function buildQuoteScopeNote(payload, context = {}) {
  const accountName = payload.account?.name || payload.account?.displayName || "Unknown account";
  const quoteType = cleanString(payload.quoteType || "production");
  const breakdowns = Array.isArray(context.breakdowns) ? context.breakdowns.filter(Boolean) : [];

  const sections =
    breakdowns.length > 0
      ? breakdowns.map((breakdown, index) => buildDetailedBreakdownSection(index + 1, breakdown))
      : (payload.divisions || [])
          .map((division) => {
            const divisionKey = normalizeDivisionId(division.id || division.title);
            if (!divisionKey || divisionKey === "doordock") return null;
            return { division, divisionKey };
          })
          .filter(Boolean)
          .map(({ division, divisionKey }, index) => {
            const noteSection = buildNoteSection(division, divisionKey);
            return `${index + 1}. ${noteSection}`;
          });

  return [
    `Created from quoting app on ${new Date().toISOString()}.`,
    `Account: ${accountName}.`,
    `Quote Type: ${quoteType}.`,
    "",
    "Scope of Work and Estimation Plan:",
    sections.length ? sections.join("\n\n") : "No scope of work provided."
  ].join("\n");
}
