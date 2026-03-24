const DIVISIONS = [
  { id: "construction", title: "Construction" },
  { id: "electrical", title: "Electrical" },
  { id: "plumbing", title: "Plumbing" },
  { id: "hvac", title: "HVAC" },
  { id: "glendale", title: "Glendale" }
];

const FALLBACK_DIVISION_TEMPLATES = {
  construction: {
    taskCd: "CONGEN",
    description: "Construction Generic Scope",
    costCode: "061053",
    accountGroup: "R",
    taxCategory: "H",
    uom: "EACH"
  },
  electrical: {
    taskCd: "ELECGEN",
    description: "Electrical Generic Scope",
    costCode: "260500",
    accountGroup: "R",
    taxCategory: "H",
    uom: "EACH"
  },
  plumbing: {
    taskCd: "PLUMGEN",
    description: "Plumbing Generic Scope",
    costCode: "220500",
    accountGroup: "R",
    taxCategory: "H",
    uom: "EACH"
  },
  hvac: {
    taskCd: "HVACGEN",
    description: "HVAC Generic Scope",
    costCode: "230500",
    accountGroup: "R",
    taxCategory: "H",
    uom: "EACH"
  },
  glendale: {
    taskCd: "GLENGEN",
    description: "Glendale Generic Scope",
    costCode: "990000",
    accountGroup: "R",
    taxCategory: "H",
    uom: "EACH"
  }
};

const STORAGE_KEY = "mbq_web_token";
const ACCOUNTS_CACHE_KEY = "mbq_accounts_cache_v2";
const LOGIN_CREDENTIALS_KEY = "mbq_login_credentials_v1";
const MANUAL_SIGN_OUT_KEY = "mbq_manual_sign_out_v1";
const MULTI_TRADE_PROJECT_TYPE = "M-Trade";
const PROJECT_TYPE_BY_DIVISION = {
  construction: "Construct",
  electrical: "Electrical",
  plumbing: "Plumbing",
  hvac: "HVAC",
  glendale: "M-Trade"
};
const PROJECT_TYPE_BY_MODE = {
  production: "M-Trade",
  service: "M-Trade",
  glendale: "M-Trade"
};
const WORKSHEET_SUPERVISION_RATIO_BY_DIVISION = {
  construction: 0.15,
  electrical: 0.125,
  plumbing: 0.125,
  hvac: 0.125
};
const DEFAULT_ACCOUNT_PROVINCE = "ON";
const DEFAULT_ACCOUNT_COUNTRY = "CA";
const CANADIAN_POSTAL_CODE_REGEX = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;
const DEFAULT_LINK_TO_DRIVE_TEXT = "Made using MB Quoting Page";
const SCOPE_POLISH_MODES = {
  grammar: "grammar",
  context: "context",
  custom: "custom"
};
const AI_ESTIMATOR_CONSERVATIVENESS = 100;
const APPROVED_UOM_OPTIONS = [
  { value: "BOTTLE", label: "BOTTLE (EA)" },
  { value: "CAN", label: "CAN (EA)" },
  { value: "EA", label: "EA" },
  { value: "EACH", label: "EACH" },
  { value: "HOUR", label: "HOUR (HUR)" },
  { value: "ITEM", label: "ITEM" },
  { value: "KG", label: "KG (KGM)" },
  { value: "KM", label: "KM" },
  { value: "LB", label: "LB" },
  { value: "LFT", label: "LFT" },
  { value: "LITER", label: "LITER (LTR)" },
  { value: "M3", label: "M3" },
  { value: "METER", label: "METER (MTR)" },
  { value: "MINUTE", label: "MINUTE (MIN)" },
  { value: "PACK", label: "PACK (NMP)" },
  { value: "PALLET", label: "PALLET (EA)" },
  { value: "PIECE", label: "PIECE (PCB)" },
  { value: "SQFT", label: "SQFT" },
  { value: "TONNES", label: "TONNES (TNE)" },
  { value: "Y3", label: "Y3" }
];
const APPROVED_UOM_VALUES = new Set(APPROVED_UOM_OPTIONS.map((option) => option.value));
const TASK_PLAN_QUANTITY_STATUSES = new Set(["provided", "extracted", "assumed", "missing"]);
const NUMBER_WORD_TO_INT = new Map([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20]
]);
const COUNT_BASED_SCOPE_NOUNS = [
  "bay doors?",
  "single doors?",
  "man doors?",
  "doors?",
  "windows?",
  "fixtures?",
  "lights?",
  "panels?",
  "carriages?",
  "units?",
  "static units?",
  "systems?",
  "sections?",
  "stalls?",
  "outlets?",
  "washrooms?",
  "fans?",
  "pumps?",
  "valves?",
  "diffusers?",
  "locations?"
];
const COUNT_BASED_SCOPE_NOUN_PATTERN = COUNT_BASED_SCOPE_NOUNS.join("|");
const APP_BASE_PATH = (() => {
  const raw = document.body?.dataset?.appBasePath || "";
  const value = cleanString(raw);
  if (!value) return "";
  return value.startsWith("/") ? value.replace(/\/+$/, "") : `/${value.replace(/^\/+/, "").replace(/\/+$/, "")}`;
})();
const INTEGRATED_AUTH_MODE = String(document.body?.dataset?.integratedAuth || "")
  .trim()
  .toLowerCase() === "true";

const state = {
  token: localStorage.getItem(STORAGE_KEY) || "",
  username: "",
  company: "",
  sharedSession: false,
  integratedAuth: INTEGRATED_AUTH_MODE,
  accounts: [],
  accountsLoading: false,
  accountsLoadError: "",
  accountsFromCache: false,
  employees: [],
  employeesLoading: false,
  employeesLoadError: "",
  pricingBookEstimators: [],
  pricingBookEstimatorsLoading: false,
  pricingBookEstimatorsLoadError: "",
  newAccountSalesRepQuery: "",
  selectedNewAccountSalesRepId: "",
  contacts: [],
  accountQuery: "",
  selectedAccountId: "",
  selectedContactId: "",
  quoteType: "",
  willWinJob: "Yes",
  linkToDrive: DEFAULT_LINK_TO_DRIVE_TEXT,
  projectType: "",
  quoteBody: "",
  quoteDescription: "",
  quoteReviewConfirmed: false,
  quoteReviewSignerName: "",
  scopeSuggestion: "",
  scopeSuggestionNotes: "",
  aiValidation: null,
  estimatorClarifyingQuestions: [],
  estimatorClarificationAnswers: {},
  aiEstimatorConservativeness: AI_ESTIMATOR_CONSERVATIVENESS,
  prototypePanelOpen: true,
  prototypeScopeText: "",
  prototypeEstimateDraft: null,
  prototypeStatusMessage: "Estimate generator is ready.",
  prototypeStatusType: "info",
  templateCatalog: {},
  lastQuoteResult: null,
  divisionSections: [],
  estimateLibraryStatus: null,
  estimateLibrarySuggestions: {},
  historicalSectionAnchors: {}
};

const UNDO_HISTORY_LIMIT = 150;
const undoHistory = {
  undoStack: [],
  redoStack: [],
  restoring: false
};
const undoEditSessionTargets = new WeakSet();
let silentSessionRestorePromise = null;
let lastFailedSilentCredentialKey = "";
let prototypeStatusTimerId = 0;
let prototypeStatusStartedAt = 0;
let prototypeStatusBaseMessage = "";
let estimatorQuestionsAutoOpenSignature = "";
let estimatorQuestionsCompletionScopeSignature = "";
const builderAccordionState = {
  step3: true,
  step4: false,
  step5: false
};
let builderWorkflowUnlockedOnce = false;
const UNDO_SNAPSHOT_KEYS = [
  "quoteType",
  "willWinJob",
  "linkToDrive",
  "projectType",
  "quoteBody",
  "quoteDescription",
  "quoteReviewConfirmed",
  "quoteReviewSignerName",
  "scopeSuggestion",
  "scopeSuggestionNotes",
  "aiValidation",
  "estimatorClarifyingQuestions",
  "estimatorClarificationAnswers",
  "prototypePanelOpen",
  "prototypeScopeText",
  "prototypeEstimateDraft",
  "prototypeStatusMessage",
  "prototypeStatusType",
  "divisionSections",
  "selectedAccountId",
  "selectedContactId",
  "accountQuery",
  "contacts",
  "lastQuoteResult"
];

const el = {
  authBadge: document.getElementById("authBadge"),
  loginSection: document.getElementById("loginSection"),
  builderSection: document.getElementById("builderSection"),
  loginUsername: document.getElementById("loginUsername"),
  loginPassword: document.getElementById("loginPassword"),
  rememberPassword: document.getElementById("rememberPassword"),
  forgotPasswordBtn: document.getElementById("forgotPasswordBtn"),
  loginBtn: document.getElementById("loginBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  authStatus: document.getElementById("authStatus"),
  quoteTypeInputs: Array.from(document.querySelectorAll("input[name='departmentType']")),
  accountComboInput: document.getElementById("accountComboInput"),
  accountDropdown: document.getElementById("accountDropdown"),
  refreshAccountsBtn: document.getElementById("refreshAccountsBtn"),
  newAccountBtn: document.getElementById("newAccountBtn"),
  contactSelect: document.getElementById("contactSelect"),
  refreshContactsBtn: document.getElementById("refreshContactsBtn"),
  newContactBtn: document.getElementById("newContactBtn"),
  willWinJobSelect: document.getElementById("willWinJobSelect"),
  linkToDriveInput: document.getElementById("linkToDriveInput"),
  projectTypeInput: document.getElementById("projectTypeInput"),
  accountAddress: document.getElementById("accountAddress"),
  step2GateNotice: document.getElementById("step2GateNotice"),
  step3Section: document.getElementById("step3Section"),
  step4Section: document.getElementById("step4Section"),
  step5Section: document.getElementById("step5Section"),
  step3AccordionBtn: document.getElementById("step3AccordionBtn"),
  step4AccordionBtn: document.getElementById("step4AccordionBtn"),
  step5AccordionBtn: document.getElementById("step5AccordionBtn"),
  step3AccordionContent: document.getElementById("step3AccordionContent"),
  step4AccordionContent: document.getElementById("step4AccordionContent"),
  step5AccordionContent: document.getElementById("step5AccordionContent"),
  divisionsContainer: document.getElementById("divisionsContainer"),
  quoteBody: document.getElementById("quoteBody"),
  quoteDescription: document.getElementById("quoteDescription"),
  quoteReviewConfirmCheckbox: document.getElementById("quoteReviewConfirmCheckbox"),
  quoteReviewSignerInput: document.getElementById("quoteReviewSignerInput"),
  aiReviewFinalizeBtn: document.getElementById("aiReviewFinalizeBtn"),
  aiDescriptionBtn: document.getElementById("aiDescriptionBtn"),
  scopeFinalizeBtn: document.getElementById("scopeFinalizeBtn"),
  scopeBuildBtn: document.getElementById("scopeBuildBtn"),
  scopeSuggestBtn: document.getElementById("scopeSuggestBtn"),
  librarySuggestBtn: document.getElementById("librarySuggestBtn"),
  librarySyncBtn: document.getElementById("librarySyncBtn"),
  prototypeToggleBtn: document.getElementById("prototypeToggleBtn"),
  prototypePanel: document.getElementById("prototypePanel"),
  prototypeScopeInput: document.getElementById("prototypeScopeInput"),
  prototypeGenerateBtn: document.getElementById("prototypeGenerateBtn"),
  prototypeApplyBtn: document.getElementById("prototypeApplyBtn"),
  prototypeApproveBtn: document.getElementById("prototypeApproveBtn"),
  prototypeStatus: document.getElementById("prototypeStatus"),
  prototypePreview: document.getElementById("prototypePreview"),
  estimateLibraryStatus: document.getElementById("estimateLibraryStatus"),
  scopeCustomBtn: document.getElementById("scopeCustomBtn"),
  scopeCustomWrap: document.getElementById("scopeCustomWrap"),
  scopeCustomInstruction: document.getElementById("scopeCustomInstruction"),
  scopeCustomRunBtn: document.getElementById("scopeCustomRunBtn"),
  scopeCustomCancelBtn: document.getElementById("scopeCustomCancelBtn"),
  scopeCustomActions: document.getElementById("scopeCustomActions"),
  scopeApplySuggestionBtn: document.getElementById("scopeApplySuggestionBtn"),
  scopeGrammarBtn: document.getElementById("scopeGrammarBtn"),
  scopeSuggestionNotes: document.getElementById("scopeSuggestionNotes"),
  scopeSuggestionText: document.getElementById("scopeSuggestionText"),
  aiValidateBtn: document.getElementById("aiValidateBtn"),
  aiValidation: document.getElementById("aiValidation"),
  estimatorQuestionsModal: document.getElementById("estimatorQuestionsModal"),
  estimatorQuestionsStatus: document.getElementById("estimatorQuestionsStatus"),
  estimatorQuestionsList: document.getElementById("estimatorQuestionsList"),
  closeEstimatorQuestionsBtn: document.getElementById("closeEstimatorQuestionsBtn"),
  saveEstimatorQuestionsBtn: document.getElementById("saveEstimatorQuestionsBtn"),
  quoteMarkupSummary: document.getElementById("quoteMarkupSummary"),
  createQuoteBtn: document.getElementById("createQuoteBtn"),
  openQuoteBtn: document.getElementById("openQuoteBtn"),
  downloadPdfBtn: document.getElementById("downloadPdfBtn"),
  runStatus: document.getElementById("runStatus"),
  accountModal: document.getElementById("accountModal"),
  newAccountId: document.getElementById("newAccountId"),
  newAccountSalesRepId: document.getElementById("newAccountSalesRepId"),
  newAccountSalesRepInput: document.getElementById("newAccountSalesRepInput"),
  newAccountSalesRepDropdown: document.getElementById("newAccountSalesRepDropdown"),
  newAccountName: document.getElementById("newAccountName"),
  newAccountEmail: document.getElementById("newAccountEmail"),
  newAccountPhone: document.getElementById("newAccountPhone"),
  newAccountAddress1: document.getElementById("newAccountAddress1"),
  newAccountAddress2: document.getElementById("newAccountAddress2"),
  newAccountCity: document.getElementById("newAccountCity"),
  newAccountState: document.getElementById("newAccountState"),
  newAccountPostal: document.getElementById("newAccountPostal"),
  newAccountCountry: document.getElementById("newAccountCountry"),
  cancelAccountBtn: document.getElementById("cancelAccountBtn"),
  saveAccountBtn: document.getElementById("saveAccountBtn"),
  contactModal: document.getElementById("contactModal"),
  newContactFirstName: document.getElementById("newContactFirstName"),
  newContactLastName: document.getElementById("newContactLastName"),
  newContactDisplayName: document.getElementById("newContactDisplayName"),
  newContactEmail: document.getElementById("newContactEmail"),
  newContactPhone: document.getElementById("newContactPhone"),
  newContactClass: document.getElementById("newContactClass"),
  cancelContactBtn: document.getElementById("cancelContactBtn"),
  saveContactBtn: document.getElementById("saveContactBtn")
};

function cloneSerializable(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function createUndoSnapshot() {
  const snapshot = {};
  UNDO_SNAPSHOT_KEYS.forEach((key) => {
    snapshot[key] = cloneSerializable(state[key]);
  });
  return snapshot;
}

function getSnapshotSignature(snapshot) {
  try {
    return JSON.stringify(snapshot);
  } catch (_error) {
    return "";
  }
}

function recordUndoSnapshot(reason = "Edit") {
  if (undoHistory.restoring) return;
  const snapshot = createUndoSnapshot();
  const signature = getSnapshotSignature(snapshot);
  const top = undoHistory.undoStack[undoHistory.undoStack.length - 1];
  if (top && top.signature === signature) return;

  undoHistory.undoStack.push({
    reason: cleanString(reason) || "Edit",
    signature,
    snapshot
  });
  if (undoHistory.undoStack.length > UNDO_HISTORY_LIMIT) {
    undoHistory.undoStack.shift();
  }
  undoHistory.redoStack = [];
}

function applyUndoSnapshot(snapshot, { actionLabel = "Undo" } = {}) {
  if (!snapshot || typeof snapshot !== "object") return;
  undoHistory.restoring = true;
  try {
    UNDO_SNAPSHOT_KEYS.forEach((key) => {
      state[key] = cloneSerializable(snapshot[key]);
    });

    if (Array.isArray(el.quoteTypeInputs)) {
      el.quoteTypeInputs.forEach((input) => {
        input.checked = cleanString(input.value) === cleanString(state.quoteType);
      });
    }
    syncDepartmentGate();

    renderAccounts();
    if (el.accountComboInput) {
      const selectedAccount = getSelectedAccount();
      el.accountComboInput.value = selectedAccount ? cleanString(selectedAccount.name) : cleanString(state.accountQuery);
    }
    renderContacts();
    if (el.contactSelect) {
      el.contactSelect.value = cleanString(state.selectedContactId);
    }
    renderAccountAddress();

    if (el.willWinJobSelect) {
      el.willWinJobSelect.value = cleanString(state.willWinJob || "Yes") || "Yes";
    }
    if (el.linkToDriveInput) {
      el.linkToDriveInput.value = cleanString(state.linkToDrive || DEFAULT_LINK_TO_DRIVE_TEXT);
    }
    if (el.projectTypeInput) {
      el.projectTypeInput.value = cleanString(state.projectType);
    }
    if (el.quoteBody) {
      el.quoteBody.value = cleanString(state.quoteBody);
    }
    if (el.quoteDescription) {
      el.quoteDescription.value = cleanString(state.quoteDescription);
    }
    syncQuoteBodyTextareaSize();

    renderDivisions();
    renderScopeSuggestion();
    renderAiValidation();
    syncQuoteActionButtons();
  } finally {
    undoHistory.restoring = false;
  }

  showStatus(`${actionLabel} applied.`, "success");
}

function undoLastChange() {
  if (!undoHistory.undoStack.length) {
    showStatus("Nothing to undo.");
    return;
  }
  const currentSnapshot = createUndoSnapshot();
  const previous = undoHistory.undoStack.pop();
  undoHistory.redoStack.push({
    reason: previous.reason,
    signature: getSnapshotSignature(currentSnapshot),
    snapshot: currentSnapshot
  });
  if (undoHistory.redoStack.length > UNDO_HISTORY_LIMIT) {
    undoHistory.redoStack.shift();
  }
  applyUndoSnapshot(previous.snapshot, { actionLabel: "Undo" });
}

function redoLastChange() {
  if (!undoHistory.redoStack.length) {
    showStatus("Nothing to redo.");
    return;
  }
  const currentSnapshot = createUndoSnapshot();
  const next = undoHistory.redoStack.pop();
  undoHistory.undoStack.push({
    reason: next.reason,
    signature: getSnapshotSignature(currentSnapshot),
    snapshot: currentSnapshot
  });
  if (undoHistory.undoStack.length > UNDO_HISTORY_LIMIT) {
    undoHistory.undoStack.shift();
  }
  applyUndoSnapshot(next.snapshot, { actionLabel: "Redo" });
}

function recordUndoBeforeEdit(target, reason = "Edit") {
  if (!(target instanceof Element)) return;
  if (undoEditSessionTargets.has(target)) return;
  recordUndoSnapshot(reason);
  undoEditSessionTargets.add(target);
}

function closeUndoEditSession(target) {
  if (!(target instanceof Element)) return;
  undoEditSessionTargets.delete(target);
}

function isEditableUndoTarget(target) {
  if (!(target instanceof Element)) return false;
  if (target.closest("[contenteditable='true']")) return true;
  const tagName = cleanString(target.tagName).toLowerCase();
  if (tagName === "textarea") return true;
  if (tagName !== "input") return false;
  const inputType = cleanString(target.getAttribute("type") || "").toLowerCase();
  return !["checkbox", "radio", "button", "submit", "reset", "file"].includes(inputType);
}

function handleUndoRedoShortcut(event) {
  if (!event || undoHistory.restoring) return;
  const key = cleanString(event.key).toLowerCase();
  const hasModifier = Boolean(event.metaKey || event.ctrlKey);
  if (!hasModifier) return;
  if (key !== "z") return;
  if (isEditableUndoTarget(event.target)) return;

  event.preventDefault();
  if (event.shiftKey) {
    redoLastChange();
    return;
  }
  undoLastChange();
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStringList(values = []) {
  return Array.from(
    new Set(
      toArray(values)
        .map((item) => cleanString(item))
        .filter(Boolean)
    )
  );
}

function normalizeCanadianPostalCode(value) {
  const compact = cleanString(value)
    .toUpperCase()
    .replace(/[\s-]+/g, "");
  if (compact.length !== 6) return cleanString(value).toUpperCase();
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

function isValidCanadianPostalCode(value) {
  return CANADIAN_POSTAL_CODE_REGEX.test(cleanString(value));
}

function parseNumber(value, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  const raw = cleanString(value);
  if (!raw) return fallback;
  const normalized = raw.replace(/,/g, "");
  const parsed = Number(normalized);
  if (Number.isFinite(parsed)) return parsed;
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (match) {
    const recovered = Number(match[0]);
    if (Number.isFinite(recovered)) return recovered;
  }
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasNumericInput(value) {
  const raw = cleanString(value);
  if (!raw) return false;
  return Number.isFinite(parseNumber(raw, Number.NaN));
}

function clampNumber(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, parseNumber(value, min)));
}

function getAiConservativenessLabel(value) {
  const level = clampNumber(value, 0, 100);
  return `Higher Allowance (${level})`;
}

function syncAiEstimatorControls() {
  const level = AI_ESTIMATOR_CONSERVATIVENESS;
  state.aiEstimatorConservativeness = level;
}

function normalizeSearchText(value) {
  return cleanString(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeCostLineDescriptionKey(value = "") {
  return cleanString(value)
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d"'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasCostLineDescriptionDuplicate(lines = [], description = "") {
  const candidateKey = normalizeCostLineDescriptionKey(description);
  if (!candidateKey) return false;

  return lines.some((line) => {
    const existingKey = normalizeCostLineDescriptionKey(line?.description);
    if (!existingKey) return false;
    if (existingKey === candidateKey) return true;
    if (candidateKey.length >= 12 && existingKey.length >= 8) {
      return existingKey.includes(candidateKey) || candidateKey.includes(existingKey);
    }
    return false;
  });
}

function defaultDivisionState(id) {
  const glendaleMode = isGlendaleDivisionId(id);
  const hvacMode = !glendaleMode && isHvacDivisionId(id);
  return {
    id,
    selected: false,
    scope: "",
    templateTaskCd: "",
    templateDescription: "",
    templateCostCode: "",
    templateRevenueGroup: "R",
    templateTaxCategory: "H",
    templateEstimator: "",
    estimatorId: "",
    estimatorName: "",
    templateLabourUom: "HOUR",
    templateMaterialUom: "EACH",
    templateSubtradeUom: "EACH",
    labourNoCost: false,
    technicianHours: "",
    technicianRate: glendaleMode ? "60" : "85",
    technicianSellingPrice: glendaleMode ? "90" : hvacMode ? "140" : "130",
    supervisionHours: "",
    supervisionRate: glendaleMode ? "70" : "85",
    supervisionSellingPrice: glendaleMode ? "110" : hvacMode ? "140" : "130",
    projectManagerHours: "",
    projectManagerRate: glendaleMode ? "95" : hvacMode ? "110" : "95",
    projectManagerSellingPrice: glendaleMode ? "150" : hvacMode ? "165" : "150",
    engineerHours: "",
    engineerRate: glendaleMode ? "90" : "",
    engineerSellingPrice: glendaleMode ? "135" : "",
    seniorEngineerHours: "",
    seniorEngineerRate: glendaleMode ? "110" : "",
    seniorEngineerSellingPrice: glendaleMode ? "185" : "",
    estimateWorksheet: [],
    worksheetCollapsed: false,
    estimateRollup: {
      technicianHoursOrigin: "",
      supervisionHoursOrigin: "",
      projectManagerHoursOrigin: ""
    },
    materialNoCost: glendaleMode,
    materialLines: [],
    subcontractorNoCost: false,
    subcontractorLines: []
  };
}

function getDivisionDefinition(divisionId = "") {
  const normalized = normalizeDivisionKey(divisionId);
  return (
    DIVISIONS.find((division) => normalizeDivisionKey(division.id) === normalized) || {
      id: normalized || cleanString(divisionId),
      title: capitalize(normalized || cleanString(divisionId) || "Division")
    }
  );
}

function createSectionId(divisionId = "division") {
  const prefix = normalizeDivisionKey(divisionId) || "division";
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getDivisionSections() {
  return Array.isArray(state.divisionSections) ? state.divisionSections : [];
}

function getSelectedDivisionSections() {
  return getDivisionSections().filter((division) => division && division.selected !== false);
}

function getDivisionSection(sectionId = "") {
  const candidateId = cleanString(sectionId).toLowerCase();
  if (!candidateId) return null;
  return (
    getDivisionSections().find((division) => cleanString(division.sectionId).toLowerCase() === candidateId) || null
  );
}

function getAutoSectionTitle(divisionId = "", sectionNumber = 1) {
  const definition = getDivisionDefinition(divisionId);
  return `${definition.title} ${Math.max(1, parseNumber(sectionNumber, 1))}`;
}

function getDivisionDisplayTitle(division = {}) {
  const title = cleanString(division?.title || division?.customTitle);
  if (title) return title;
  return getAutoSectionTitle(division?.id, division?.sectionNumber || 1);
}

function getDivisionActionLabel(sectionId = "", fallback = "Division") {
  const division = getDivisionSection(sectionId);
  if (division) return getDivisionDisplayTitle(division);
  const definition = getDivisionDefinition(sectionId);
  return cleanString(definition.title || fallback) || fallback;
}

function getNextSectionNumber(divisionId = "") {
  const normalized = normalizeDivisionKey(divisionId);
  return (
    getDivisionSections().reduce((max, division) => {
      if (normalizeDivisionKey(division?.id) !== normalized) return max;
      return Math.max(max, parseNumber(division?.sectionNumber, 0));
    }, 0) + 1
  );
}

function setDivisionSectionTitle(division, rawTitle = "") {
  if (!division) return;
  const autoTitle = getAutoSectionTitle(division.id, division.sectionNumber || 1);
  const title = cleanString(rawTitle);
  if (!title) {
    division.customTitle = "";
    division.title = autoTitle;
    return;
  }
  division.customTitle = title === autoTitle ? "" : title;
  division.title = title;
}

function createDivisionSection(divisionId, options = {}) {
  const normalizedId = normalizeDivisionKey(divisionId);
  const sectionNumber = Math.max(1, parseNumber(options.sectionNumber, getNextSectionNumber(normalizedId)));
  const section = {
    ...defaultDivisionState(normalizedId),
    sectionId: cleanString(options.sectionId) || createSectionId(normalizedId),
    sectionNumber,
    customTitle: "",
    selected: options.selected !== false
  };
  setDivisionSectionTitle(section, cleanString(options.title || options.customTitle || getAutoSectionTitle(normalizedId, sectionNumber)));
  applyDivisionModeRules(section);
  return section;
}

function isGlendaleDivisionId(divisionId) {
  return cleanString(divisionId).toLowerCase() === "glendale";
}

function isHvacDivisionId(divisionId) {
  return cleanString(divisionId).toLowerCase() === "hvac";
}

function applyDivisionModeRules(division) {
  if (!division) return;
  if (isGlendaleDivisionId(division.id)) {
    division.materialNoCost = true;
    division.materialLines = [];
    if (!cleanString(division.technicianRate)) division.technicianRate = "60";
    if (!cleanString(division.technicianSellingPrice)) division.technicianSellingPrice = "90";
    if (!cleanString(division.supervisionRate)) division.supervisionRate = "70";
    if (!cleanString(division.supervisionSellingPrice)) division.supervisionSellingPrice = "110";
    if (!cleanString(division.projectManagerRate)) division.projectManagerRate = "95";
    if (!cleanString(division.projectManagerSellingPrice)) division.projectManagerSellingPrice = "150";
    if (!cleanString(division.engineerRate)) division.engineerRate = "90";
    if (!cleanString(division.engineerSellingPrice)) division.engineerSellingPrice = "135";
    if (!cleanString(division.seniorEngineerRate)) division.seniorEngineerRate = "110";
    if (!cleanString(division.seniorEngineerSellingPrice)) division.seniorEngineerSellingPrice = "185";
  } else {
    if (!cleanString(division.technicianRate)) division.technicianRate = "85";
    if (!cleanString(division.supervisionRate)) division.supervisionRate = "85";
    const defaultSellRate = isHvacDivisionId(division.id) ? "140" : "130";
    if (!cleanString(division.technicianSellingPrice)) division.technicianSellingPrice = defaultSellRate;
    if (!cleanString(division.supervisionSellingPrice)) division.supervisionSellingPrice = defaultSellRate;
    if (!cleanString(division.projectManagerRate)) division.projectManagerRate = "95";
    if (!cleanString(division.projectManagerSellingPrice)) division.projectManagerSellingPrice = isHvacDivisionId(division.id) ? "165" : "150";
  }
}

function getDivisionLabourRows(division) {
  if (isGlendaleDivisionId(division?.id)) {
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
      label: "General labour",
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

function getDivisionSubcontractorLabel(division) {
  return isGlendaleDivisionId(division?.id) ? "Consultant" : "Subtrade";
}

function ensureDivisionWorksheetDefaults(division) {
  if (!division) return;
  if (!Array.isArray(division.estimateWorksheet)) {
    division.estimateWorksheet = [];
  }
  if (typeof division.worksheetCollapsed !== "boolean") {
    division.worksheetCollapsed = false;
  }
  if (!division.estimateRollup || typeof division.estimateRollup !== "object") {
    division.estimateRollup = {};
  }
  if (!cleanString(division.estimateRollup.technicianHoursOrigin)) {
    division.estimateRollup.technicianHoursOrigin = "";
  }
  if (!cleanString(division.estimateRollup.supervisionHoursOrigin)) {
    division.estimateRollup.supervisionHoursOrigin = "";
  }
  if (!cleanString(division.estimateRollup.projectManagerHoursOrigin)) {
    division.estimateRollup.projectManagerHoursOrigin = "";
  }
}

function getDivisionWorksheetSupervisionRatio(divisionId = "") {
  const normalized = normalizeDivisionKey(divisionId);
  return WORKSHEET_SUPERVISION_RATIO_BY_DIVISION[normalized] || 0.125;
}

function normalizeWorksheetScopeKey(value = "") {
  return cleanString(value)
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d"'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createScopeLineKey(sourceText = "", occurrence = 1) {
  const normalized = normalizeWorksheetScopeKey(sourceText) || "scope-line";
  return `${normalized}-${Math.max(1, parseNumber(occurrence, 1))}`;
}

function normalizeDivisionKey(value) {
  const raw = cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!raw) return "";
  if (raw.includes("construct") || raw === "con") return "construction";
  if (raw.includes("elect") || raw === "ele") return "electrical";
  if (raw.includes("plumb") || raw === "plu") return "plumbing";
  if (raw.includes("hvac") || raw.includes("mechanical") || raw === "mec") return "hvac";
  if (raw.includes("glendale") || raw === "gln") return "glendale";
  return raw;
}

function defaultCostLine(kind = "material", defaults = {}) {
  const defaultUom = cleanString(defaults.uom) || "EACH";
  return {
    description: "",
    quantity: "1",
    uom: defaultUom,
    unitCost: "",
    costCode: cleanString(defaults.costCode),
    cost: "",
    markup: "50",
    sellingPrice: "",
    expenseGroup: kind === "subcontractor" ? "S" : "MQ",
    taxCategory: cleanString(defaults.taxCategory),
    autoGenerated: false,
    source: "",
    origin: "manual",
    scopeLineKey: "",
    sourceText: "",
    locked: false
  };
}

function getSelectedDivisionIds() {
  return getSelectedDivisionSections()
    .map((division) => normalizeDivisionKey(division?.id))
    .filter(Boolean);
}

function hasSelectedDepartment() {
  return Boolean(cleanString(state.quoteType));
}

function ensureDepartmentSelected(message = "Department selection is required before you continue.") {
  if (hasSelectedDepartment()) return true;
  showStatus(message, "error");
  return false;
}

function resolveAutoProjectType() {
  const selectedDivisionIds = Array.from(new Set(getSelectedDivisionIds()));
  if (selectedDivisionIds.length === 1) {
    return PROJECT_TYPE_BY_DIVISION[selectedDivisionIds[0]] || capitalize(selectedDivisionIds[0]);
  }
  if (selectedDivisionIds.length > 1) {
    return MULTI_TRADE_PROJECT_TYPE;
  }
  if (!hasSelectedDepartment()) {
    return "";
  }
  return PROJECT_TYPE_BY_MODE[state.quoteType] || "M-Trade";
}

function syncProjectTypeField() {
  state.projectType = cleanString(resolveAutoProjectType());
  if (el.projectTypeInput) {
    el.projectTypeInput.value = state.projectType;
  }
}

function isStepTwoComplete() {
  return hasSelectedDepartment() && Boolean(cleanString(state.selectedAccountId)) && Boolean(cleanString(state.selectedContactId));
}

function setBuilderAccordionOpen(stepKey = "step3", isOpen = false) {
  if (!Object.prototype.hasOwnProperty.call(builderAccordionState, stepKey)) return;
  builderAccordionState[stepKey] = Boolean(isOpen);
  const button = el[`${stepKey}AccordionBtn`];
  const content = el[`${stepKey}AccordionContent`];
  if (button) {
    button.setAttribute("aria-expanded", builderAccordionState[stepKey] ? "true" : "false");
    const meta = button.querySelector(".builder-step-toggle-meta");
    if (meta) {
      meta.textContent = builderAccordionState[stepKey] ? "Expanded" : "Collapsed";
    }
  }
  if (content) {
    content.classList.toggle("hidden", !builderAccordionState[stepKey]);
  }
}

function openBuilderAccordion(stepKey = "step3") {
  if (!Object.prototype.hasOwnProperty.call(builderAccordionState, stepKey)) return;
  Object.keys(builderAccordionState).forEach((key) => {
    builderAccordionState[key] = key === stepKey;
  });
  setBuilderAccordionOpen("step3", builderAccordionState.step3);
  setBuilderAccordionOpen("step4", builderAccordionState.step4);
  setBuilderAccordionOpen("step5", builderAccordionState.step5);
}

function syncBuilderWorkflowGate() {
  const unlocked = isStepTwoComplete();
  if (el.step2GateNotice) {
    el.step2GateNotice.classList.toggle("hidden", unlocked);
  }

  ["step3", "step4", "step5"].forEach((stepKey) => {
    const section = el[`${stepKey}Section`];
    if (section) {
      section.classList.toggle("hidden", !unlocked);
    }
  });

  if (unlocked && !builderWorkflowUnlockedOnce) {
    openBuilderAccordion("step3");
    builderWorkflowUnlockedOnce = true;
  }

  if (!unlocked) {
    builderAccordionState.step3 = false;
    builderAccordionState.step4 = false;
    builderAccordionState.step5 = false;
    builderWorkflowUnlockedOnce = false;
  }

  setBuilderAccordionOpen("step3", builderAccordionState.step3);
  setBuilderAccordionOpen("step4", builderAccordionState.step4);
  setBuilderAccordionOpen("step5", builderAccordionState.step5);
}

function syncDepartmentGate() {
  const departmentSelected = hasSelectedDepartment();
  const canUseContact = departmentSelected && Boolean(state.selectedAccountId);

  if (el.accountComboInput) {
    el.accountComboInput.disabled = !departmentSelected;
    el.accountComboInput.placeholder = departmentSelected
      ? "Start typing business account name"
      : "Select Department first";
    if (!departmentSelected) {
      closeAccountDropdown();
    }
  }
  if (el.refreshAccountsBtn) {
    el.refreshAccountsBtn.disabled = !departmentSelected || state.accountsLoading;
  }
  if (el.newAccountBtn) {
    el.newAccountBtn.disabled = !departmentSelected;
  }
  if (el.contactSelect) {
    el.contactSelect.disabled = !canUseContact;
  }
  if (el.refreshContactsBtn) {
    el.refreshContactsBtn.disabled = !canUseContact;
  }
  if (el.newContactBtn) {
    el.newContactBtn.disabled = !canUseContact;
  }
  syncBuilderWorkflowGate();
}

const toastState = {
  lastMessage: "",
  lastType: "",
  lastAtMs: 0
};
let runStatusNoteTimer = 0;
const errorDialogState = {
  target: null,
  lastMessage: "",
  lastAtMs: 0
};

function getToastContainer() {
  let container = document.getElementById("toastContainer");
  if (container) return container;

  container = document.createElement("div");
  container.id = "toastContainer";
  container.className = "toast-container";
  container.setAttribute("aria-live", "assertive");
  container.setAttribute("aria-atomic", "false");
  document.body.appendChild(container);
  return container;
}

function showToastNote(message, type = "info") {
  const text = cleanString(message);
  if (!text) return;

  const now = Date.now();
  if (
    toastState.lastMessage === text &&
    toastState.lastType === type &&
    now - toastState.lastAtMs < 1000
  ) {
    return;
  }

  toastState.lastMessage = text;
  toastState.lastType = type;
  toastState.lastAtMs = now;

  const container = getToastContainer();
  const toast = document.createElement("div");
  toast.className = `toast-note ${type}`;
  toast.textContent = text;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  container.appendChild(toast);

  const removeToast = () => {
    toast.classList.remove("visible");
    window.setTimeout(() => {
      toast.remove();
    }, 180);
  };

  toast.addEventListener("click", removeToast);
  window.requestAnimationFrame(() => {
    toast.classList.add("visible");
  });
  window.setTimeout(removeToast, type === "error" ? 5500 : 3500);
}

function showRunStatusNote(message, type = "error") {
  if (!el.runStatus) return;
  const text = cleanString(message);
  if (!text) return;

  const parent = el.runStatus.parentElement;
  if (!parent) return;

  let note = document.getElementById("runStatusNote");
  if (!note) {
    note = document.createElement("div");
    note.id = "runStatusNote";
    note.className = "run-status-note hidden";
    parent.insertBefore(note, el.runStatus);
  }

  note.textContent = text;
  note.className = `run-status-note ${type}`;
  note.classList.remove("hidden");

  if (runStatusNoteTimer) {
    window.clearTimeout(runStatusNoteTimer);
  }
  runStatusNoteTimer = window.setTimeout(() => {
    note.classList.add("hidden");
  }, 6000);
}

function resolveDivisionIdFromErrorText(text) {
  const value = cleanString(text).toLowerCase();
  const divisions = [...getSelectedDivisionSections()].sort(
    (left, right) => getDivisionDisplayTitle(right).length - getDivisionDisplayTitle(left).length
  );
  for (const division of divisions) {
    const title = cleanString(getDivisionDisplayTitle(division)).toLowerCase();
    if (value.startsWith(`${title} `) || value.startsWith(`${title}:`)) {
      return cleanString(division.sectionId);
    }
  }
  for (const division of DIVISIONS) {
    const title = cleanString(division.title).toLowerCase();
    if (value.startsWith(`${title} `) || value.startsWith(`${title}:`)) {
      const match = getSelectedDivisionSections().find(
        (section) => normalizeDivisionKey(section.id) === normalizeDivisionKey(division.id)
      );
      return cleanString(match?.sectionId);
    }
  }
  return "";
}

function findDivisionNode(divisionId, selector) {
  if (!el.divisionsContainer || !divisionId) return null;
  return el.divisionsContainer.querySelector(selector);
}

function extractScopeLintLineFromErrorText(message = "") {
  const raw = cleanString(message);
  if (!raw) return "";
  const quotedMatch = raw.match(/scope line requires measurable quantity:\s*"([^"]+)"/i);
  if (quotedMatch?.[1]) return cleanString(quotedMatch[1]);
  const singleQuotedMatch = raw.match(/scope line requires measurable quantity:\s*'([^']+)'/i);
  if (singleQuotedMatch?.[1]) return cleanString(singleQuotedMatch[1]);
  return "";
}

function normalizeScopeMatchToken(token = "") {
  const text = cleanString(token).toLowerCase();
  if (!text) return "";
  if (text.endsWith("ing") && text.length > 5) return text.slice(0, -3);
  if (text.endsWith("ed") && text.length > 4) return text.slice(0, -2);
  if (text.endsWith("ies") && text.length > 4) return `${text.slice(0, -3)}y`;
  if (/(ches|shes|xes|zes|ses)$/.test(text) && text.length > 5) return text.slice(0, -2);
  if (text.endsWith("s") && text.length > 3 && !text.endsWith("ss")) return text.slice(0, -1);
  return text;
}

function detectScopeCoverageFamilies(text = "") {
  const source = cleanString(text).toLowerCase();
  if (!source) return [];
  const families = [];
  const register = (key, pattern) => {
    if (pattern.test(source)) families.push(key);
  };
  register("asphalt", /\b(asphalt|hl8|hl3|pav(?:e|ing)|hot mix)\b/);
  register("gravel_base", /\b(gravel|aggregate|granular|base)\b/);
  register("parking_lines", /\b(parking lines?|line paint|line painting|striping|repaint)\b/);
  register("grading", /\b(grading|compact(?:ion)?|level(?:ing)?|drainage)\b/);
  register("disposal", /\b(dispos(?:e|al)|debris|haul(?:ing)?|loading|sawcut(?:ting)?)\b/);
  register("paint", /\b(paint|primer|coat)\b/);
  return families;
}

function findDivisionCostLineTargetForScopeLine(divisionId = "", scopeLine = "") {
  if (!divisionId || !el.divisionsContainer) return null;
  const targetScopeLine = cleanString(scopeLine);
  if (!targetScopeLine) return null;

  const scopeTokens = Array.from(
    new Set(
      tokenizeScopeLintText(targetScopeLine)
        .map((token) => normalizeScopeMatchToken(token))
        .filter(Boolean)
    )
  );
  if (!scopeTokens.length) return null;

  const descriptionInputs = Array.from(
    el.divisionsContainer.querySelectorAll(
      `[data-division="${divisionId}"][data-kind="material"][data-line-field="description"], ` +
        `[data-division="${divisionId}"][data-kind="subcontractor"][data-line-field="description"]`
    )
  );

  const rankedMatches = descriptionInputs
    .map((descriptionInput) => {
      const description = cleanString(descriptionInput?.value);
      const lineTokens = Array.from(
        new Set(
          tokenizeScopeLintText(description)
            .map((token) => normalizeScopeMatchToken(token))
            .filter(Boolean)
        )
      );
      if (!lineTokens.length) return null;
      let overlap = 0;
      scopeTokens.forEach((scopeToken) => {
        if (lineTokens.includes(scopeToken)) overlap += 1;
      });
      if (overlap <= 0) return null;

      const kind = cleanString(descriptionInput?.dataset?.kind);
      const lineIndex = parseNumber(descriptionInput?.dataset?.lineIndex, -1);
      const quantityInput =
        lineIndex >= 0
          ? findDivisionNode(
              divisionId,
              `[data-division="${divisionId}"][data-kind="${kind}"][data-line-index="${lineIndex}"][data-line-field="quantity"]`
            )
          : null;
      const quantityMissing = !hasNumericInput(quantityInput?.value);
      return {
        overlap,
        quantityMissing,
        descriptionInput,
        quantityInput
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.overlap !== b.overlap) return b.overlap - a.overlap;
      if (a.quantityMissing !== b.quantityMissing) return a.quantityMissing ? -1 : 1;
      return 0;
    });

  const bestMatch = rankedMatches[0];
  if (!bestMatch) return null;
  return bestMatch.quantityInput || bestMatch.descriptionInput || null;
}

function resolveErrorTargetElement(message, context = "builder") {
  const rawText = cleanString(message);
  const text = rawText.toLowerCase();
  if (!text) return null;

  if (context === "auth") {
    if (text.includes("username")) return el.loginUsername || null;
    if (text.includes("password")) return el.loginPassword || null;
  }

  if (text.includes("link to drive")) return el.linkToDriveInput || null;
  if (text.includes("cost review confirmation")) return el.quoteReviewConfirmCheckbox || null;
  if (text.includes("estimator name confirming the cost review")) return el.quoteReviewSignerInput || null;
  if (text.includes("business account is required") || text.includes("select a business account")) {
    return el.accountComboInput || null;
  }
  if (text.includes("contact selection is required")) return el.contactSelect || null;
  if (text.includes("at least one division") || text.includes("at least one trade section")) {
    return el.divisionsContainer || null;
  }
  if (text.includes("do you think we are going to win this job")) return el.willWinJobSelect || null;
  if (text.includes("project type is required")) return el.projectTypeInput || null;
  if (text.includes("project description")) return el.quoteDescription || null;
  if (text.includes("new account name is required")) return el.newAccountName || null;
  if (text.includes("sales rep is required")) return el.newAccountSalesRepInput || null;
  if (text.includes("first name is required")) return el.newContactFirstName || null;
  if (text.includes("last name is required")) return el.newContactLastName || null;
  if (text.includes("email is required") && !text.includes("account")) return el.newContactEmail || null;
  if (text.includes("phone is required")) return el.newContactPhone || null;
  if (text.includes("contact class is required")) return el.newContactClass || null;

  const divisionId = resolveDivisionIdFromErrorText(text);
  if (text.includes("scope line requires measurable quantity")) {
    const scopeLine = extractScopeLintLineFromErrorText(rawText);
    return (
      findDivisionCostLineTargetForScopeLine(divisionId, scopeLine) ||
      findDivisionNode(divisionId, `[data-division="${divisionId}"][data-field="scope"]`) ||
      el.quoteBody ||
      null
    );
  }
  if (!divisionId) return null;

  if (text.includes("scope of work")) {
    return findDivisionNode(divisionId, `[data-division="${divisionId}"][data-field="scope"]`);
  }
  if (text.includes("sr. engineer") || text.includes("senior engineer")) {
    return findDivisionNode(divisionId, `[data-division="${divisionId}"][data-field="seniorEngineerHours"]`);
  }
  if (text.includes("engineer")) {
    return findDivisionNode(divisionId, `[data-division="${divisionId}"][data-field="engineerHours"]`);
  }
  if (text.includes("project manager")) {
    return findDivisionNode(divisionId, `[data-division="${divisionId}"][data-field="projectManagerHours"]`);
  }
  if (text.includes("architect") || text.includes("supervision")) {
    return findDivisionNode(divisionId, `[data-division="${divisionId}"][data-field="supervisionHours"]`);
  }
  if (text.includes("estimator")) {
    return findDivisionNode(divisionId, `[data-division="${divisionId}"][data-field="estimatorId"]`);
  }
  if (text.includes("design") || text.includes("general labour") || text.includes("labour")) {
    return findDivisionNode(divisionId, `[data-division="${divisionId}"][data-field="technicianHours"]`);
  }
  if (text.includes("material line")) {
    return (
      findDivisionNode(
        divisionId,
        `[data-division="${divisionId}"][data-kind="material"][data-line-field="description"]`
      ) ||
      findDivisionNode(
        divisionId,
        `[data-action="add-line"][data-division="${divisionId}"][data-kind="material"]`
      ) ||
      findDivisionNode(divisionId, `[data-division="${divisionId}"][data-field="materialNoCost"]`)
    );
  }
  if (text.includes("subtrade line") || text.includes("consultant line")) {
    return (
      findDivisionNode(
        divisionId,
        `[data-division="${divisionId}"][data-kind="subcontractor"][data-line-field="description"]`
      ) ||
      findDivisionNode(
        divisionId,
        `[data-action="add-line"][data-division="${divisionId}"][data-kind="subcontractor"]`
      ) ||
      findDivisionNode(divisionId, `[data-division="${divisionId}"][data-field="subcontractorNoCost"]`)
    );
  }

  if (text.includes("material")) {
    return (
      findDivisionNode(
        divisionId,
        `[data-action="add-line"][data-division="${divisionId}"][data-kind="material"]`
      ) || findDivisionNode(divisionId, `[data-division="${divisionId}"][data-field="materialNoCost"]`)
    );
  }
  if (text.includes("subtrade") || text.includes("consultant")) {
    return (
      findDivisionNode(
        divisionId,
        `[data-action="add-line"][data-division="${divisionId}"][data-kind="subcontractor"]`
      ) || findDivisionNode(divisionId, `[data-division="${divisionId}"][data-field="subcontractorNoCost"]`)
    );
  }

  return null;
}

function focusErrorTarget(target) {
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  window.setTimeout(() => {
    try {
      if (typeof target.focus === "function") {
        target.focus({ preventScroll: true });
      }
    } catch (_error) {
      if (typeof target.focus === "function") target.focus();
    }
    target.classList.add("error-target-flash");
    window.setTimeout(() => {
      target.classList.remove("error-target-flash");
    }, 1300);
  }, 250);
}

function hideErrorDialog() {
  const overlay = document.getElementById("errorDialogOverlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
  document.body.classList.remove("has-error-dialog");
}

function getErrorDialogElements() {
  let overlay = document.getElementById("errorDialogOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "errorDialogOverlay";
    overlay.className = "error-dialog-overlay hidden";
    overlay.innerHTML = `
      <div class="error-dialog" role="alertdialog" aria-modal="true" aria-labelledby="errorDialogTitle" aria-describedby="errorDialogMessage">
        <h3 id="errorDialogTitle">Please Fix This First</h3>
        <p id="errorDialogMessage"></p>
        <div class="row end">
          <button id="errorDialogAcceptBtn" class="btn primary">Accept</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const acceptBtn = overlay.querySelector("#errorDialogAcceptBtn");
    if (acceptBtn) {
      acceptBtn.addEventListener("click", () => {
        const target = errorDialogState.target;
        hideErrorDialog();
        focusErrorTarget(target);
      });
    }
  }

  return {
    overlay,
    messageEl: overlay.querySelector("#errorDialogMessage"),
    acceptBtn: overlay.querySelector("#errorDialogAcceptBtn")
  };
}

function showBlockingErrorDialog(message, options = {}) {
  const text = cleanString(message);
  if (!text) return;

  const now = Date.now();
  if (errorDialogState.lastMessage === text && now - errorDialogState.lastAtMs < 250) {
    return;
  }
  errorDialogState.lastMessage = text;
  errorDialogState.lastAtMs = now;
  errorDialogState.target = options.target || resolveErrorTargetElement(text, options.context || "builder");

  const { overlay, messageEl, acceptBtn } = getErrorDialogElements();
  if (messageEl) messageEl.textContent = text;
  overlay.classList.remove("hidden");
  document.body.classList.add("has-error-dialog");
  if (acceptBtn) {
    window.requestAnimationFrame(() => {
      acceptBtn.focus();
    });
  }
}

function showStatus(message, type = "info") {
  const text = cleanString(message);
  if (el.runStatus) {
    el.runStatus.textContent = text;
    el.runStatus.classList.remove("error-text", "success-text");
  }
  showRunStatusNote(text, type);
  showToastNote(text, type);
  if (type === "error") {
    if (el.runStatus) {
      el.runStatus.classList.add("error-text");
    }
    showBlockingErrorDialog(text, { context: "builder" });
  }
  if (type === "success" && el.runStatus) {
    el.runStatus.classList.add("success-text");
  }
}

function showAuthStatus(message, type = "info") {
  if (!el.authStatus) return;
  el.authStatus.textContent = message;
  el.authStatus.classList.remove("error-text", "success-text");
  if (type === "error") {
    el.authStatus.classList.add("error-text");
    showBlockingErrorDialog(message, { context: "auth" });
  }
  if (type === "success") el.authStatus.classList.add("success-text");
}

function sortAccounts(accounts = []) {
  return [...accounts].sort((a, b) => cleanString(a.name).localeCompare(cleanString(b.name)));
}

function sortEmployees(employees = []) {
  return [...employees].sort((a, b) => cleanString(a.name).localeCompare(cleanString(b.name)));
}

function sortPricingBookEstimators(items = []) {
  return [...items].sort((a, b) => cleanString(a.name).localeCompare(cleanString(b.name)));
}

function getPricingBookEstimatorById(estimatorId = "") {
  const id = cleanString(estimatorId).toUpperCase();
  if (!id) return null;
  return state.pricingBookEstimators.find((item) => cleanString(item?.id).toUpperCase() === id) || null;
}

function syncDivisionEstimatorName(division) {
  if (!division) return;
  const selected = getPricingBookEstimatorById(division.estimatorId || division.templateEstimator);
  division.estimatorName = cleanString(selected?.name || division.estimatorName);
  if (!cleanString(division.templateEstimator) && cleanString(division.estimatorId)) {
    division.templateEstimator = cleanString(division.estimatorId).toUpperCase();
  }
}

function getQuoteReviewStatement() {
  return "I've reviewed and confirm that the material, subtrade and labour cost are accurate to the best of my ability.";
}

function isQuoteReviewConfirmationComplete() {
  return Boolean(state.quoteReviewConfirmed) && Boolean(cleanString(state.quoteReviewSignerName));
}

function resetQuoteReviewConfirmation({ keepSignerName = true } = {}) {
  state.quoteReviewConfirmed = false;
  if (!keepSignerName) {
    state.quoteReviewSignerName = "";
  }
  if (el.quoteReviewConfirmCheckbox) {
    el.quoteReviewConfirmCheckbox.checked = false;
  }
  if (el.quoteReviewSignerInput) {
    el.quoteReviewSignerInput.value = cleanString(state.quoteReviewSignerName);
  }
}

function readAccountsCache() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.items)) return [];
    return sortAccounts(parsed.items);
  } catch (_error) {
    return [];
  }
}

function writeAccountsCache(accounts = []) {
  try {
    localStorage.setItem(
      ACCOUNTS_CACHE_KEY,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        items: sortAccounts(accounts)
      })
    );
  } catch (_error) {
    // Ignore localStorage write failures.
  }
}

function readSavedCredentials() {
  try {
    const raw = localStorage.getItem(LOGIN_CREDENTIALS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const username = cleanString(parsed?.username);
    const password = cleanString(parsed?.password);
    const remember = Boolean(parsed?.remember);
    if (!remember || !username || !password) return null;
    return { username, password };
  } catch (_error) {
    return null;
  }
}

function saveCredentials(username, password) {
  const user = cleanString(username);
  const pass = cleanString(password);
  if (!user || !pass) return;
  lastFailedSilentCredentialKey = "";
  try {
    localStorage.setItem(
      LOGIN_CREDENTIALS_KEY,
      JSON.stringify({
        username: user,
        password: pass,
        remember: true
      })
    );
  } catch (_error) {
    // Ignore localStorage write failures.
  }
}

function clearSavedCredentials() {
  lastFailedSilentCredentialKey = "";
  try {
    localStorage.removeItem(LOGIN_CREDENTIALS_KEY);
  } catch (_error) {
    // Ignore localStorage removal failures.
  }
}

function hydrateSavedCredentials() {
  if (el.rememberPassword) el.rememberPassword.checked = true;
  const saved = readSavedCredentials();
  if (!saved) return false;
  if (el.loginUsername) el.loginUsername.value = saved.username;
  if (el.loginPassword) el.loginPassword.value = saved.password;
  if (el.rememberPassword) el.rememberPassword.checked = true;
  return true;
}

function buildSavedCredentialKey(credentials = {}) {
  const username = cleanString(credentials?.username);
  const password = cleanString(credentials?.password);
  return username && password ? `${username}\n${password}` : "";
}

function readManualSignOutPreference() {
  try {
    return localStorage.getItem(MANUAL_SIGN_OUT_KEY) === "1";
  } catch (_error) {
    return false;
  }
}

function setManualSignOutPreference(isSignedOut) {
  try {
    if (isSignedOut) {
      localStorage.setItem(MANUAL_SIGN_OUT_KEY, "1");
      return;
    }
    localStorage.removeItem(MANUAL_SIGN_OUT_KEY);
  } catch (_error) {
    // Ignore localStorage write failures.
  }
}

function clearStoredSessionToken() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_error) {
    // Ignore localStorage removal failures.
  }
}

function resolveAppPath(path) {
  const normalizedPath = cleanString(path);
  if (!normalizedPath) return APP_BASE_PATH || "/";
  if (/^https?:\/\//i.test(normalizedPath)) return normalizedPath;
  const absolutePath = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
  return `${APP_BASE_PATH}${absolutePath}`;
}

function hasAuthenticatedSession() {
  return Boolean(state.token || state.integratedAuth);
}

function applyAuthenticatedSession(result = {}) {
  state.token = cleanString(result.token);
  state.username = cleanString(result.username);
  state.company = cleanString(result.company);
  state.sharedSession = Boolean(result.sharedSession);
  state.integratedAuth = Boolean(result.integratedAuth) || INTEGRATED_AUTH_MODE;
  if (state.token) {
    localStorage.setItem(STORAGE_KEY, state.token);
  } else {
    clearStoredSessionToken();
  }
  setManualSignOutPreference(false);
  setAuthUI(Boolean(state.token || state.integratedAuth));
}

function buildApiRequestHeaders(options = {}) {
  const headers = {
    ...(options.headers || {})
  };
  const authToken = cleanString(options.authToken);
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

async function performApiRequest(path, options = {}) {
  const response = await fetch(resolveAppPath(path), {
    method: options.method || "GET",
    headers: buildApiRequestHeaders(options),
    body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin"
  });

  const contentType = response.headers.get("content-type") || "";
  const asJson = contentType.includes("application/json");
  const payload = asJson ? await response.json() : await response.text();
  return { response, payload, asJson };
}

function buildApiRequestError(response, payload, asJson) {
  const message = asJson
    ? payload?.error || payload?.message || `Request failed (${response.status})`
    : `Request failed (${response.status})`;
  const error = new Error(message);
  error.status = response.status;
  error.payload = payload;
  return error;
}

async function requestAcumaticaSession({ username = "", password = "" } = {}) {
  if (INTEGRATED_AUTH_MODE) {
    const { response, payload, asJson } = await performApiRequest("/api/acumatica/session");
    if (!response.ok) {
      throw buildApiRequestError(response, payload, asJson);
    }
    return payload;
  }
  const { response, payload, asJson } = await performApiRequest("/api/acumatica/login", {
    method: "POST",
    body: {
      name: cleanString(username),
      password: cleanString(password),
      company: "MeadowBrook Live"
    }
  });
  if (!response.ok) {
    throw buildApiRequestError(response, payload, asJson);
  }
  return payload;
}

async function loadAuthenticatedAppData() {
  if (hasSelectedDepartment() && !hydrateAccountsFromCache()) {
    await loadAccounts({ force: true });
  }
  try {
    await loadPricingBookEstimators({ force: false });
  } catch (error) {
    console.warn("[estimators] Unable to preload pricing-book estimator list.", error?.message || error);
  }
  await loadTemplateCatalog();
  await loadEstimateLibraryStatus({ silent: true });
}

async function restoreSavedSession() {
  const savedCredentials = readSavedCredentials();
  if (!savedCredentials || readManualSignOutPreference()) {
    return { restored: false, error: null };
  }

  const credentialKey = buildSavedCredentialKey(savedCredentials);
  if (credentialKey && credentialKey === lastFailedSilentCredentialKey) {
    return {
      restored: false,
      error: new Error("Stored credentials could not restore the session. Sign in again.")
    };
  }

  if (silentSessionRestorePromise) {
    return silentSessionRestorePromise;
  }

  silentSessionRestorePromise = (async () => {
    try {
      const result = await requestAcumaticaSession(savedCredentials);
      applyAuthenticatedSession(result);
      lastFailedSilentCredentialKey = "";
      if (el.loginUsername) el.loginUsername.value = savedCredentials.username;
      if (el.loginPassword) el.loginPassword.value = savedCredentials.password;
      if (el.rememberPassword) el.rememberPassword.checked = true;
      return { restored: true, error: null };
    } catch (error) {
      lastFailedSilentCredentialKey = credentialKey;
      return { restored: false, error };
    } finally {
      silentSessionRestorePromise = null;
    }
  })();

  return silentSessionRestorePromise;
}

function hydrateAccountsFromCache() {
  const cached = readAccountsCache();
  if (!cached.length) return false;
  state.accounts = cached;
  state.accountsFromCache = true;
  state.accountsLoadError = "";
  renderAccounts();
  renderAccountAddress();
  showStatus(
    `Loaded ${cached.length} cached accounts. Click Refresh Accounts when you want new data.`,
    "success"
  );
  return true;
}

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
}

function resetResult() {
  state.lastQuoteResult = null;
  syncQuoteActionButtons();
}

function resolveCurrentQuoteNumber() {
  return cleanString(state.lastQuoteResult?.quoteNbr);
}

function resolveCurrentQuoteUrl() {
  const directUrl = cleanString(state.lastQuoteResult?.quoteUrl);
  if (directUrl) return directUrl;
  return "";
}

function syncQuoteActionButtons() {
  const hasQuote = Boolean(resolveCurrentQuoteUrl() || resolveCurrentQuoteNumber());
  if (el.openQuoteBtn) {
    el.openQuoteBtn.disabled = !hasQuote;
  }
}

async function openCurrentQuote() {
  let quoteUrl = resolveCurrentQuoteUrl();
  const quoteNbr = resolveCurrentQuoteNumber();

  if (!quoteUrl && quoteNbr) {
    try {
      setBusy(el.openQuoteBtn, true);
      const lookup = await apiFetch(`/api/quote/${encodeURIComponent(quoteNbr)}/url`);
      quoteUrl = cleanString(lookup?.quoteUrl);
      if (quoteUrl) {
        state.lastQuoteResult = {
          ...(state.lastQuoteResult || {}),
          quoteNbr,
          quoteUrl
        };
        syncQuoteActionButtons();
      }
    } catch (error) {
      showStatus(error.message, "error");
      return;
    } finally {
      setBusy(el.openQuoteBtn, false);
    }
  }

  if (!quoteUrl) {
    showStatus("Create a quote first to open it in Acumatica.", "error");
    return;
  }
  window.open(quoteUrl, "_blank", "noopener,noreferrer");
}

function getSelectedAccount() {
  return state.accounts.find((account) => account.businessAccountId === state.selectedAccountId) || null;
}

function getSelectedContact() {
  return state.contacts.find((contact) => contact.contactId === state.selectedContactId) || null;
}

function getSelectedNewAccountSalesRep() {
  return (
    state.employees.find((employee) => cleanString(employee.employeeId) === cleanString(state.selectedNewAccountSalesRepId)) ||
    null
  );
}

function formatAddress(account) {
  const address = account?.address || {};
  const parts = [address.street, `${address.city || ""}${address.state ? `, ${address.state}` : ""} ${address.zip || ""}`.trim(), address.country].filter(Boolean);
  return parts.length ? parts.join("\n") : "No address on file.";
}

function formatAccountAddressInline(account) {
  const address = account?.address || {};
  const cityStateZip = [cleanString(address.city), cleanString(address.state), cleanString(address.zip)]
    .filter(Boolean)
    .join(" ");
  const parts = [cleanString(address.street), cityStateZip, cleanString(address.country)].filter(Boolean);
  return parts.length ? parts.join(" • ") : "No address on file.";
}

async function apiFetch(path, options = {}) {
  const { response, payload, asJson } = await performApiRequest(path, {
    ...options,
    authToken: state.token
  });

  if (response.status === 401 && !options.skipAuthRecovery) {
    const recovery = await restoreSavedSession();
    if (recovery.restored) {
      return apiFetch(path, {
        ...options,
        skipAuthRecovery: true
      });
    }
  }

  if (response.status === 401) {
    hardSignOut("Session expired. Please sign in again.", "error");
  }

  if (!response.ok) {
    throw buildApiRequestError(response, payload, asJson);
  }

  return payload;
}

function clearEstimateLibraryState() {
  state.estimateLibraryStatus = null;
  state.estimateLibrarySuggestions = {};
  state.historicalSectionAnchors = {};
  renderEstimateLibraryStatus();
}

function normalizeEstimateLibraryStatus(raw = {}) {
  const run = raw?.run || {};
  return {
    run: {
      id: cleanString(run?.id),
      status: cleanString(run?.status || "idle"),
      startedAt: cleanString(run?.startedAt),
      updatedAt: cleanString(run?.updatedAt),
      completedAt: cleanString(run?.completedAt),
      filesProcessed: parseNumber(run?.filesProcessed, 0),
      filesImported: parseNumber(run?.filesImported, 0),
      filesSkipped: parseNumber(run?.filesSkipped, 0),
      filesFailed: parseNumber(run?.filesFailed, 0),
      reviewCount: parseNumber(run?.reviewCount, 0),
      presetCountUpdated: parseNumber(run?.presetCountUpdated, 0),
      latestMessage: cleanString(run?.latestMessage)
    },
    serviceAccountEmail: cleanString(raw?.serviceAccountEmail),
    driveFolderId: cleanString(raw?.driveFolderId),
    firestoreEnabled: Boolean(raw?.firestoreEnabled),
    firestoreProjectId: cleanString(raw?.firestoreProjectId),
    reviews: Array.isArray(raw?.reviews) ? raw.reviews : []
  };
}

function renderEstimateLibraryStatus() {
  if (!el.estimateLibraryStatus) return;
  const status = state.estimateLibraryStatus;
  if (!status || !status.run?.id) {
    el.estimateLibraryStatus.textContent = "Estimate library is idle.";
    el.estimateLibraryStatus.classList.remove("error-text", "success-text");
    return;
  }
  const run = status.run;
  const parts = [
    `Library ${run.status || "idle"}`,
    `${run.filesImported} imported`,
    `${run.filesSkipped} skipped`,
    `${run.filesFailed} failed`,
    `${run.reviewCount} review item${run.reviewCount === 1 ? "" : "s"}`
  ];
  if (run.presetCountUpdated > 0) {
    parts.push(`${run.presetCountUpdated} preset${run.presetCountUpdated === 1 ? "" : "s"} updated`);
  }
  if (run.latestMessage) {
    parts.push(run.latestMessage);
  }
  el.estimateLibraryStatus.textContent = parts.join(" • ");
  el.estimateLibraryStatus.classList.remove("error-text", "success-text");
  if (run.status === "completed") {
    el.estimateLibraryStatus.classList.add("success-text");
  }
}

function hasAppliedPrototypeSections() {
  return getSelectedDivisionSections().some((division) => Boolean(division?.prototypeGenerated));
}

function setPrototypeStatus(message = "Estimate generator is ready.", type = "info") {
  state.prototypeStatusMessage = cleanString(message) || "Estimate generator is ready.";
  state.prototypeStatusType = cleanString(type || "info").toLowerCase() || "info";
  renderPrototypeEstimatePanel();
}

function formatElapsedClock(totalMs = 0) {
  const totalSeconds = Math.max(0, Math.floor(parseNumber(totalMs, 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function syncPrototypeGenerateButtonLabel() {
  if (!el.prototypeGenerateBtn) return;
  if (prototypeStatusStartedAt > 0) {
    el.prototypeGenerateBtn.textContent = `Generating... ${formatElapsedClock(Date.now() - prototypeStatusStartedAt)}`;
    return;
  }
  el.prototypeGenerateBtn.textContent = "Generate Estimate";
}

function stopPrototypeStatusTimer() {
  if (prototypeStatusTimerId) {
    window.clearInterval(prototypeStatusTimerId);
  }
  prototypeStatusTimerId = 0;
  prototypeStatusStartedAt = 0;
  prototypeStatusBaseMessage = "";
  syncPrototypeGenerateButtonLabel();
}

function refreshPrototypeLoadingStatus() {
  if (prototypeStatusStartedAt <= 0) return;
  const baseMessage = cleanString(prototypeStatusBaseMessage || "Reading master scope and generating estimate...");
  state.prototypeStatusMessage = `${baseMessage} ${formatElapsedClock(Date.now() - prototypeStatusStartedAt)} elapsed`;
  state.prototypeStatusType = "info";
  syncPrototypeGenerateButtonLabel();
  renderPrototypeEstimatePanel();
}

function startPrototypeLoadingStatus(message = "Reading master scope and generating estimate...") {
  stopPrototypeStatusTimer();
  prototypeStatusStartedAt = Date.now();
  prototypeStatusBaseMessage = cleanString(message) || "Reading master scope and generating estimate...";
  refreshPrototypeLoadingStatus();
  prototypeStatusTimerId = window.setInterval(refreshPrototypeLoadingStatus, 1000);
}

function normalizePrototypeWorksheetRow(row = {}) {
  return {
    sectionId: cleanString(row?.sectionId),
    divisionId: normalizeDivisionKey(row?.divisionId),
    scopeLineKey: cleanString(row?.scopeLineKey),
    lineNumber: cleanString(row?.lineNumber),
    sourceText: cleanString(row?.sourceText || row?.normalizedText),
    generalLabourHours: Math.max(0, parseNumber(row?.generalLabourHours, 0)),
    supervisionHours: Math.max(0, parseNumber(row?.supervisionHours, 0)),
    projectManagerHours: Math.max(0, parseNumber(row?.projectManagerHours, 0)),
    materialAllowanceCost: Math.max(0, parseNumber(row?.materialAllowanceCost, 0)),
    subtradeAllowanceCost: Math.max(0, parseNumber(row?.subtradeAllowanceCost, 0)),
    confidence: Math.max(0.05, Math.min(0.99, parseNumber(row?.confidence, 0.55))),
    assumptions: uniqueStringList(toArray(row?.assumptions)),
    riskFlags: uniqueStringList(toArray(row?.riskFlags)),
    missingInputs: uniqueStringList(toArray(row?.missingInputs)),
    needsReview: Boolean(row?.needsReview),
    materialSuggestions: toArray(row?.materialSuggestions).map((suggestion) => ({
      description: cleanString(suggestion?.description),
      quantity: Math.max(0, parseNumber(suggestion?.quantity, 0)),
      uom: cleanString(suggestion?.uom || "EACH"),
      unitCost: Math.max(0, parseNumber(suggestion?.unitCost, 0)),
      cost: Math.max(0, parseNumber(suggestion?.cost, 0)),
      markup: Math.max(0, parseNumber(suggestion?.markup, 0)),
      sellingPrice: Math.max(0, parseNumber(suggestion?.sellingPrice, 0)),
      confidence: Math.max(0.05, Math.min(0.99, parseNumber(suggestion?.confidence, 0.55))),
      assumptions: uniqueStringList(toArray(suggestion?.assumptions)),
      riskFlags: uniqueStringList(toArray(suggestion?.riskFlags))
    }))
  };
}

function normalizePrototypeDetailedItem(item = {}) {
  return {
    taskName: cleanString(item?.taskName),
    scopeNote: cleanString(item?.scopeNote),
    type: cleanString(item?.type || "material").toLowerCase(),
    description: cleanString(item?.description),
    quantity: Math.max(0, parseNumber(item?.quantity, 0)),
    quantityStatus: cleanString(item?.quantityStatus),
    uom: cleanString(item?.uom || "EACH"),
    cost: Math.max(0, parseNumber(item?.cost, 0)),
    markup: Math.max(0, parseNumber(item?.markup, 0)),
    sellingPrice: Math.max(0, parseNumber(item?.sellingPrice, 0)),
    specStatus: cleanString(item?.specStatus),
    confidence: Math.max(0.05, Math.min(0.99, parseNumber(item?.confidence, 0.55))),
    assumptions: uniqueStringList(toArray(item?.assumptions)),
    riskFlags: uniqueStringList(toArray(item?.riskFlags))
  };
}

function normalizePrototypeSection(section = {}) {
  return {
    sectionId: cleanString(section?.sectionId || createSectionId(section?.divisionId || "prototype")),
    divisionId: normalizeDivisionKey(section?.divisionId || section?.id || section?.title),
    title: cleanString(section?.title || section?.divisionId),
    scopeText: cleanString(section?.scopeText),
    scopeSummary: cleanString(section?.scopeSummary || section?.scopeText),
    confidence: Math.max(0.05, Math.min(0.99, parseNumber(section?.confidence, 0.55))),
    needsReview: Boolean(section?.needsReview),
    assumptions: uniqueStringList(toArray(section?.assumptions)),
    riskFlags: uniqueStringList(toArray(section?.riskFlags)),
    scopeLines: toArray(section?.scopeLines).map((line, index) => ({
      scopeLineKey: cleanString(line?.scopeLineKey || `prototype-scope-${index + 1}`),
      lineNumber: cleanString(line?.lineNumber || String(index + 1)),
      sourceText: cleanString(line?.sourceText || line?.text || line?.normalizedText)
    })),
    worksheetRows: toArray(section?.worksheetRows).map(normalizePrototypeWorksheetRow),
    tasks: toArray(section?.tasks).map((task) => ({
      sectionId: cleanString(task?.sectionId),
      divisionId: normalizeDivisionKey(task?.divisionId),
      taskName: cleanString(task?.taskName),
      scopeNote: cleanString(task?.scopeNote),
      lineSuggestions: toArray(task?.lineSuggestions).map(normalizePrototypeDetailedItem)
    })),
    detailedItems: toArray(section?.detailedItems).map(normalizePrototypeDetailedItem),
    labour: {
      technicianHours: Math.max(0, parseNumber(section?.labour?.technicianHours, 0)),
      technicianRate: Math.max(0, parseNumber(section?.labour?.technicianRate, 0)),
      technicianSellingPrice: Math.max(0, parseNumber(section?.labour?.technicianSellingPrice, 0)),
      supervisionHours: Math.max(0, parseNumber(section?.labour?.supervisionHours, 0)),
      supervisionRate: Math.max(0, parseNumber(section?.labour?.supervisionRate, 0)),
      supervisionSellingPrice: Math.max(0, parseNumber(section?.labour?.supervisionSellingPrice, 0)),
      engineerHours: Math.max(0, parseNumber(section?.labour?.engineerHours, 0)),
      engineerRate: Math.max(0, parseNumber(section?.labour?.engineerRate, 0)),
      engineerSellingPrice: Math.max(0, parseNumber(section?.labour?.engineerSellingPrice, 0)),
      seniorEngineerHours: Math.max(0, parseNumber(section?.labour?.seniorEngineerHours, 0)),
      seniorEngineerRate: Math.max(0, parseNumber(section?.labour?.seniorEngineerRate, 0)),
      seniorEngineerSellingPrice: Math.max(0, parseNumber(section?.labour?.seniorEngineerSellingPrice, 0)),
      projectManagerHours: Math.max(0, parseNumber(section?.labour?.projectManagerHours, 0)),
      projectManagerRate: Math.max(0, parseNumber(section?.labour?.projectManagerRate, 0)),
      projectManagerSellingPrice: Math.max(0, parseNumber(section?.labour?.projectManagerSellingPrice, 0))
    }
  };
}

function normalizePrototypeEstimateDraft(raw = {}) {
  const sections = toArray(raw?.sections).map(normalizePrototypeSection).filter((section) => section.divisionId);
  return {
    draftId: cleanString(raw?.draftId || `prototype-${Date.now()}`),
    generatedAt: cleanString(raw?.generatedAt),
    pricingPosture: cleanString(raw?.pricingPosture || "premium_high") || "premium_high",
    strategy: cleanString(raw?.strategy),
    scopeText: cleanString(raw?.scopeText || raw?.masterScope),
    generatedByAI: Boolean(raw?.generatedByAI),
    usedHistoricalLibrary: Boolean(raw?.usedHistoricalLibrary),
    historicalRowsApplied: Math.max(0, parseNumber(raw?.historicalRowsApplied, 0)),
    anchoredSectionCount: Math.max(0, parseNumber(raw?.anchoredSectionCount, 0)),
    historicalSectionAnchors: Array.isArray(raw?.historicalSectionAnchors) ? raw.historicalSectionAnchors : [],
    sections
  };
}

function formatPrototypeItemSummary(item = {}) {
  const quantity = Math.max(0, parseNumber(item?.quantity, 0));
  const quantityText = quantity > 0 ? `${formatNumberForInput(quantity)} ${cleanString(item?.uom || "EACH")}` : cleanString(item?.quantityStatus || "missing");
  const sellText = Math.max(0, parseNumber(item?.sellingPrice, 0)) > 0 ? formatCurrency(item?.sellingPrice) : "TBD";
  return `${cleanString(item?.description || "Item")} • ${quantityText} • Sell ${sellText}`;
}

function renderPrototypeEstimatePanel() {
  if (el.prototypePanel) {
    el.prototypePanel.classList.toggle("hidden", !state.prototypePanelOpen);
  }
  if (el.prototypeToggleBtn) {
    el.prototypeToggleBtn.textContent = state.prototypePanelOpen ? "Hide Prototype" : "Show Prototype";
  }
  if (el.prototypeScopeInput && el.prototypeScopeInput.value !== state.prototypeScopeText) {
    el.prototypeScopeInput.value = cleanString(state.prototypeScopeText);
  }
  syncPrototypeGenerateButtonLabel();
  if (el.prototypeStatus) {
    el.prototypeStatus.textContent = cleanString(state.prototypeStatusMessage || "Estimate generator is ready.");
    el.prototypeStatus.classList.remove("error-text", "success-text");
    if (state.prototypeStatusType === "error") {
      el.prototypeStatus.classList.add("error-text");
    } else if (state.prototypeStatusType === "success") {
      el.prototypeStatus.classList.add("success-text");
    }
  }

  const draft = state.prototypeEstimateDraft;
  const hasDraft = Boolean(draft && Array.isArray(draft.sections) && draft.sections.length);
  if (el.prototypeApplyBtn) {
    el.prototypeApplyBtn.disabled = !hasDraft;
  }
  if (el.prototypeApproveBtn) {
    el.prototypeApproveBtn.disabled = !(hasDraft && hasAppliedPrototypeSections());
  }
  if (!el.prototypePreview) return;
  if (!hasDraft) {
    el.prototypePreview.innerHTML = `<p class="hint prototype-preview-empty">No estimate generated yet.</p>`;
    return;
  }

  const totalDetailedItems = draft.sections.reduce((sum, section) => sum + toArray(section?.detailedItems).length, 0);
  const summaryBadges = [
    `${draft.sections.length} section${draft.sections.length === 1 ? "" : "s"}`,
    `${totalDetailedItems} detailed item${totalDetailedItems === 1 ? "" : "s"}`,
    `${draft.pricingPosture || "premium_high"}`,
    draft.anchoredSectionCount > 0 ? `${draft.anchoredSectionCount} historical anchor${draft.anchoredSectionCount === 1 ? "" : "s"}` : "",
    draft.generatedByAI ? "AI generated" : "fallback generated"
  ].filter(Boolean);

  el.prototypePreview.innerHTML = `
    <div class="prototype-summary">
      ${summaryBadges.map((badge) => `<span class="prototype-badge">${escapeHtml(badge)}</span>`).join("")}
    </div>
    ${draft.strategy ? `<p class="hint">${escapeHtml(draft.strategy)}</p>` : ""}
    <div class="prototype-grid">
      ${draft.sections
        .map((section) => {
          const labour = section.labour || {};
          const totalFieldHours =
            parseNumber(labour.technicianHours, 0) +
            parseNumber(labour.supervisionHours, 0) +
            parseNumber(labour.engineerHours, 0) +
            parseNumber(labour.seniorEngineerHours, 0) +
            parseNumber(labour.projectManagerHours, 0);
          const totalMaterialAllowance = toArray(section.worksheetRows).reduce(
            (sum, row) => sum + Math.max(0, parseNumber(row?.materialAllowanceCost, 0)),
            0
          );
          const totalSubtradeAllowance = toArray(section.worksheetRows).reduce(
            (sum, row) => sum + Math.max(0, parseNumber(row?.subtradeAllowanceCost, 0)),
            0
          );
          return `
            <article class="prototype-card">
              <div class="prototype-card-head">
                <div>
                  <p class="prototype-trade">${escapeHtml(getDivisionDefinition(section.divisionId).title)}</p>
                  <h4>${escapeHtml(section.title || getDivisionDefinition(section.divisionId).title)}</h4>
                  ${section.scopeSummary ? `<p class="hint">${escapeHtml(section.scopeSummary)}</p>` : ""}
                </div>
                <div class="prototype-meta">
                  <span class="prototype-badge">${escapeHtml(formatWorksheetConfidence(section.confidence || 0.55))}</span>
                  ${section.needsReview ? `<span class="prototype-badge">Needs review</span>` : ""}
                </div>
              </div>
              <div class="prototype-stats">
                <div class="prototype-stat">
                  <strong>Scope Rows</strong>
                  <span>${escapeHtml(String(toArray(section.scopeLines).length))}</span>
                </div>
                <div class="prototype-stat">
                  <strong>Detailed Items</strong>
                  <span>${escapeHtml(String(toArray(section.detailedItems).length))}</span>
                </div>
                <div class="prototype-stat">
                  <strong>Labour Hrs</strong>
                  <span>${escapeHtml(formatNumberForInput(totalFieldHours))}</span>
                </div>
                <div class="prototype-stat">
                  <strong>Material Allowance</strong>
                  <span>${escapeHtml(formatCurrency(totalMaterialAllowance))}</span>
                </div>
                <div class="prototype-stat">
                  <strong>Subtrade Allowance</strong>
                  <span>${escapeHtml(formatCurrency(totalSubtradeAllowance))}</span>
                </div>
              </div>
              ${
                toArray(section.detailedItems).length
                  ? `
                    <p class="prototype-subhead">Detailed Breakdown</p>
                    <ul class="prototype-detail-list">
                      ${toArray(section.detailedItems)
                        .slice(0, 8)
                        .map((item) => `<li>${escapeHtml(formatPrototypeItemSummary(item))}</li>`)
                        .join("")}
                    </ul>
                  `
                  : ""
              }
              ${
                toArray(section.assumptions).length
                  ? `
                    <p class="prototype-subhead">Assumptions</p>
                    <ul class="prototype-assumption-list">
                      ${toArray(section.assumptions)
                        .slice(0, 4)
                        .map((item) => `<li>${escapeHtml(item)}</li>`)
                        .join("")}
                    </ul>
                  `
                  : ""
              }
              ${
                toArray(section.riskFlags).length
                  ? `
                    <p class="prototype-subhead">Risk Flags</p>
                    <ul class="prototype-flag-list">
                      ${toArray(section.riskFlags)
                        .slice(0, 4)
                        .map((item) => `<li>${escapeHtml(item)}</li>`)
                        .join("")}
                    </ul>
                  `
                  : ""
              }
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

async function loadEstimateLibraryStatus({ silent = true } = {}) {
  if (!hasAuthenticatedSession()) {
    clearEstimateLibraryState();
    return null;
  }
  try {
    const result = await apiFetch("/api/estimate-library/sync/latest");
    state.estimateLibraryStatus = normalizeEstimateLibraryStatus(result);
    renderEstimateLibraryStatus();
    return state.estimateLibraryStatus;
  } catch (error) {
    if (!silent) {
      showStatus(error.message, "error");
    }
    return null;
  }
}

function buildEstimateLibrarySuggestPayload() {
  return {
    divisions: getSelectedDivisionSections().map((division) => ({
      id: cleanString(division.id),
      sectionId: cleanString(division.sectionId),
      title: getDivisionDisplayTitle(division),
      scope: cleanString(division.scope),
      scopeLines: buildScopeLineItemsForWorksheet(division.scope)
    }))
  };
}

function normalizeEstimateLibraryMatch(match = {}) {
  return {
    id: cleanString(match?.id || match?.presetId),
    presetId: cleanString(match?.presetId || match?.id),
    presetKey: cleanString(match?.presetKey),
    displayDescription: cleanString(match?.displayDescription),
    sampleCount: parseNumber(match?.sampleCount, 0),
    confidence: Math.max(0.05, Math.min(0.99, parseNumber(match?.confidence, 0.2))),
    score: parseNumber(match?.score, 0),
    lexicalScore: parseNumber(match?.lexicalScore, 0),
    semanticScore: parseNumber(match?.semanticScore, 0),
    stats: match?.stats || {},
    sourceExamples: Array.isArray(match?.sourceExamples) ? match.sourceExamples : [],
    applyPreview: match?.applyPreview || {}
  };
}

function normalizeEstimateLibraryScopeSuggestion(item = {}) {
  return {
    scopeLineKey: cleanString(item?.scopeLineKey),
    lineNumber: cleanString(item?.lineNumber),
    sourceText: cleanString(item?.sourceText),
    matches: Array.isArray(item?.matches) ? item.matches.map(normalizeEstimateLibraryMatch) : []
  };
}

function normalizeHistoricalSectionAnchor(anchor = {}) {
  return {
    sectionId: cleanString(anchor?.sectionId),
    divisionId: cleanString(anchor?.divisionId),
    title: cleanString(anchor?.title),
    confidence: Math.max(0.05, Math.min(0.99, parseNumber(anchor?.confidence, 0.2))),
    mode: cleanString(anchor?.mode),
    matchedQuoteId: cleanString(anchor?.matchedQuoteId),
    matchedFileName: cleanString(anchor?.matchedFileName),
    matchedFileUrl: cleanString(anchor?.matchedFileUrl),
    matchedSectionHeading: cleanString(anchor?.matchedSectionHeading),
    archivedSubtotal: anchor?.archivedSection?.subtotal || anchor?.archivedSubtotal || {}
  };
}

function setHistoricalSectionAnchors(anchors = []) {
  const next = {};
  toArray(anchors).forEach((anchor) => {
    const normalized = normalizeHistoricalSectionAnchor(anchor);
    if (!normalized.sectionId) return;
    next[normalized.sectionId] = normalized;
  });
  state.historicalSectionAnchors = next;
}

function getHistoricalSectionAnchorForSection(sectionId = "") {
  const key = cleanString(sectionId);
  return key ? state.historicalSectionAnchors?.[key] || null : null;
}

function setEstimateLibrarySuggestions(result = {}) {
  const next = {};
  const sections = Array.isArray(result?.sections) ? result.sections : [];
  sections.forEach((section) => {
    const sectionId = cleanString(section?.sectionId);
    if (!sectionId) return;
    next[sectionId] = Array.isArray(section?.suggestions)
      ? section.suggestions.map(normalizeEstimateLibraryScopeSuggestion)
      : [];
  });
  state.estimateLibrarySuggestions = next;
  setHistoricalSectionAnchors(result?.historicalSectionAnchors);
  if (result?.libraryStatus) {
    state.estimateLibraryStatus = normalizeEstimateLibraryStatus({
      ...(state.estimateLibraryStatus || {}),
      run: result.libraryStatus
    });
  }
  renderEstimateLibraryStatus();
}

function getEstimateLibrarySuggestionsForSection(sectionId = "") {
  return Array.isArray(state.estimateLibrarySuggestions?.[cleanString(sectionId)])
    ? state.estimateLibrarySuggestions[cleanString(sectionId)]
    : [];
}

function makeHistoricalAnchorSummary(sectionId = "") {
  const anchor = getHistoricalSectionAnchorForSection(sectionId);
  if (!anchor) return "";
  const archivedCost = parseNumber(anchor?.archivedSubtotal?.totalCost, 0);
  const archivedSell = parseNumber(anchor?.archivedSubtotal?.totalSell, 0);
  return `
    <div class="history-shell">
      <div class="section-head">
        <p class="section-caption">Archived Quote Anchor</p>
        <span class="worksheet-summary">${escapeHtml(formatWorksheetConfidence(anchor?.confidence || 0))} confidence • ${escapeHtml(cleanString(anchor?.mode || "soft"))}</span>
      </div>
      <div class="history-match-card">
        <div class="history-match-top">
          <div>
            <p class="history-match-title">${escapeHtml(cleanString(anchor?.matchedSectionHeading || anchor?.title || "Archived section"))}</p>
            <p class="history-match-meta">${escapeHtml(cleanString(anchor?.matchedFileName || anchor?.matchedQuoteId || "Historical quote"))}</p>
          </div>
        </div>
        <div class="history-match-stats">
          <span>Archived cost ${formatCurrency(archivedCost)}</span>
          <span>Archived sell ${formatCurrency(archivedSell)}</span>
        </div>
      </div>
    </div>
  `;
}

async function handleEstimateLibrarySync() {
  if (!hasAuthenticatedSession()) {
    showStatus("Sign in first to sync the estimate library.", "error");
    return;
  }
  const runId =
    cleanString(state.estimateLibraryStatus?.run?.status) === "running"
      ? cleanString(state.estimateLibraryStatus?.run?.id)
      : "";
  setBusy(el.librarySyncBtn, true);
  showStatus("Syncing historical estimate library...");
  try {
    const result = await apiFetch("/api/estimate-library/sync", {
      method: "POST",
      body: { runId }
    });
    state.estimateLibraryStatus = normalizeEstimateLibraryStatus(result);
    renderEstimateLibraryStatus();
    const run = state.estimateLibraryStatus.run;
    showStatus(
      `Estimate library ${run.status}: ${run.filesImported} imported, ${run.filesSkipped} skipped, ${run.filesFailed} failed.`,
      run.status === "completed" ? "success" : "success"
    );
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(el.librarySyncBtn, false);
  }
}

async function handleEstimateLibrarySuggest() {
  const selectedDivisions = getSelectedDivisionSections();
  if (!selectedDivisions.length) {
    showStatus("Add at least one trade section before requesting historical suggestions.", "error");
    return;
  }
  const hasScope = selectedDivisions.some((division) => cleanString(division.scope));
  if (!hasScope) {
    showStatus("Add scope details first so historical suggestions have something to match.", "error");
    return;
  }
  setBusy(el.librarySuggestBtn, true);
  showStatus("Matching current scope against historical estimate library...");
  try {
    const result = await apiFetch("/api/estimate-library/suggest", {
      method: "POST",
      body: buildEstimateLibrarySuggestPayload()
    });
    setEstimateLibrarySuggestions(result);
    renderDivisions();
    const matchCount = Object.values(state.estimateLibrarySuggestions).reduce((sum, items) => {
      return sum + items.reduce((innerSum, item) => innerSum + (Array.isArray(item.matches) ? item.matches.length : 0), 0);
    }, 0);
    const anchoredSectionCount = Object.keys(state.historicalSectionAnchors || {}).length;
    showStatus(
      `Historical suggestions ready: ${anchoredSectionCount} section anchor${anchoredSectionCount === 1 ? "" : "s"}, ${matchCount} row match${matchCount === 1 ? "" : "es"}.`,
      "success"
    );
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(el.librarySuggestBtn, false);
  }
}

function buildPrototypeEstimatePayload(scopeText = "") {
  return {
    quoteType: cleanString(state.quoteType || "production"),
    pricingPosture: "premium_high",
    masterScope: cleanString(scopeText),
    divisions: getSelectedDivisionSections().map((division) => ({
      id: cleanString(division.id),
      sectionId: cleanString(division.sectionId),
      title: getDivisionDisplayTitle(division),
      scope: cleanString(division.scope),
      scopeLines: buildScopeLineItemsForWorksheet(division.scope)
    }))
  };
}

function applyPrototypeLabourFields(division, section = {}) {
  if (!division || !section?.labour) return;
  const labourFields = [
    "technicianHours",
    "technicianRate",
    "technicianSellingPrice",
    "supervisionHours",
    "supervisionRate",
    "supervisionSellingPrice",
    "engineerHours",
    "engineerRate",
    "engineerSellingPrice",
    "seniorEngineerHours",
    "seniorEngineerRate",
    "seniorEngineerSellingPrice",
    "projectManagerHours",
    "projectManagerRate",
    "projectManagerSellingPrice"
  ];
  labourFields.forEach((field) => {
    const value = parseNumber(section?.labour?.[field], Number.NaN);
    if (!Number.isFinite(value) || value <= 0) return;
    division[field] = formatNumberForInput(value);
  });
}

function removePrototypeGeneratedSections() {
  const retained = getDivisionSections().filter((division) => !Boolean(division?.prototypeGenerated));
  const removedCount = getDivisionSections().length - retained.length;
  state.divisionSections = retained;
  return removedCount;
}

function applyPrototypeEstimateDraft(draft = state.prototypeEstimateDraft) {
  const normalizedDraft = normalizePrototypeEstimateDraft(draft);
  if (!Array.isArray(normalizedDraft.sections) || !normalizedDraft.sections.length) {
    return {
      appliedSections: 0,
      glendaleTaskSections: 0
    };
  }

  removePrototypeGeneratedSections();
  const glendaleTasks = [];
  normalizedDraft.sections.forEach((section, index) => {
    const division = createDivisionSection(section.divisionId, {
      sectionId: cleanString(section.sectionId) || createSectionId(section.divisionId || `prototype-${index + 1}`),
      title: cleanString(section.title || getDivisionDefinition(section.divisionId).title),
      selected: true,
      sectionNumber: getNextSectionNumber(section.divisionId)
    });
    division.prototypeGenerated = true;
    division.prototypeDraftId = cleanString(normalizedDraft.draftId);
    division.worksheetCollapsed = !isGlendaleDivisionId(division.id);
    division.scope = cleanString(section.scopeText || toArray(section.scopeLines).map((line) => line.sourceText).join("\n"));
    applyPrototypeLabourFields(division, section);
    ensureDivisionTemplateDefaults(division.sectionId);
    applyDivisionModeRules(division);
    if (!isGlendaleDivisionId(division.id)) {
      division.estimateWorksheet = toArray(section.worksheetRows)
        .map((row) => normalizeEstimateWorksheetRow(
          {
            ...row,
            sectionId: cleanString(division.sectionId),
            divisionId: division.id
          },
          division
        ))
        .filter(Boolean);
      rollupEstimateWorksheetForDivision(division);
    } else {
      glendaleTasks.push(
        ...toArray(section.tasks).map((task) => ({
          ...task,
          sectionId: cleanString(division.sectionId),
          divisionId: division.id
        }))
      );
    }
    state.divisionSections.push(division);
  });

  if (glendaleTasks.length) {
    applyTaskPlanToDivisions({ tasks: glendaleTasks });
  }
  resetQuoteReviewConfirmation({ keepSignerName: true });
  renderDivisions();
  buildQuoteBodyFromDivisions();
  ensureQuoteDescriptionFromScope({ force: false });
  return {
    appliedSections: normalizedDraft.sections.length,
    glendaleTaskSections: glendaleTasks.length
  };
}

async function handleGeneratePrototypeEstimate() {
  const scopeText = cleanString(el.prototypeScopeInput?.value || state.prototypeScopeText || state.quoteBody);
  if (!scopeText) {
    setPrototypeStatus("Paste a master scope of work first.", "error");
    showStatus("Paste a master scope of work first.", "error");
    return;
  }

  state.prototypePanelOpen = true;
  setBusy(el.prototypeGenerateBtn, true);
  startPrototypeLoadingStatus("Reading master scope and generating estimate...");
  try {
    const result = await apiFetch("/api/ai/prototype-estimate", {
      method: "POST",
      body: buildPrototypeEstimatePayload(scopeText)
    });
    state.prototypeEstimateDraft = normalizePrototypeEstimateDraft(result);
    state.prototypeScopeText = cleanString(scopeText);
    recordUndoSnapshot("Generate estimate");
    const applyResult = applyPrototypeEstimateDraft(state.prototypeEstimateDraft);
    renderPrototypeEstimatePanel();
    setPrototypeStatus(
      `Estimate generated and applied: ${applyResult.appliedSections} section${applyResult.appliedSections === 1 ? "" : "s"} added.`,
      "success"
    );
    showStatus(
      `Estimate generated and applied: ${applyResult.appliedSections} section${applyResult.appliedSections === 1 ? "" : "s"} added to the estimator.`,
      "success"
    );
  } catch (error) {
    setPrototypeStatus(error.message, "error");
    showStatus(error.message, "error");
  } finally {
    stopPrototypeStatusTimer();
    setBusy(el.prototypeGenerateBtn, false);
  }
}

async function handleApplyPrototypeEstimate() {
  if (!state.prototypeEstimateDraft?.sections?.length) {
    setPrototypeStatus("Generate an estimate first.", "error");
    showStatus("Generate an estimate first.", "error");
    return;
  }
  recordUndoSnapshot("Apply prototype estimate");
  const result = applyPrototypeEstimateDraft(state.prototypeEstimateDraft);
  renderPrototypeEstimatePanel();
  setPrototypeStatus(
    `Prototype applied to estimator: ${result.appliedSections} section${result.appliedSections === 1 ? "" : "s"} added.`,
    "success"
  );
  showStatus(
    `Prototype applied: ${result.appliedSections} section${result.appliedSections === 1 ? "" : "s"} added to the estimator.`,
    "success"
  );
}

async function handleApprovePrototypeFeedback() {
  const payloadResult = buildPayload();
  if (!payloadResult.valid) {
    const errorMessage = payloadResult.errors[0] || "Complete the estimate before approving feedback.";
    setPrototypeStatus(errorMessage, "error");
    showStatus(errorMessage, "error");
    return;
  }

  setBusy(el.prototypeApproveBtn, true);
  setPrototypeStatus("Saving approved estimate as historical feedback...");
  try {
    const result = await apiFetch("/api/estimate-library/feedback", {
      method: "POST",
      body: {
        ...payloadResult.payload,
        pricingPosture: cleanString(state.prototypeEstimateDraft?.pricingPosture || "premium_high") || "premium_high",
        sourceKind: "manual_feedback",
        prototypeDraftId: cleanString(state.prototypeEstimateDraft?.draftId),
        quoteMetadata: state.lastQuoteResult
          ? {
              quoteNbr: cleanString(state.lastQuoteResult?.quoteNbr),
              opportunityId: cleanString(state.lastQuoteResult?.opportunityId)
            }
          : {}
      }
    });
    setPrototypeStatus(
      `Approved feedback saved: ${result.lineItemCount} line item${result.lineItemCount === 1 ? "" : "s"} stored.`,
      "success"
    );
    showStatus(
      `Historical feedback saved: ${result.lineItemCount} line item${result.lineItemCount === 1 ? "" : "s"} stored for future suggestions.`,
      "success"
    );
  } catch (error) {
    setPrototypeStatus(error.message, "error");
    showStatus(error.message, "error");
  } finally {
    setBusy(el.prototypeApproveBtn, false);
  }
}

function ensureWorksheetRowForScopeLine(division, scopeLine = {}) {
  ensureDivisionWorksheetDefaults(division);
  const scopeLineKey = cleanString(scopeLine?.scopeLineKey);
  if (!scopeLineKey) return null;
  const existingRows = Array.isArray(division.estimateWorksheet) ? division.estimateWorksheet : [];
  const existing = existingRows.find((row) => cleanString(row?.scopeLineKey) === scopeLineKey);
  if (existing) return existing;
      const newRow = normalizeEstimateWorksheetRow({
        scopeLineKey,
        lineNumber: cleanString(scopeLine?.lineNumber),
        sourceText: cleanString(scopeLine?.sourceText),
        normalizedText: cleanString(scopeLine?.sourceText),
        generalLabourHours: 0,
        supervisionHours: 0,
        projectManagerHours: 0,
        materialAllowanceCost: 0,
        subtradeAllowanceCost: 0,
        confidence: 0.5,
        assumptions: [],
    missingInputs: [],
    riskFlags: []
  }, division);
  if (!newRow) return null;
  division.estimateWorksheet.push(newRow);
  return newRow;
}

function applyHistoricalEstimateMatch(sectionId = "", scopeLineKey = "", matchIndex = -1) {
  const division = getDivisionSection(sectionId);
  if (!division) return;
  const suggestionGroup = getEstimateLibrarySuggestionsForSection(sectionId).find(
    (item) => cleanString(item?.scopeLineKey) === cleanString(scopeLineKey)
  );
  if (!suggestionGroup) return;
  const match = suggestionGroup.matches?.[matchIndex];
  if (!match) return;

  const scopeLine = {
    scopeLineKey: cleanString(suggestionGroup.scopeLineKey),
    lineNumber: cleanString(suggestionGroup.lineNumber),
    sourceText: cleanString(suggestionGroup.sourceText)
  };
  const worksheetRow = ensureWorksheetRowForScopeLine(division, scopeLine);
  if (!worksheetRow) return;
  recordUndoSnapshot("Apply historical estimate suggestion");

  const preview = match.applyPreview || {};
  worksheetRow.generalLabourHours = Math.max(0, parseNumber(preview.generalLabourHours, 0));
  worksheetRow.supervisionHours = Math.max(0, parseNumber(preview.supervisionHours, 0));
  worksheetRow.projectManagerHours = Math.max(0, parseNumber(preview.projectManagerHours, 0));
  worksheetRow.materialAllowanceCost = Math.max(0, parseNumber(preview.materialAllowanceCost, 0));
  worksheetRow.subtradeAllowanceCost = Math.max(0, parseNumber(preview.subtradeAllowanceCost, 0));
  worksheetRow.confidence = Math.max(0.05, Math.min(0.99, parseNumber(match.confidence, 0.2)));
  worksheetRow.assumptions = uniqueStringList([
    ...toArray(preview.assumptions),
    `Historical preset: ${cleanString(match.displayDescription)}`
  ]);
  worksheetRow.riskFlags = uniqueStringList([
    ...toArray(worksheetRow.riskFlags),
    "Review historical preset against current site conditions and scope exclusions."
  ]);
  worksheetRow.missingInputs = [];
  worksheetRow.needsReview = false;
  worksheetRow.locked = true;
  worksheetRow.origin = "manual";

  rollupEstimateWorksheetForDivision(division);
  renderDivisions();
  showStatus(`Applied historical preset "${cleanString(match.displayDescription)}".`, "success");
}

function setAuthUI(isAuthenticated) {
  document.body.classList.toggle("auth-screen", !isAuthenticated);
  el.builderSection.classList.toggle("hidden", !isAuthenticated);
  if (el.loginSection) {
    el.loginSection.classList.toggle("hidden", isAuthenticated || INTEGRATED_AUTH_MODE);
  }
  el.loginBtn.disabled = isAuthenticated;
  el.logoutBtn.disabled = !isAuthenticated;
  el.authBadge.classList.remove("muted", "ok", "error");
  if (isAuthenticated) {
    el.authBadge.textContent = state.integratedAuth
      ? `Signed in${state.username ? ` as ${state.username}` : ""}`
      : state.sharedSession
      ? `Signed in (shared backend session${state.username ? ` as ${state.username}` : ""})`
      : `Signed in${state.username ? ` as ${state.username}` : ""}`;
    el.authBadge.classList.add("ok");
  } else {
    el.authBadge.textContent = "Signed out";
    el.authBadge.classList.add("muted");
  }
  syncDepartmentGate();
}

function handleForgotPassword() {
  showAuthStatus("Use the standard Acumatica password reset flow or contact your MeadowBrook administrator.");
}

function handleLoginFieldKeydown(event) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  signIn();
}

function hardSignOut(message = "Signed out.", type = "info") {
  state.token = "";
  state.username = "";
  state.company = "";
  state.sharedSession = false;
  state.integratedAuth = INTEGRATED_AUTH_MODE;
  state.accounts = [];
  state.accountsLoading = false;
  state.accountsLoadError = "";
  state.accountsFromCache = false;
  state.employees = [];
  state.employeesLoading = false;
  state.employeesLoadError = "";
  state.pricingBookEstimators = [];
  state.pricingBookEstimatorsLoading = false;
  state.pricingBookEstimatorsLoadError = "";
  state.newAccountSalesRepQuery = "";
  state.selectedNewAccountSalesRepId = "";
  state.templateCatalog = {};
  state.contacts = [];
  state.accountQuery = "";
  state.selectedAccountId = "";
  state.selectedContactId = "";
  state.quoteType = "";
  state.scopeSuggestion = "";
  state.scopeSuggestionNotes = "";
  state.quoteDescription = "";
  state.quoteReviewConfirmed = false;
  state.quoteReviewSignerName = "";
  state.aiValidation = null;
  state.prototypePanelOpen = true;
  state.prototypeScopeText = "";
  state.prototypeEstimateDraft = null;
  state.prototypeStatusMessage = "Estimate generator is ready.";
  state.prototypeStatusType = "info";
  stopPrototypeStatusTimer();
  state.divisionSections = [];
  state.lastQuoteResult = null;
  clearEstimateLibraryState();
  clearStoredSessionToken();
  renderAccounts();
  renderContacts();
  renderAccountAddress();
  renderScopeSuggestion();
  if (Array.isArray(el.quoteTypeInputs)) {
    el.quoteTypeInputs.forEach((input) => {
      input.checked = false;
    });
  }
  syncProjectTypeField();
  setQuoteBodyText("");
  if (el.quoteDescription) el.quoteDescription.value = "";
  if (el.quoteReviewConfirmCheckbox) el.quoteReviewConfirmCheckbox.checked = false;
  if (el.quoteReviewSignerInput) el.quoteReviewSignerInput.value = "";
  syncQuoteBodyTextareaSize();
  renderDivisions();
  renderAiValidation();
  setAuthUI(false);
  syncQuoteActionButtons();
  showStatus(message, type);
  showAuthStatus(message, type);
}

async function signIn() {
  if (INTEGRATED_AUTH_MODE) {
    showAuthStatus("Use the MeadowBrook sales workspace sign-in to access quoting.", "error");
    return;
  }
  const name = cleanString(el.loginUsername.value);
  const password = cleanString(el.loginPassword.value);
  const rememberPassword = Boolean(el.rememberPassword?.checked);

  if (!name) {
    showAuthStatus("Username is required.", "error");
    return;
  }

  setBusy(el.loginBtn, true);
  showAuthStatus("Signing in...");

  try {
    const result = await requestAcumaticaSession({ username: name, password });
    applyAuthenticatedSession(result);
    if (rememberPassword) {
      saveCredentials(name, password);
    } else {
      clearSavedCredentials();
    }
    if (!rememberPassword) {
      el.loginPassword.value = "";
    }
    await loadAuthenticatedAppData();
    showStatus("Signed in.", "success");
    showAuthStatus("Signed in successfully.", "success");
  } catch (error) {
    showAuthStatus(error.message, "error");
  } finally {
    setBusy(el.loginBtn, false);
  }
}

async function signOut() {
  setManualSignOutPreference(true);
  try {
    if (INTEGRATED_AUTH_MODE) {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      window.location.assign("/signin");
      return;
    }
    if (state.token) {
      await apiFetch("/api/acumatica/logout", { method: "POST" });
    }
  } catch (_error) {
    // Ignore logout network errors.
  }
  hardSignOut("Signed out.");
}

async function verifyExistingSession() {
  if (INTEGRATED_AUTH_MODE) {
    try {
      const result = await requestAcumaticaSession();
      applyAuthenticatedSession(result);
      setAuthUI(true);
      await loadAuthenticatedAppData();
      showAuthStatus("Session ready.", "success");
    } catch (error) {
      setAuthUI(false);
      showAuthStatus(cleanString(error?.message) || "Sign in through the MeadowBrook sales workspace.", "error");
    }
    return;
  }

  const canRestoreSavedSession = Boolean(readSavedCredentials()) && !readManualSignOutPreference();
  if (!state.token && !canRestoreSavedSession) {
    setAuthUI(false);
    return;
  }

  try {
    if (state.token) {
      await apiFetch("/api/business-accounts?pageSize=1&maxRecords=1");
    } else {
      showAuthStatus("Restoring saved session...");
      const recovery = await restoreSavedSession();
      if (!recovery.restored) {
        throw recovery.error || new Error("Stored session could not be restored. Sign in again.");
      }
    }
    setAuthUI(true);
    await loadAuthenticatedAppData();
    showAuthStatus("Session restored.", "success");
  } catch (error) {
    if (error?.status === 401) return;
    setAuthUI(false);
    showAuthStatus(
      cleanString(error?.message) || "Stored session could not be restored. Sign in again.",
      "error"
    );
  }
}

function getTemplateItemsForDivision(divisionId) {
  const items = state.templateCatalog?.[divisionId];
  return Array.isArray(items) ? items : [];
}

function getFallbackTemplateItemForDivision(divisionId) {
  const fallback = FALLBACK_DIVISION_TEMPLATES[cleanString(divisionId).toLowerCase()] || FALLBACK_DIVISION_TEMPLATES.construction;
  return fallback ? { ...fallback } : null;
}

function getTemplateItemByTaskCd(divisionId, taskCd) {
  const id = cleanString(taskCd);
  if (!id) return null;
  return getTemplateItemsForDivision(divisionId).find((item) => cleanString(item.taskCd) === id) || null;
}

function scoreGenericTemplateItem(item) {
  const text = `${cleanString(item.taskCd)} ${cleanString(item.description)}`.toLowerCase();
  let score = 0;
  if (/\bgeneral\b/.test(text)) score += 9;
  if (/\bgeneric\b/.test(text)) score += 8;
  if (/\bmisc(ellaneous)?\b/.test(text)) score += 7;
  if (/\ballowance\b/.test(text)) score += 6;
  if (/\blabou?r\b/.test(text)) score += 5;
  if (/\bservice\b/.test(text)) score += 4;
  if (/\bwork\b/.test(text)) score += 2;
  score -= Math.min(cleanString(item.description).length, 120) / 120;
  return score;
}

function getGenericTemplateItemForDivision(divisionId) {
  const items = getTemplateItemsForDivision(divisionId);
  if (!items.length) {
    return getFallbackTemplateItemForDivision(divisionId);
  }
  return [...items]
    .sort((a, b) => {
      const scoreDiff = scoreGenericTemplateItem(b) - scoreGenericTemplateItem(a);
      if (scoreDiff !== 0) return scoreDiff;
      const lenDiff = cleanString(a.description).length - cleanString(b.description).length;
      if (lenDiff !== 0) return lenDiff;
      return cleanString(a.taskCd).localeCompare(cleanString(b.taskCd));
    })[0];
}

function getDivisionLineDefaults(division, kind) {
  if (!division) {
    return {
      uom: "EACH",
      costCode: "",
      taxCategory: "H"
    };
  }
  const uom =
    kind === "subcontractor"
      ? cleanString(division.templateSubtradeUom || "EACH")
      : "EACH";
  return {
    uom: uom || "EACH",
    costCode: cleanString(division.templateCostCode || ""),
    taxCategory: cleanString(division.templateTaxCategory || "H") || "H"
  };
}

function ensureDivisionLineDefaults(division, kind, { force = false } = {}) {
  const listKey = kind === "material" ? "materialLines" : "subcontractorLines";
  const lines = division?.[listKey];
  if (!Array.isArray(lines)) return;
  const defaults = getDivisionLineDefaults(division, kind);

  lines.forEach((line) => {
    if (!cleanString(line.uom)) {
      line.uom = defaults.uom;
    }
    if (force || !cleanString(line.costCode)) {
      line.costCode = defaults.costCode;
    }
    if (force || !cleanString(line.taxCategory)) {
      line.taxCategory = defaults.taxCategory;
    }
    if (!cleanString(line.markup)) {
      line.markup = "50";
    }
  });
}

function applyTemplateToDivision(sectionId, item) {
  if (!sectionId || !item) return;
  const division = getDivisionSection(sectionId);
  if (!division) return;
  division.templateTaskCd = cleanString(item.taskCd);
  division.templateDescription = cleanString(item.description);
  division.templateCostCode = cleanString(item.costCode);
  division.templateRevenueGroup = cleanString(item.accountGroup || "R") || "R";
  division.templateTaxCategory = cleanString(item.taxCategory || "H") || "H";
  division.templateLabourUom = "HOUR";
  division.templateMaterialUom = "EACH";
  division.templateSubtradeUom = "EACH";
  ensureDivisionLineDefaults(division, "material", { force: true });
  ensureDivisionLineDefaults(division, "subcontractor", { force: true });
}

function ensureDivisionTemplateDefaults(sectionId) {
  const division = getDivisionSection(sectionId);
  if (!division) return;
  if (!cleanString(division.templateRevenueGroup)) {
    division.templateRevenueGroup = "R";
  }
  if (!cleanString(division.templateTaxCategory)) {
    division.templateTaxCategory = "H";
  }
  if (!cleanString(division.templateLabourUom)) {
    division.templateLabourUom = "HOUR";
  }
  if (!cleanString(division.templateMaterialUom)) {
    division.templateMaterialUom = "EACH";
  }
  if (!cleanString(division.templateSubtradeUom)) {
    division.templateSubtradeUom = "EACH";
  }
}

async function loadTemplateCatalog() {
  if (!hasAuthenticatedSession()) return;
  try {
    const result = await apiFetch("/api/templates/catalog");
    const catalog = result?.items && typeof result.items === "object" ? result.items : {};
    DIVISIONS.forEach((division) => {
      const key = division.id;
      if (!Array.isArray(catalog[key]) || !catalog[key].length) {
        const fallback = getFallbackTemplateItemForDivision(key);
        catalog[key] = fallback ? [fallback] : [];
      }
    });
    state.templateCatalog = catalog;
    getDivisionSections().forEach((division) => {
      ensureDivisionTemplateDefaults(division.sectionId);
      if (!division?.selected) return;
      if (cleanString(division.templateTaskCd) && cleanString(division.templateCostCode)) return;
      const genericItem = getGenericTemplateItemForDivision(division.id);
      if (genericItem) {
        applyTemplateToDivision(division.sectionId, genericItem);
      }
    });
    renderDivisions();
  } catch (error) {
    state.templateCatalog = Object.fromEntries(
      DIVISIONS.map((division) => {
        const fallback = getFallbackTemplateItemForDivision(division.id);
        return [division.id, fallback ? [fallback] : []];
      })
    );
    renderDivisions();
    showStatus("Template catalog unavailable. Using built-in trade mappings.", "success");
  }
}

function buildDivisionMatchText(division) {
  const materialText = (division.materialLines || [])
    .map((line) => cleanString(line.description))
    .filter(Boolean)
    .join(" ");
  const subcontractorText = (division.subcontractorLines || [])
    .map((line) => cleanString(line.description))
    .filter(Boolean)
    .join(" ");
  return {
    scopeText: cleanString(division.scope),
    materialText,
    subcontractorText
  };
}

async function suggestTemplateForDivision(sectionId, { silent = false, force = false } = {}) {
  const division = getDivisionSection(sectionId);
  if (!division || !division.selected) return { skipped: true };

  const genericItem = getGenericTemplateItemForDivision(division.id);
  if (genericItem) {
    applyTemplateToDivision(sectionId, genericItem);
    if (!silent) {
      showStatus(`Mapped ${getDivisionDisplayTitle(division)} to generic task ${cleanString(genericItem.taskCd)}.`, "success");
    }
    return { ok: true, item: genericItem, source: "generic" };
  }

  const matchText = buildDivisionMatchText(division);
  const hasText = Boolean(matchText.scopeText || matchText.materialText || matchText.subcontractorText);
  if (!hasText && !force) return { skipped: true };
  if (!force && cleanString(division.templateTaskCd) && cleanString(division.templateCostCode)) {
    return { skipped: true };
  }

  try {
    const result = await apiFetch("/api/templates/recommend", {
      method: "POST",
      body: {
        divisionId: division.id,
        scopeText: matchText.scopeText,
        materialText: matchText.materialText,
        subcontractorText: matchText.subcontractorText,
        preferGeneric: true
      }
    });
    if (result?.item) {
      applyTemplateToDivision(sectionId, result.item);
      if (!silent) {
        showStatus(`Mapped ${getDivisionDisplayTitle(division)} to ${cleanString(result.item.taskCd)} using scope.`, "success");
      }
      return { ok: true, item: result.item };
    }
    if (!silent) {
      showStatus(`No template mapping returned for ${getDivisionDisplayTitle(division)}.`, "error");
    }
    return { ok: false };
  } catch (error) {
    if (!silent) {
      showStatus(`Template mapping failed for ${getDivisionDisplayTitle(division)}: ${error.message}`, "error");
    }
    return { ok: false, error };
  }
}

async function ensureScopeMappings({ silent = true } = {}) {
  const selectedDivisions = getSelectedDivisionSections();
  for (const division of selectedDivisions) {
    if (cleanString(division.templateTaskCd) && cleanString(division.templateCostCode)) continue;
    await suggestTemplateForDivision(division.sectionId, { silent: true, force: true });
  }
  const missing = selectedDivisions.filter(
    (division) => !cleanString(division.templateTaskCd) || !cleanString(division.templateCostCode)
  );
  if (missing.length && !silent) {
    showStatus(
      `Automatic task mapping is unavailable for: ${missing.map((division) => getDivisionDisplayTitle(division)).join(", ")}. Check template sheets for those trades.`,
      "error"
    );
  }
  return {
    ok: missing.length === 0,
    missing
  };
}

function getFilteredAccounts() {
  const search = normalizeSearchText(state.accountQuery);
  if (!search) return state.accounts;
  return state.accounts.filter((account) => normalizeSearchText(account.name).includes(search));
}

function resolveAccountFromQuery(query = "") {
  const search = normalizeSearchText(query);
  if (!search) return null;

  const exactNameMatch =
    state.accounts.find((account) => normalizeSearchText(account.name) === search) || null;
  if (exactNameMatch) return exactNameMatch;

  const exactIdMatch =
    state.accounts.find((account) => normalizeSearchText(account.businessAccountId) === search) || null;
  if (exactIdMatch) return exactIdMatch;

  const startsWithMatches = state.accounts.filter((account) =>
    normalizeSearchText(account.name).startsWith(search)
  );
  if (startsWithMatches.length === 1) return startsWithMatches[0];

  const containsMatches = state.accounts.filter((account) =>
    normalizeSearchText(account.name).includes(search)
  );
  if (containsMatches.length === 1) return containsMatches[0];

  return null;
}

async function autoSelectAccountFromQuery() {
  const candidate = resolveAccountFromQuery(state.accountQuery);
  if (!candidate?.businessAccountId) return false;
  if (cleanString(candidate.businessAccountId) === cleanString(state.selectedAccountId)) return true;
  await selectAccountById(candidate.businessAccountId);
  return true;
}

function openAccountDropdown() {
  if (!el.accountDropdown) return;
  el.accountDropdown.classList.remove("hidden");
}

function closeAccountDropdown() {
  if (!el.accountDropdown) return;
  el.accountDropdown.classList.add("hidden");
}

async function selectAccountById(accountId) {
  const id = cleanString(accountId);
  if (!id) return;
  state.selectedAccountId = id;
  const selected = getSelectedAccount();
  state.accountQuery = cleanString(selected?.name);
  if (el.accountComboInput) {
    el.accountComboInput.value = state.accountQuery;
  }
  closeAccountDropdown();
  renderAccounts();
  renderAccountAddress();
  await loadContactsForSelectedAccount();
}

function renderAccounts() {
  const selected = getSelectedAccount();
  if (selected && !cleanString(state.accountQuery)) {
    state.accountQuery = cleanString(selected.name);
  }

  if (el.accountComboInput && document.activeElement !== el.accountComboInput) {
    el.accountComboInput.value = cleanString(state.accountQuery || selected?.name);
  }

  const filteredItems = getFilteredAccounts();
  const items = filteredItems.slice(0, 250);
  if (!el.accountDropdown) return;
  if (!hasSelectedDepartment()) {
    el.accountDropdown.innerHTML = '<div class="combo-empty">Select Department first to load business accounts.</div>';
    syncDepartmentGate();
    return;
  }
  if (state.accountsLoading) {
    el.accountDropdown.innerHTML = '<div class="combo-empty">Loading business accounts...</div>';
    syncDepartmentGate();
    return;
  }
  if (state.accountsLoadError) {
    el.accountDropdown.innerHTML = `<div class="combo-empty">Unable to load accounts: ${escapeHtml(
      state.accountsLoadError
    )}</div>`;
    syncDepartmentGate();
    return;
  }
  if (!state.accounts.length) {
    el.accountDropdown.innerHTML = '<div class="combo-empty">No business accounts loaded yet. Click Refresh Accounts.</div>';
    syncDepartmentGate();
    return;
  }
  if (!items.length) {
    const fallback = state.accounts.slice(0, 50);
    el.accountDropdown.innerHTML = [
      '<div class="combo-empty">No exact name match. Showing first accounts:</div>',
      ...fallback.map(
        (account) => `
        <button class="combo-option" data-action="select-account" data-account-id="${escapeAttr(account.businessAccountId)}">
          <div class="combo-option-title">${escapeHtml(account.name || "Unnamed Account")}</div>
          <div class="combo-option-sub">${escapeHtml(account.businessAccountId || "")}</div>
          <div class="combo-option-sub combo-option-address">${escapeHtml(formatAccountAddressInline(account))}</div>
        </button>
      `
      )
    ].join("");
    syncDepartmentGate();
    return;
  }

  el.accountDropdown.innerHTML = items
    .map(
      (account) => `
      <button class="combo-option" data-action="select-account" data-account-id="${escapeAttr(account.businessAccountId)}">
        <div class="combo-option-title">${escapeHtml(account.name || "Unnamed Account")}</div>
        <div class="combo-option-sub">${escapeHtml(account.businessAccountId || "")}</div>
        <div class="combo-option-sub combo-option-address">${escapeHtml(formatAccountAddressInline(account))}</div>
      </button>
    `
    )
    .join("");
  syncDepartmentGate();
}

function getFilteredSalesReps() {
  const search = normalizeSearchText(state.newAccountSalesRepQuery);
  if (!search) return state.employees;
  return state.employees.filter(
    (employee) =>
      normalizeSearchText(employee.name).includes(search) ||
      normalizeSearchText(employee.employeeId).includes(search)
  );
}

function resolveSalesRepFromQuery(query = "") {
  const search = normalizeSearchText(query);
  if (!search) return null;

  const exactNameMatch = state.employees.find((employee) => normalizeSearchText(employee.name) === search) || null;
  if (exactNameMatch) return exactNameMatch;

  const exactIdMatch =
    state.employees.find((employee) => normalizeSearchText(employee.employeeId) === search) || null;
  if (exactIdMatch) return exactIdMatch;

  const startsWithMatches = state.employees.filter((employee) =>
    normalizeSearchText(employee.name).startsWith(search)
  );
  if (startsWithMatches.length === 1) return startsWithMatches[0];

  const containsMatches = state.employees.filter(
    (employee) =>
      normalizeSearchText(employee.name).includes(search) ||
      normalizeSearchText(employee.employeeId).includes(search)
  );
  if (containsMatches.length === 1) return containsMatches[0];

  return null;
}

async function autoSelectSalesRepFromQuery() {
  const candidate = resolveSalesRepFromQuery(state.newAccountSalesRepQuery);
  if (!candidate?.employeeId) return false;
  if (cleanString(candidate.employeeId) === cleanString(state.selectedNewAccountSalesRepId)) return true;
  selectNewAccountSalesRepById(candidate.employeeId);
  return true;
}

function openSalesRepDropdown() {
  if (!el.newAccountSalesRepDropdown) return;
  el.newAccountSalesRepDropdown.classList.remove("hidden");
}

function closeSalesRepDropdown() {
  if (!el.newAccountSalesRepDropdown) return;
  el.newAccountSalesRepDropdown.classList.add("hidden");
}

function selectNewAccountSalesRepById(employeeId) {
  const id = cleanString(employeeId);
  if (!id) return;
  state.selectedNewAccountSalesRepId = id;
  const selected = getSelectedNewAccountSalesRep();
  state.newAccountSalesRepQuery = cleanString(selected?.name || selected?.employeeId || id);
  if (el.newAccountSalesRepInput) {
    el.newAccountSalesRepInput.value = state.newAccountSalesRepQuery;
  }
  if (el.newAccountSalesRepId) {
    el.newAccountSalesRepId.value = id;
  }
  closeSalesRepDropdown();
  renderSalesRepOptions();
}

function renderSalesRepOptions() {
  if (!el.newAccountSalesRepDropdown) return;

  const selected = getSelectedNewAccountSalesRep();
  if (el.newAccountSalesRepInput && document.activeElement !== el.newAccountSalesRepInput) {
    el.newAccountSalesRepInput.value = cleanString(
      state.newAccountSalesRepQuery || selected?.name || selected?.employeeId
    );
  }
  if (el.newAccountSalesRepId) {
    el.newAccountSalesRepId.value = cleanString(state.selectedNewAccountSalesRepId);
  }

  const filteredItems = getFilteredSalesReps();
  const items = filteredItems.slice(0, 250);
  if (state.employeesLoading) {
    el.newAccountSalesRepDropdown.innerHTML = '<div class="combo-empty">Loading sales reps...</div>';
    return;
  }
  if (state.employeesLoadError) {
    el.newAccountSalesRepDropdown.innerHTML = `<div class="combo-empty">Unable to load sales reps: ${escapeHtml(
      state.employeesLoadError
    )}</div>`;
    return;
  }
  if (!state.employees.length) {
    el.newAccountSalesRepDropdown.innerHTML =
      '<div class="combo-empty">No sales reps found. Refresh and try again.</div>';
    return;
  }
  if (!items.length) {
    const fallback = state.employees.slice(0, 50);
    el.newAccountSalesRepDropdown.innerHTML = [
      '<div class="combo-empty">No exact name match. Showing first sales reps:</div>',
      ...fallback.map(
        (employee) => `
          <button class="combo-option" data-action="select-sales-rep" data-employee-id="${escapeAttr(employee.employeeId)}">
            <div class="combo-option-title">${escapeHtml(employee.name || employee.employeeId || "Unknown Employee")}</div>
            <div class="combo-option-sub">${escapeHtml(employee.employeeId || "")}</div>
          </button>
        `
      )
    ].join("");
    return;
  }

  el.newAccountSalesRepDropdown.innerHTML = items
    .map(
      (employee) => `
        <button class="combo-option" data-action="select-sales-rep" data-employee-id="${escapeAttr(employee.employeeId)}">
          <div class="combo-option-title">${escapeHtml(employee.name || employee.employeeId || "Unknown Employee")}</div>
          <div class="combo-option-sub">${escapeHtml(employee.employeeId || "")}</div>
        </button>
      `
    )
    .join("");
}

function renderContacts() {
  const options = ["<option value=\"\">Select contact</option>"];
  state.contacts.forEach((contact) => {
    const selected = contact.contactId === state.selectedContactId ? "selected" : "";
    const text = `${contact.displayName || contact.contactId}${contact.email ? ` (${contact.email})` : ""}${
      contact.contactClass ? ` [${contact.contactClass}]` : ""
    }`;
    options.push(`<option value="${contact.contactId}" ${selected}>${escapeHtml(text)}</option>`);
  });

  el.contactSelect.innerHTML = options.join("");
  const canUseContact = hasSelectedDepartment() && Boolean(state.selectedAccountId);
  el.contactSelect.disabled = !canUseContact;
  el.refreshContactsBtn.disabled = !canUseContact;
  el.newContactBtn.disabled = !canUseContact;
  syncDepartmentGate();
}

function renderAccountAddress() {
  if (!el.accountAddress) return;
  const account = getSelectedAccount();
  if (!account) {
    el.accountAddress.textContent = "No account selected.";
    return;
  }

  el.accountAddress.textContent = `${account.businessAccountId} - ${account.name || ""}\n${formatAddress(account)}`;
}

async function loadAccounts({ force = false } = {}) {
  if (!hasSelectedDepartment()) {
    state.accountsLoading = false;
    state.accountsLoadError = "";
    renderAccounts();
    syncDepartmentGate();
    if (force) {
      showStatus("Select a Department first.", "error");
    }
    return;
  }
  if (!force && state.accounts.length > 0) {
    renderAccounts();
    renderAccountAddress();
    return;
  }

  showStatus("Loading business accounts...");
  state.accountsLoading = true;
  state.accountsLoadError = "";
  renderAccounts();
  syncDepartmentGate();
  try {
    const refreshQuery = force ? "&refresh=1" : "";
    const result = await apiFetch(`/api/business-accounts?pageSize=500&maxRecords=5000${refreshQuery}`);
    state.accounts = sortAccounts(Array.isArray(result.items) ? result.items : []);
    state.accountsFromCache = false;
    writeAccountsCache(state.accounts);
    if (state.selectedAccountId && !state.accounts.some((account) => account.businessAccountId === state.selectedAccountId)) {
      state.accountQuery = "";
      state.selectedAccountId = "";
      state.selectedContactId = "";
      state.contacts = [];
      renderContacts();
    }
    renderAccountAddress();
    showStatus(`Loaded ${state.accounts.length} accounts.`, "success");
  } catch (error) {
    state.accounts = [];
    state.accountsLoadError = cleanString(error?.message || "Unknown error");
    showStatus(`Unable to load accounts: ${state.accountsLoadError}`, "error");
    throw error;
  } finally {
    state.accountsLoading = false;
    renderAccounts();
    syncDepartmentGate();
  }
}

async function loadEmployees({ force = false } = {}) {
  if (!force && state.employees.length > 0) {
    renderSalesRepOptions();
    return;
  }

  state.employeesLoading = true;
  state.employeesLoadError = "";
  renderSalesRepOptions();
  try {
    const result = await apiFetch("/api/employees?pageSize=500&maxRecords=5000");
    state.employees = sortEmployees(Array.isArray(result.items) ? result.items : []);
  } catch (error) {
    state.employees = [];
    state.employeesLoadError = cleanString(error?.message || "Unknown error");
    throw error;
  } finally {
    state.employeesLoading = false;
    renderSalesRepOptions();
  }
}

async function loadPricingBookEstimators({ force = false } = {}) {
  if (!force && state.pricingBookEstimators.length > 0) {
    return state.pricingBookEstimators;
  }

  state.pricingBookEstimatorsLoading = true;
  state.pricingBookEstimatorsLoadError = "";
  try {
    const refreshQuery = force ? "?refresh=1" : "";
    const result = await apiFetch(`/api/pricing-book/estimators${refreshQuery}`);
    state.pricingBookEstimators = sortPricingBookEstimators(Array.isArray(result.items) ? result.items : []);
    getDivisionSections().forEach((division) => {
      syncDivisionEstimatorName(division);
    });
    renderDivisions();
    return state.pricingBookEstimators;
  } catch (error) {
    state.pricingBookEstimators = [];
    state.pricingBookEstimatorsLoadError = cleanString(error?.message || "Unknown error");
    throw error;
  } finally {
    state.pricingBookEstimatorsLoading = false;
    renderDivisions();
  }
}

async function loadContactsForSelectedAccount() {
  if (!hasSelectedDepartment()) {
    state.selectedContactId = "";
    state.contacts = [];
    renderContacts();
    return;
  }
  const account = getSelectedAccount();
  const previousSelectedContactId = cleanString(state.selectedContactId);
  state.selectedContactId = "";
  state.contacts = [];
  renderContacts();

  if (!account) {
    renderAccountAddress();
    return;
  }

  showStatus("Loading contacts...");
  try {
    const result = await apiFetch(
      `/api/business-accounts/${encodeURIComponent(account.businessAccountId)}/contacts?maxRecords=1000`
    );
    state.contacts = Array.isArray(result.items) ? result.items : [];
    const hasPreviousSelection =
      previousSelectedContactId &&
      state.contacts.some((contact) => cleanString(contact.contactId) === previousSelectedContactId);
    if (hasPreviousSelection) {
      state.selectedContactId = previousSelectedContactId;
    } else if (state.contacts.length) {
      state.selectedContactId = cleanString(state.contacts[0].contactId);
    }
    renderContacts();
    renderAccountAddress();
    showStatus(
      `Loaded ${state.contacts.length} contacts for ${account.name}.${state.selectedContactId ? " Contact auto-selected." : ""}`,
      "success"
    );
  } catch (error) {
    state.scopeSuggestionNotes = `AI suggestion failed: ${cleanString(error.message)}`;
    state.scopeSuggestion = "";
    renderScopeSuggestion();
    showStatus(error.message, "error");
  }
}

function makeLineRow(divisionId, kind, line, index, options = {}) {
  const removeLabel = cleanString(options.removeLabel) || (kind === "material" ? "Remove material" : "Remove subtrade");
  const quantityValue = cleanString(line.quantity);
  const uomValue = cleanString(line.uom || "EACH").toUpperCase();
  const unitCostValue = cleanString(line.unitCost);
  const rowClasses = [
    "cost-row",
    Boolean(line?.autoGenerated) && cleanString(line?.source) === "worksheet" ? "worksheet-generated" : "",
    Boolean(line?.locked) ? "locked" : ""
  ]
    .filter(Boolean)
    .join(" ");
  return `
    <div class="${rowClasses}">
      <textarea rows="2" data-division="${divisionId}" data-kind="${kind}" data-line-index="${index}" data-line-field="description" placeholder="Description">${escapeHtml(
        line.description || ""
      )}</textarea>
      <input data-division="${divisionId}" data-kind="${kind}" data-line-index="${index}" data-line-field="quantity" value="${escapeAttr(
        quantityValue
      )}" placeholder="Qty" />
      <select data-division="${divisionId}" data-kind="${kind}" data-line-index="${index}" data-line-field="uom">
        ${buildUomSelectOptions(uomValue)}
      </select>
      <input data-division="${divisionId}" data-kind="${kind}" data-line-index="${index}" data-line-field="unitCost" value="${escapeAttr(
        unitCostValue
      )}" placeholder="Unit cost" />
      <input data-division="${divisionId}" data-kind="${kind}" data-line-index="${index}" data-line-field="cost" value="${escapeAttr(
        line.cost || ""
      )}" placeholder="Cost total" />
      <input data-division="${divisionId}" data-kind="${kind}" data-line-index="${index}" data-line-field="markup" value="${escapeAttr(
        line.markup || ""
      )}" placeholder="Markup %" />
      <input data-division="${divisionId}" data-kind="${kind}" data-line-index="${index}" data-line-field="sellingPrice" value="${escapeAttr(
        line.sellingPrice || ""
      )}" placeholder="Sell total" />
      <button class="btn remove-line-btn" title="${escapeAttr(removeLabel)}" aria-label="${escapeAttr(
        removeLabel
      )}" data-action="remove-line" data-division="${divisionId}" data-kind="${kind}" data-line-index="${index}">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 7h16" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
          <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
        </svg>
      </button>
    </div>
  `;
}

function formatCurrency(value) {
  return `$${parseNumber(value, 0).toFixed(2)}`;
}

function formatPercent(value, digits = 1) {
  return `${parseNumber(value, 0).toFixed(digits)}%`;
}

function calculateMarkupPercent(cost, sell) {
  const numericCost = parseNumber(cost, 0);
  const numericSell = parseNumber(sell, 0);
  if (numericCost <= 0) return 0;
  return ((numericSell - numericCost) / numericCost) * 100;
}

function formatNumberForInput(value) {
  const numeric = parseNumber(value, 0);
  if (!Number.isFinite(numeric)) return "";
  const rounded = Math.round(numeric * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2);
}

function getAutoSellTotal(costValue, markupValue) {
  const cost = parseNumber(costValue, 0);
  if (cost <= 0) return "";
  const markup = parseNumber(markupValue, 0);
  const sell = cost * (1 + markup / 100);
  return formatNumberForInput(sell);
}

function getLineSellTotal(line) {
  const cost = parseNumber(line.cost, 0);
  const markup = parseNumber(line.markup, 0);
  const enteredSell = parseNumber(line.sellingPrice, 0);
  if (enteredSell > 0) return enteredSell;
  if (cost <= 0) return 0;
  return cost * (1 + markup / 100);
}

function getDivisionTotals(division) {
  const labourTotals = getDivisionLabourRows(division).reduce(
    (acc, row) => {
      const hours = parseNumber(division?.[row.hoursField], 0);
      const costRate = parseNumber(division?.[row.rateField], 0);
      const sellRate = parseNumber(division?.[row.sellField], 0);
      acc.labourCost += hours * costRate;
      acc.labourSell += hours * (sellRate > 0 ? sellRate : costRate);
      return acc;
    },
    { labourCost: 0, labourSell: 0 }
  );
  const labourCost = labourTotals.labourCost;
  const labourSell = labourTotals.labourSell;

  const materialCost = (division.materialLines || []).reduce((sum, line) => sum + parseNumber(line.cost, 0), 0);
  const materialSell = (division.materialLines || []).reduce((sum, line) => sum + getLineSellTotal(line), 0);
  const subtradeCost = (division.subcontractorLines || []).reduce((sum, line) => sum + parseNumber(line.cost, 0), 0);
  const subtradeSell = (division.subcontractorLines || []).reduce((sum, line) => sum + getLineSellTotal(line), 0);

  const totalCost =
    (division.labourNoCost ? 0 : labourCost) +
    (division.materialNoCost ? 0 : materialCost) +
    (division.subcontractorNoCost ? 0 : subtradeCost);
  const totalSell =
    (division.labourNoCost ? 0 : labourSell) +
    (division.materialNoCost ? 0 : materialSell) +
    (division.subcontractorNoCost ? 0 : subtradeSell);
  const totalMarkupPct = calculateMarkupPercent(totalCost, totalSell);

  return {
    labourCost,
    labourSell,
    materialCost,
    materialSell,
    subtradeCost,
    subtradeSell,
    totalCost,
    totalSell,
    totalMarkupPct
  };
}

function getSelectedDivisionMarkupSummary() {
  const rows = getSelectedDivisionSections().map((division) => {
    const totals = getDivisionTotals(division);
    return {
      id: cleanString(division.sectionId || division.id),
      title: getDivisionDisplayTitle(division),
      totalCost: totals.totalCost,
      totalSell: totals.totalSell,
      totalMarkupPct: totals.totalMarkupPct
    };
  });

  const totalCost = rows.reduce((sum, row) => sum + parseNumber(row.totalCost, 0), 0);
  const totalSell = rows.reduce((sum, row) => sum + parseNumber(row.totalSell, 0), 0);
  const totalMarkupPct = calculateMarkupPercent(totalCost, totalSell);

  return {
    rows,
    totalCost,
    totalSell,
    totalMarkupPct
  };
}

function buildQuoteMarkupSummaryBodyHtml(summary = getSelectedDivisionMarkupSummary()) {
  if (!summary.rows.length) {
    return `<p class="hint">Add at least one trade section to view the quote markup summary.</p>`;
  }

  const rowsHtml = summary.rows
    .map(
      (row) => `
        <div class="quote-markup-row">
          <span>${escapeHtml(row.title)}</span>
          <span>${formatCurrency(row.totalCost)}</span>
          <span>${formatCurrency(row.totalSell)}</span>
          <span>${formatPercent(row.totalMarkupPct)}</span>
        </div>
      `
    )
    .join("");

  return `
    <div class="quote-markup-table">
      <div class="quote-markup-row head">
        <span>Division</span>
        <span>Cost</span>
        <span>Sell</span>
        <span>Markup</span>
      </div>
      ${rowsHtml}
      <div class="quote-markup-row total">
        <span>Total Project</span>
        <span>${formatCurrency(summary.totalCost)}</span>
        <span>${formatCurrency(summary.totalSell)}</span>
        <span>${formatPercent(summary.totalMarkupPct)}</span>
      </div>
    </div>
  `;
}

function updateQuoteMarkupSummaryDisplay() {
  if (!el.quoteMarkupSummary) return;
  el.quoteMarkupSummary.innerHTML = buildQuoteMarkupSummaryBodyHtml();
}

function normalizeSuggestedUom(rawUom = "") {
  const compact = cleanString(rawUom)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!compact) return "";

  const aliasMap = {
    HR: "HOUR",
    HRS: "HOUR",
    HUR: "HOUR",
    SF: "SQFT",
    FT2: "SQFT",
    SQUAREFOOT: "SQFT",
    SQUAREFEET: "SQFT",
    MTR: "METER",
    METER: "METER",
    METRE: "METER",
    LTR: "LITER",
    LITRE: "LITER",
    LITER: "LITER",
    KGM: "KG",
    TNE: "TONNES",
    TON: "TONNES",
    TONNE: "TONNES",
    TONNES: "TONNES",
    MIN: "MINUTE",
    MINS: "MINUTE",
    NMP: "PACK",
    PCB: "PIECE",
    YD3: "Y3",
    CY: "Y3"
  };

  const normalized = aliasMap[compact] || compact;
  return APPROVED_UOM_VALUES.has(normalized) ? normalized : "";
}

function inferUomFromText(rawText = "", fallbackUom = "EACH") {
  const text = cleanString(rawText).toLowerCase();
  if (!text) {
    return normalizeSuggestedUom(fallbackUom) || "EACH";
  }

  if (/\b(square\s*feet|square\s*foot|sq\.?\s*ft|sqft|sf)\b/.test(text)) return "SQFT";
  if (/\b(hours?|hrs?)\b/.test(text)) return "HOUR";
  if (/\b(minutes?|mins?)\b/.test(text)) return "MINUTE";
  if (/\b(cubic\s*yard|cu\.?\s*yd|yd3|y3)\b/.test(text)) return "Y3";
  if (/\b(cubic\s*meter|cubic\s*metre|m3|cu\.?\s*m)\b/.test(text)) return "M3";
  if (/\b(linear\s*feet?|lineal\s*feet?|lin\.?\s*ft|lft)\b/.test(text)) return "LFT";
  if (/\b(kilometers?|kilometres?|km)\b/.test(text)) return "KM";
  if (/\b(meters?|metres?|mtr)\b/.test(text)) return "METER";
  if (/\b(liters?|litres?|ltr)\b/.test(text)) return "LITER";
  if (/\b(tonnes?|tons?|tne)\b/.test(text)) return "TONNES";
  if (/\b(kilograms?|kilogrammes?|kg)\b/.test(text)) return "KG";
  if (/\b(pounds?|lbs?|lb)\b/.test(text)) return "LB";
  if (/\bbottles?\b/.test(text)) return "BOTTLE";
  if (/\bcans?\b/.test(text)) return "CAN";
  if (/\bpallets?\b/.test(text)) return "PALLET";
  if (/\bpacks?\b/.test(text)) return "PACK";
  if (/\bpieces?\b/.test(text)) return "PIECE";
  if (/\bitems?\b/.test(text)) return "ITEM";

  return normalizeSuggestedUom(fallbackUom) || "EACH";
}

function resolveSuggestedUom(rawUom = "", contextText = "", fallbackUom = "EACH") {
  const normalizedRaw = normalizeSuggestedUom(rawUom);
  const measuredUom = cleanString(extractMeasuredQuantityFromText(contextText)?.uom);
  const inferredUom = measuredUom || inferUomFromText(contextText, fallbackUom);
  if (!normalizedRaw) {
    return inferredUom || normalizeSuggestedUom(fallbackUom) || "EACH";
  }
  if (["EA", "EACH", "ITEM"].includes(normalizedRaw) && inferredUom && inferredUom !== normalizedRaw) {
    return inferredUom;
  }
  return normalizedRaw;
}

function parseNumericToken(rawToken = "") {
  const token = cleanString(rawToken).toLowerCase();
  if (!token) return null;
  if (NUMBER_WORD_TO_INT.has(token)) {
    return NUMBER_WORD_TO_INT.get(token);
  }

  const rangeMatch = token.match(
    /^(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:-|to|–|—)\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)$/
  );
  if (rangeMatch?.[1] && rangeMatch?.[2]) {
    const low = parseNumber(rangeMatch[1], 0);
    const high = parseNumber(rangeMatch[2], 0);
    if (high > 0) {
      return Math.max(low, high);
    }
  }

  const numeric = parseNumber(token, Number.NaN);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return null;
}

function extractCountQuantityFromText(rawText = "") {
  const text = cleanString(rawText);
  if (!text) return null;

  const numericTokenPattern =
    "\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty";
  const countRegex = new RegExp(
    `\\b(${numericTokenPattern})(?:\\s*\\(\\s*(${numericTokenPattern})\\s*\\))?(?:\\s*(?:-|to|–|—)\\s*(${numericTokenPattern}))?\\s+(?:bay\\s+|single\\s+|man\\s+|double\\s+|existing\\s+|new\\s+|powered\\s+|static\\s+|mobile\\s+|double-powered\\s+|mechanically\\s+assisted\\s+)?(${COUNT_BASED_SCOPE_NOUN_PATTERN})\\b`,
    "i"
  );
  const match = text.match(countRegex);
  if (!match) return null;

  const first = parseNumericToken(match[1]);
  const parenthetical = parseNumericToken(match[2]);
  const second = parseNumericToken(match[3]);
  const quantity = Math.max(first || 0, parenthetical || 0, second || 0);
  if (quantity <= 0) return null;
  return {
    quantity,
    uom: "EACH",
    basis: "count"
  };
}

function extractDimensionAreaFromText(rawText = "") {
  const text = cleanString(rawText).toLowerCase();
  if (!text) return null;

  const dimensionMatch = text.match(
    /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:'|ft|feet)?\s*(?:x|×)\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:'|ft|feet)?/
  );
  if (!dimensionMatch?.[1] || !dimensionMatch?.[2]) return null;

  const width = parseNumber(dimensionMatch[1], 0);
  const height = parseNumber(dimensionMatch[2], 0);
  if (width <= 0 || height <= 0) return null;

  const countMatch = text.match(
    /\b(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:bay\s+|single\s+|man\s+|double\s+)?(?:doors?|windows?|panels?|units?)\b/
  );
  const count = Math.max(1, parseNumericToken(countMatch?.[1]) || 1);
  const quantity = Math.round(width * height * count * 100) / 100;
  if (quantity <= 0) return null;
  return {
    quantity,
    uom: "SQFT",
    basis: "dimension"
  };
}

function extractMeasuredQuantityFromText(rawText = "") {
  const text = cleanString(rawText);
  if (!text) return null;
  const patterns = [
    {
      uom: "SQFT",
      regex: /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft|square\s*feet|square\s*foot|sf)\b/i
    },
    {
      uom: "HOUR",
      regex: /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/i
    },
    {
      uom: "TONNES",
      regex: /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:tonnes?|tons?|tne)\b/i
    },
    {
      uom: "LFT",
      regex: /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:linear\s*feet?|lineal\s*feet?|lin\.?\s*ft|lft)\b/i
    },
    {
      uom: "M3",
      regex: /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:m3|cubic\s*meters?|cubic\s*metres?)\b/i
    },
    {
      uom: "Y3",
      regex: /(?:up to\s*)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(?:y3|yd3|cubic\s*yards?)\b/i
    }
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (!match?.[1]) continue;
    const quantity = parseNumber(match[1], 0);
    if (quantity > 0) {
      return {
        quantity,
        uom: pattern.uom
      };
    }
  }

  const dimensionArea = extractDimensionAreaFromText(text);
  if (dimensionArea) return dimensionArea;

  const countQuantity = extractCountQuantityFromText(text);
  if (countQuantity) return countQuantity;

  return null;
}

function buildUomSelectOptions(selectedUom = "EACH") {
  const normalizedSelected = resolveSuggestedUom(selectedUom, "", "EACH");
  const hasSelected = APPROVED_UOM_OPTIONS.some((option) => option.value === normalizedSelected);
  const options = hasSelected
    ? APPROVED_UOM_OPTIONS
    : [{ value: normalizedSelected, label: normalizedSelected }, ...APPROVED_UOM_OPTIONS];
  return options
    .map(
      (option) =>
        `<option value="${escapeAttr(option.value)}" ${option.value === normalizedSelected ? "selected" : ""}>${escapeHtml(
          option.label
        )}</option>`
    )
    .join("");
}

function updateDivisionTotalsDisplay(sectionId) {
  const division = getDivisionSection(sectionId);
  if (!division) return;
  applyDivisionModeRules(division);
  const totals = getDivisionTotals(division);
  const consultantLabel = isGlendaleDivisionId(division.id) ? "Consultant" : "Subtrade";
  const map = {
    labourSell: `Labour Sell ${formatCurrency(totals.labourSell)}`,
    materialSell: `Material Sell ${formatCurrency(totals.materialSell)}`,
    subtradeSell: `${consultantLabel} Sell ${formatCurrency(totals.subtradeSell)}`,
    totalCost: `Total Cost ${formatCurrency(totals.totalCost)}`,
    totalSell: `Total Sell ${formatCurrency(totals.totalSell)}`,
    markupPct: `Markup ${formatPercent(totals.totalMarkupPct)}`
  };

  Object.entries(map).forEach(([field, text]) => {
    const node = el.divisionsContainer.querySelector(
      `[data-division="${sectionId}"][data-division-total="${field}"]`
    );
    if (node) {
      node.textContent = text;
    }
  });

  updateQuoteMarkupSummaryDisplay();
}

function resolveLabourSellTotal(hoursValue, sellRateValue, costRateValue) {
  const hours = parseNumber(hoursValue, 0);
  const costRate = parseNumber(costRateValue, 0);
  const sellRate = parseNumber(sellRateValue, 0);
  const effectiveSellRate = sellRate > 0 ? sellRate : costRate;
  const total = hours * effectiveSellRate;
  return formatNumberForInput(total);
}

function buildWorksheetNotes(row = {}) {
  const noteParts = [
    ...toArray(row?.assumptions),
    ...toArray(row?.missingInputs),
    ...toArray(row?.riskFlags)
  ].filter(Boolean);
  return noteParts.length ? escapeHtml(noteParts.join(" | ")) : "AI estimate applied with current section rates.";
}

function makeWorksheetRow(sectionId, row, index) {
  const noteText = buildWorksheetNotes(row);
  const stateLabel = row?.needsReview ? "Needs review" : row?.locked ? "Locked" : "Estimated";
  const rowClasses = [
    "worksheet-row",
    row?.needsReview ? "needs-review" : "",
    row?.locked ? "locked" : ""
  ]
    .filter(Boolean)
    .join(" ");
  return `
    <div class="${rowClasses}">
      <div class="worksheet-line-no">${escapeHtml(row?.lineNumber || String(index + 1))}</div>
      <div class="worksheet-scope-cell">
        <p class="worksheet-scope-text">${escapeHtml(row?.sourceText || "")}</p>
        <p class="worksheet-notes">${noteText}</p>
      </div>
      <input
        type="number"
        min="0"
        step="0.25"
        data-division="${sectionId}"
        data-row-index="${index}"
        data-worksheet-field="generalLabourHours"
        value="${escapeAttr(formatNumberForInput(row?.generalLabourHours || 0))}"
      />
      <input
        type="number"
        min="0"
        step="0.25"
        data-division="${sectionId}"
        data-row-index="${index}"
        data-worksheet-field="supervisionHours"
        value="${escapeAttr(formatNumberForInput(row?.supervisionHours || 0))}"
      />
      <input
        type="number"
        min="0"
        step="0.25"
        data-division="${sectionId}"
        data-row-index="${index}"
        data-worksheet-field="projectManagerHours"
        value="${escapeAttr(formatNumberForInput(row?.projectManagerHours || 0))}"
      />
      <input
        type="number"
        min="0"
        step="0.01"
        data-division="${sectionId}"
        data-row-index="${index}"
        data-worksheet-field="materialAllowanceCost"
        value="${escapeAttr(formatNumberForInput(row?.materialAllowanceCost || 0))}"
      />
      <input
        type="number"
        min="0"
        step="0.01"
        data-division="${sectionId}"
        data-row-index="${index}"
        data-worksheet-field="subtradeAllowanceCost"
        value="${escapeAttr(formatNumberForInput(row?.subtradeAllowanceCost || 0))}"
      />
      <div class="worksheet-confidence-cell">
        <span class="worksheet-confidence">${escapeHtml(formatWorksheetConfidence(row?.confidence || 0))}</span>
        <span class="worksheet-state">${escapeHtml(stateLabel)}</span>
      </div>
      <label class="worksheet-lock">
        <input
          type="checkbox"
          data-division="${sectionId}"
          data-row-index="${index}"
          data-worksheet-toggle="locked"
          ${row?.locked ? "checked" : ""}
        />
        Lock
      </label>
    </div>
  `;
}

function makeWorksheetSection(sectionId, division) {
  ensureDivisionWorksheetDefaults(division);
  const rows = toArray(division?.estimateWorksheet);
  const anchorSummaryHtml = makeHistoricalAnchorSummary(sectionId);
  if (!rows.length) {
    return `
      <div class="worksheet-shell worksheet-empty">
        <div class="section-head">
          <p class="section-caption">Estimate Worksheet</p>
        </div>
        ${anchorSummaryHtml}
        <p class="worksheet-empty-copy">Run Force Breakdown to estimate each scope line across the full section scope.</p>
      </div>
    `;
  }

  const isCollapsed = Boolean(division?.worksheetCollapsed);
  const summaryLabel = `${rows.length} scope line${rows.length === 1 ? "" : "s"} estimated`;
  if (isCollapsed) {
    return `
      <div class="worksheet-shell worksheet-collapsed">
        <div class="section-head">
          <p class="section-caption">Estimate Worksheet</p>
          <div class="worksheet-head-actions">
            <span class="worksheet-summary">${summaryLabel}</span>
            <button class="btn worksheet-toggle-btn" type="button" data-action="toggle-worksheet" data-division="${sectionId}">
              Show Worksheet
            </button>
          </div>
        </div>
        <p class="worksheet-collapsed-copy">Worksheet hidden. The generated scope lines still roll into labour, material, and subtrade totals.</p>
      </div>
    `;
  }

  const rowHtml = rows.map((row, index) => makeWorksheetRow(sectionId, row, index)).join("");
  return `
    <div class="worksheet-shell">
      <div class="section-head">
        <p class="section-caption">Estimate Worksheet</p>
        <div class="worksheet-head-actions">
          <span class="worksheet-summary">${summaryLabel}</span>
          <button class="btn worksheet-toggle-btn" type="button" data-action="toggle-worksheet" data-division="${sectionId}">
            Hide Worksheet
          </button>
        </div>
      </div>
      ${anchorSummaryHtml}
      <div class="worksheet-table">
        <div class="worksheet-row header">
          <span>Line</span>
          <span>Scope item</span>
          <span>Labour hrs</span>
          <span>Supervision hrs</span>
          <span>PM hrs</span>
          <span>Material cost</span>
          <span>Vendor cost</span>
          <span>Confidence</span>
          <span>Lock</span>
        </div>
        ${rowHtml}
      </div>
    </div>
  `;
}

function makeHistoricalSuggestionSection(sectionId, division) {
  const suggestions = getEstimateLibrarySuggestionsForSection(sectionId);
  if (!suggestions.length) {
    return `
      <div class="history-shell history-empty">
        <div class="section-head">
          <p class="section-caption">Historical Estimate Suggestions</p>
        </div>
        <p class="history-empty-copy">Run Historical Suggestions to compare this section against imported estimate history.</p>
      </div>
    `;
  }

  const groupsHtml = suggestions
    .map((suggestion) => {
      const matchesHtml = Array.isArray(suggestion.matches) && suggestion.matches.length
        ? suggestion.matches
            .map((match, index) => {
              const labourMedian = parseNumber(match?.stats?.labourHours?.median, 0);
              const materialMedian = parseNumber(match?.stats?.materialCost?.median, 0);
              const subtradeMedian = parseNumber(match?.stats?.subtradeCost?.median, 0);
              const sourceExamples = Array.isArray(match?.sourceExamples) ? match.sourceExamples : [];
              const sourceLabel = sourceExamples
                .slice(0, 2)
                .map((item) => cleanString(item?.fileName))
                .filter(Boolean)
                .join(" • ");
              return `
                <div class="history-match-card">
                  <div class="history-match-top">
                    <div>
                      <p class="history-match-title">${escapeHtml(cleanString(match?.displayDescription || "Historical preset"))}</p>
                      <p class="history-match-meta">${formatWorksheetConfidence(match?.confidence || 0)} confidence • ${parseNumber(
                        match?.sampleCount,
                        0
                      )} source line${parseNumber(match?.sampleCount, 0) === 1 ? "" : "s"}</p>
                    </div>
                    <button
                      class="btn"
                      type="button"
                      data-action="apply-history-match"
                      data-division="${sectionId}"
                      data-scope-line-key="${escapeAttr(cleanString(suggestion.scopeLineKey))}"
                      data-match-index="${index}"
                    >
                      Apply
                    </button>
                  </div>
                  <div class="history-match-stats">
                    <span>Labour median ${formatNumberForInput(labourMedian)} hrs</span>
                    <span>Material median ${formatCurrency(materialMedian)}</span>
                    <span>Vendor median ${formatCurrency(subtradeMedian)}</span>
                  </div>
                  ${sourceLabel ? `<p class="history-match-source">Source quotes: ${escapeHtml(sourceLabel)}</p>` : ""}
                </div>
              `;
            })
            .join("")
        : `<p class="history-empty-copy">No strong historical match found for this scope line.</p>`;
      return `
        <div class="history-scope-group">
          <div class="history-scope-head">
            <span class="history-line-no">${escapeHtml(cleanString(suggestion.lineNumber || ""))}</span>
            <p class="history-scope-text">${escapeHtml(cleanString(suggestion.sourceText || ""))}</p>
          </div>
          <div class="history-match-stack">
            ${matchesHtml}
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="history-shell">
      <div class="section-head">
        <p class="section-caption">Historical Estimate Suggestions</p>
        <span class="worksheet-summary">${suggestions.length} scope line${suggestions.length === 1 ? "" : "s"} compared</span>
      </div>
      <div class="history-stack">
        ${groupsHtml}
      </div>
    </div>
  `;
}

function buildPricingBookEstimatorOptions(selectedId = "", selectedName = "") {
  const normalizedSelectedId = cleanString(selectedId).toUpperCase();
  const options = [];
  const items = Array.isArray(state.pricingBookEstimators) ? state.pricingBookEstimators : [];
  if (!normalizedSelectedId) {
    options.push('<option value="" selected>Select estimator</option>');
  } else {
    options.push('<option value="">Select estimator</option>');
  }

  if (normalizedSelectedId && !items.some((item) => cleanString(item?.id).toUpperCase() === normalizedSelectedId)) {
    const fallbackLabel = cleanString(selectedName)
      ? `${cleanString(selectedName)} (${normalizedSelectedId})`
      : normalizedSelectedId;
    options.push(`<option value="${escapeAttr(normalizedSelectedId)}" selected>${escapeHtml(fallbackLabel)}</option>`);
  }

  items.forEach((item) => {
    const estimatorId = cleanString(item?.id).toUpperCase();
    if (!estimatorId) return;
    const label = cleanString(item?.label || `${cleanString(item?.name)} (${estimatorId})`);
    options.push(
      `<option value="${escapeAttr(estimatorId)}" ${estimatorId === normalizedSelectedId ? "selected" : ""}>${escapeHtml(label)}</option>`
    );
  });

  return options.join("");
}

function getPricingBookEstimatorHint() {
  if (state.pricingBookEstimatorsLoading) {
    return "Loading pricing-book estimators...";
  }
  if (state.pricingBookEstimatorsLoadError) {
    return `Unable to refresh the live estimator list right now. ${state.pricingBookEstimatorsLoadError}`;
  }
  if (state.pricingBookEstimators.length) {
    return "Required for pricing-book and Acumatica line assignment.";
  }
  return "No estimators available yet.";
}

function renderDivisions() {
  const addButtonsHtml = DIVISIONS.map((division) => {
    return `
      <button class="division-add-btn" data-action="add-division-section" data-trade="${division.id}" type="button">
        <span class="division-add-eyebrow">Add Section</span>
        <span class="division-add-title">${escapeHtml(division.title)}</span>
      </button>
    `;
  }).join("");

  const selectedHtml = getSelectedDivisionSections()
    .map((item) => {
      const sectionId = cleanString(item.sectionId);
      const divisionMeta = getDivisionDefinition(item.id);
      applyDivisionModeRules(item);
      ensureDivisionWorksheetDefaults(item);
      const isGlendale = isGlendaleDivisionId(item.id);
      const labourRows = getDivisionLabourRows(item);
      const subcontractorLabel = getDivisionSubcontractorLabel(item);
      ensureDivisionTemplateDefaults(sectionId);
      syncDivisionEstimatorName(item);
      if (!cleanString(item.templateTaskCd) || !cleanString(item.templateCostCode)) {
        const genericItem = getGenericTemplateItemForDivision(item.id);
        if (genericItem) {
          applyTemplateToDivision(sectionId, genericItem);
        }
      }
      const totals = getDivisionTotals(item);
      const lineHeader = `
        <div class="cost-row header">
          <span>Description</span>
          <span>Qty</span>
          <span>UOM</span>
          <span>Unit cost</span>
          <span>Cost total</span>
          <span>%</span>
          <span>Sell total</span>
          <span class="cost-action-col" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M4 7h16" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
              <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
            </svg>
          </span>
        </div>
      `;
      const hasMaterialLines = item.materialLines.length > 0;
      const materialRows = item.materialLines
        .map((line, index) => makeLineRow(sectionId, "material", line, index))
        .join("");
      const materialTable = hasMaterialLines ? `<div class="cost-table">${lineHeader}${materialRows}</div>` : "";

      const hasSubtradeLines = item.subcontractorLines.length > 0;
      const subcontractorRows = item.subcontractorLines
        .map((line, index) =>
          makeLineRow(sectionId, "subcontractor", line, index, {
            removeLabel: `Remove ${subcontractorLabel.toLowerCase()}`
          })
        )
        .join("");
      const subcontractorTable = hasSubtradeLines ? `<div class="cost-table">${lineHeader}${subcontractorRows}</div>` : "";
      const divisionTitle = getDivisionDisplayTitle(item);

      return `
        <article class="division-card" data-division-card="${sectionId}">
          <div class="division-card-top">
            <div class="division-card-title-wrap">
              <span class="division-chip">${escapeHtml(divisionMeta.title)}</span>
              <label class="division-title-field">
                <span class="division-title-caption">Section title</span>
                <input
                  class="division-title-input"
                  data-division="${sectionId}"
                  data-field="sectionTitle"
                  value="${escapeAttr(divisionTitle)}"
                  placeholder="${escapeAttr(getAutoSectionTitle(item.id, item.sectionNumber || 1))}"
                />
              </label>
            </div>
            <button class="btn ghost danger" data-action="remove-division-section" data-division="${sectionId}" type="button">
              Remove
            </button>
          </div>

          <div class="division-grid">
            <label>
              Scope of work *
              <textarea rows="3" data-division="${sectionId}" data-field="scope" placeholder="Describe the work scope.">${escapeHtml(
                item.scope
              )}</textarea>
            </label>

            <label>
              Estimator *
              <select
                data-division="${sectionId}"
                data-field="estimatorId"
                ${state.pricingBookEstimatorsLoading && !state.pricingBookEstimators.length ? "disabled" : ""}
              >
                ${buildPricingBookEstimatorOptions(item.estimatorId || item.templateEstimator, item.estimatorName)}
              </select>
              <span class="hint">${escapeHtml(getPricingBookEstimatorHint())}</span>
            </label>

            <div>
              <div class="section-head">
                <p class="section-caption">Labour</p>
                <label class="inline-check">
                  <input type="checkbox" data-division="${sectionId}" data-field="labourNoCost" ${
                    item.labourNoCost ? "checked" : ""
                  } />
                  No labour cost
                </label>
              </div>
              ${
                item.labourNoCost
                  ? ""
                  : `
                    <div class="labour-table">
                      <div class="labour-row header">
                        <span>Line</span>
                        <span>Hours</span>
                        <span>Cost rate</span>
                        <span>Sell rate</span>
                      </div>
                      ${labourRows
                        .map(
                          (row) => `
                            <div class="labour-row">
                              <span class="labour-role">${row.label}</span>
                              <input data-division="${sectionId}" data-field="${row.hoursField}" value="${escapeAttr(
                                item[row.hoursField]
                              )}" placeholder="0" />
                              <input data-division="${sectionId}" data-field="${row.rateField}" value="${escapeAttr(
                                item[row.rateField]
                              )}" placeholder="0" />
                              <input data-division="${sectionId}" data-field="${row.sellField}" value="${escapeAttr(
                                item[row.sellField]
                              )}" placeholder="0" />
                            </div>
                          `
                        )
                        .join("")}
                    </div>
                  `
              }
            </div>

            ${
              isGlendale
                ? ""
                : `
                  <div>
                    <div class="section-head">
                      <p class="section-caption">Material</p>
                      <label class="inline-check">
                        <input type="checkbox" data-division="${sectionId}" data-field="materialNoCost" ${
                          item.materialNoCost ? "checked" : ""
                        } />
                        No material cost
                      </label>
                    </div>
                    ${materialTable}
                    <button class="btn" data-action="add-line" data-division="${sectionId}" data-kind="material" type="button">Add Material Line</button>
                  </div>
                `
            }

            <div>
              <div class="section-head">
                <p class="section-caption">${subcontractorLabel}</p>
                <label class="inline-check">
                  <input type="checkbox" data-division="${sectionId}" data-field="subcontractorNoCost" ${
                    item.subcontractorNoCost ? "checked" : ""
                  } />
                  No ${subcontractorLabel.toLowerCase()} cost
                </label>
              </div>
              ${subcontractorTable}
              <button class="btn" data-action="add-line" data-division="${sectionId}" data-kind="subcontractor" type="button">Add ${subcontractorLabel} Line</button>
            </div>

            <div class="division-totals">
              <span data-division="${sectionId}" data-division-total="labourSell">Labour Sell ${formatCurrency(totals.labourSell)}</span>
              ${isGlendale ? "" : `<span data-division="${sectionId}" data-division-total="materialSell">Material Sell ${formatCurrency(totals.materialSell)}</span>`}
              <span data-division="${sectionId}" data-division-total="subtradeSell">${subcontractorLabel} Sell ${formatCurrency(totals.subtradeSell)}</span>
              <span data-division="${sectionId}" data-division-total="totalCost">Total Cost ${formatCurrency(totals.totalCost)}</span>
              <span class="total-pill" data-division="${sectionId}" data-division-total="totalSell">Total Sell ${formatCurrency(totals.totalSell)}</span>
              <span class="markup-pill" data-division="${sectionId}" data-division-total="markupPct">Markup ${formatPercent(
                totals.totalMarkupPct
              )}</span>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  const emptyStateHtml = getSelectedDivisionSections().length
    ? ""
    : `
      <div class="division-empty-state">
        <p class="division-empty-title">Start with a trade section.</p>
        <p class="hint">Add one or more trade sections for this quote. Repeated sections stay separate through AI, validation, and quote creation.</p>
      </div>
    `;

  el.divisionsContainer.innerHTML = `
    <section class="division-selector-shell">
      <div class="division-selector-head">
        <div>
          <p class="division-selector-copy">Add as many scoped trade sections as this opportunity needs.</p>
        </div>
        <div class="division-selector-count">${getSelectedDivisionSections().length} section${getSelectedDivisionSections().length === 1 ? "" : "s"}</div>
      </div>
      <div class="division-selector-grid">${addButtonsHtml}</div>
    </section>
    <section class="division-stack">
      ${emptyStateHtml}
      ${selectedHtml}
    </section>
  `;
  syncDivisionScopeTextareaSizes();
  syncCostLineDescriptionTextareaSizes();
  syncProjectTypeField();
  updateQuoteMarkupSummaryDisplay();
  renderPrototypeEstimatePanel();
}

function normalizeLineForPayload(line) {
  const normalizedQuantity = cleanString(line.quantity);
  return {
    description: cleanString(line.description),
    quantity: normalizedQuantity,
    quantityStatus: cleanString(line.quantityStatus),
    uom: cleanString(line.uom || "EACH").toUpperCase(),
    unitCost: cleanString(line.unitCost),
    costCode: cleanString(line.costCode || ""),
    cost: cleanString(line.cost),
    markup: cleanString(line.markup || "50"),
    sellingPrice: cleanString(line.sellingPrice),
    specStatus: cleanString(line.specStatus),
    confidence: cleanString(line.confidence),
    requiredInputs: Array.isArray(line.requiredInputs)
      ? line.requiredInputs.map((item) => cleanString(item)).filter(Boolean)
      : [],
    assumptions: Array.isArray(line.assumptions)
      ? line.assumptions.map((item) => cleanString(item)).filter(Boolean)
      : [],
    riskFlags: Array.isArray(line.riskFlags)
      ? line.riskFlags.map((item) => cleanString(item)).filter(Boolean)
      : [],
    expenseGroup: cleanString(line.expenseGroup || ""),
    taxCategory: cleanString(line.taxCategory || "")
  };
}

function buildTaskPlanContextLine(line = {}) {
  return {
    description: cleanString(line.description),
    quantity: cleanString(line.quantity),
    uom: cleanString(line.uom || "EACH"),
    unitCost: cleanString(line.unitCost),
    cost: cleanString(line.cost),
    sellingPrice: cleanString(line.sellingPrice),
    markup: cleanString(line.markup || "50"),
    scopeLineKey: cleanString(line.scopeLineKey),
    sourceText: cleanString(line.sourceText),
    autoGenerated: Boolean(line.autoGenerated),
    locked: Boolean(line.locked)
  };
}

function stripGeneratedAllowancePrefix(rawDescription = "") {
  return cleanString(rawDescription).replace(
    /^(?:material allowance|specialized system allowance)\s*[-:]\s*/i,
    ""
  );
}

function buildWorksheetGeneratedLineDescription(worksheetRow = {}, fallbackDescription = "") {
  const explicitDescription = stripGeneratedAllowancePrefix(fallbackDescription);
  if (explicitDescription) return repairScopeLineText(explicitDescription);
  const sourceText = stripGeneratedAllowancePrefix(worksheetRow?.sourceText || worksheetRow?.normalizedText);
  if (!sourceText) return "Scope item";
  return repairScopeLineText(sourceText);
}

function resolveWorksheetGeneratedQuantityAndUom(worksheetRow = {}, suggestion = null, fallbackUom = "EACH") {
  const suggestedQuantityRaw = cleanString(suggestion?.quantity);
  const suggestedQuantity = parseNumber(suggestedQuantityRaw, Number.NaN);
  const hasSuggestedQuantity = suggestedQuantityRaw !== "" && Number.isFinite(suggestedQuantity) && suggestedQuantity > 0;
  const suggestionDescription = stripGeneratedAllowancePrefix(suggestion?.description);
  const rowText = cleanString(worksheetRow?.sourceText || worksheetRow?.normalizedText);
  const measuredQuantity = extractMeasuredQuantityFromText(`${suggestionDescription} ${rowText}`);
  const measuredValue = Math.max(0, parseNumber(measuredQuantity?.quantity, 0));
  const measuredUom = cleanString(measuredQuantity?.uom);
  const normalizedSuggestedUom = normalizeSuggestedUom(suggestion?.uom);
  const shouldPreferMeasuredQuantity =
    measuredValue > 0 &&
    (
      !hasSuggestedQuantity ||
      suggestedQuantity <= 0 ||
      (suggestedQuantity === 1 && measuredValue !== 1) ||
      (["EACH", "EA", "ITEM"].includes(normalizedSuggestedUom) && measuredUom && measuredUom !== normalizedSuggestedUom)
    );
  const quantity = shouldPreferMeasuredQuantity
    ? measuredValue
    : hasSuggestedQuantity
      ? suggestedQuantity
      : measuredValue;
  const fallbackItemUom =
    !quantity && /(project manager|project coordinator|coordination|scheduling|closeout|supervis|safety|quality)/i.test(rowText)
      ? "ITEM"
      : fallbackUom;
  const preferredUom =
    measuredUom && (!normalizedSuggestedUom || ["EACH", "EA", "ITEM"].includes(normalizedSuggestedUom))
      ? measuredUom
      : suggestion?.uom || measuredUom;
  const uom = resolveSuggestedUom(
    preferredUom,
    `${suggestionDescription} ${rowText}`,
    fallbackItemUom
  );
  return {
    quantity: quantity > 0 ? quantity : 1,
    uom: quantity > 0 ? uom : resolveSuggestedUom(uom, `${suggestionDescription} ${rowText}`, fallbackItemUom)
  };
}

function buildGeneratedWorksheetMaterialLine(division, worksheetRow, suggestion = null) {
  const defaults = getDivisionLineDefaults(division, "material");
  const line = defaultCostLine("material", defaults);
  const description = buildWorksheetGeneratedLineDescription(worksheetRow, suggestion?.description);
  const quantityAndUom = resolveWorksheetGeneratedQuantityAndUom(worksheetRow, suggestion, defaults.uom || "EACH");
  const quantity = quantityAndUom.quantity;
  const unitCost = Math.max(0, parseNumber(suggestion?.unitCost, 0));
  const totalCost = Math.max(0, parseNumber(suggestion?.cost, 0));
  const markup = Math.max(0, parseNumber(suggestion?.markup, 50));
  const costTotal = totalCost > 0 ? totalCost : unitCost > 0 ? unitCost * quantity : Math.max(0, parseNumber(worksheetRow?.materialAllowanceCost, 0));
  const effectiveUnitCost = unitCost > 0 ? unitCost : quantity > 0 ? costTotal / quantity : costTotal;
  line.description = description;
  line.quantity = formatNumberForInput(quantity);
  line.uom = quantityAndUom.uom;
  line.unitCost = formatNumberForInput(effectiveUnitCost);
  line.cost = formatNumberForInput(costTotal);
  line.markup = formatNumberForInput(markup || 50);
  line.sellingPrice = getAutoSellTotal(line.cost, line.markup);
  line.autoGenerated = true;
  line.source = "worksheet";
  line.origin = "ai";
  line.scopeLineKey = cleanString(worksheetRow?.scopeLineKey);
  line.sourceText = cleanString(worksheetRow?.sourceText || worksheetRow?.normalizedText);
  line.locked = false;
  if (suggestion) {
    line.assumptions = Array.isArray(suggestion?.assumptions)
      ? suggestion.assumptions.map((item) => cleanString(item)).filter(Boolean)
      : [];
    line.riskFlags = Array.isArray(suggestion?.riskFlags)
      ? suggestion.riskFlags.map((item) => cleanString(item)).filter(Boolean)
      : [];
    line.confidence = formatNumberForInput(parseNumber(suggestion?.confidence, worksheetRow?.confidence || 0.6));
  } else {
    line.assumptions = Array.isArray(worksheetRow?.assumptions)
      ? worksheetRow.assumptions.map((item) => cleanString(item)).filter(Boolean)
      : [];
    line.riskFlags = Array.isArray(worksheetRow?.riskFlags)
      ? worksheetRow.riskFlags.map((item) => cleanString(item)).filter(Boolean)
      : [];
    line.confidence = formatNumberForInput(parseNumber(worksheetRow?.confidence, 0.6));
  }
  return line;
}

function buildGeneratedWorksheetSubtradeLine(division, worksheetRow) {
  const defaults = getDivisionLineDefaults(division, "subcontractor");
  const line = defaultCostLine("subcontractor", defaults);
  const costTotal = Math.max(0, parseNumber(worksheetRow?.subtradeAllowanceCost, 0));
  if (costTotal <= 0) return null;
  const description = buildWorksheetGeneratedLineDescription(worksheetRow);
  const quantityAndUom = resolveWorksheetGeneratedQuantityAndUom(worksheetRow, null, defaults.uom || "EACH");
  line.description = description;
  line.quantity = formatNumberForInput(quantityAndUom.quantity);
  line.uom = quantityAndUom.uom;
  line.unitCost = formatNumberForInput(quantityAndUom.quantity > 0 ? costTotal / quantityAndUom.quantity : costTotal);
  line.cost = formatNumberForInput(costTotal);
  line.markup = "50";
  line.sellingPrice = getAutoSellTotal(line.cost, line.markup);
  line.autoGenerated = true;
  line.source = "worksheet";
  line.origin = "ai";
  line.scopeLineKey = cleanString(worksheetRow?.scopeLineKey);
  line.sourceText = cleanString(worksheetRow?.sourceText || worksheetRow?.normalizedText);
  line.locked = false;
  line.assumptions = uniqueStringList([
    ...toArray(worksheetRow?.assumptions),
    "ASSUMED: Specialized system/vendor allowance generated from scope text."
  ]);
  line.riskFlags = uniqueStringList(toArray(worksheetRow?.riskFlags));
  line.confidence = formatNumberForInput(parseNumber(worksheetRow?.confidence, 0.6));
  return line;
}

function isWorksheetSpecificSubtradeScope(row = {}) {
  const text = cleanString(row?.sourceText || row?.normalizedText).toLowerCase();
  if (!text) return false;
  return /(vendor|subcontract|subtrade|supplier|specialty|specialized system|proprietary|equipment|manufacturer|compact shelving|mobile shelving|mechanically assisted|powered carriage|rental|testing|inspection|permit|engineering|consultant|stamped)/i.test(
    text
  );
}

function getWorksheetSubtradeAggregateLineKey(division = {}) {
  return `worksheet-subtrade-aggregate-${cleanString(division?.sectionId || division?.id || "division")}`;
}

function hasWorksheetGeneratedSubtradeAggregate(division = {}) {
  const rows = toArray(division?.estimateWorksheet).filter((row) => parseNumber(row?.subtradeAllowanceCost, 0) > 0);
  const genericRows = rows.filter((row) => !isWorksheetSpecificSubtradeScope(row));
  return genericRows.length > 1;
}

function buildGeneratedWorksheetSubtradeAggregateLine(division, worksheetRows = []) {
  const defaults = getDivisionLineDefaults(division, "subcontractor");
  const line = defaultCostLine("subcontractor", defaults);
  const rows = toArray(worksheetRows).filter((row) => parseNumber(row?.subtradeAllowanceCost, 0) > 0);
  const costTotal = rows.reduce((sum, row) => sum + Math.max(0, parseNumber(row?.subtradeAllowanceCost, 0)), 0);
  if (costTotal <= 0) return null;
  line.description = "Vendor / subtrade allowance pending scope confirmation";
  line.quantity = "1";
  line.uom = "ITEM";
  line.unitCost = formatNumberForInput(costTotal);
  line.cost = formatNumberForInput(costTotal);
  line.markup = "50";
  line.sellingPrice = getAutoSellTotal(line.cost, line.markup);
  line.autoGenerated = true;
  line.source = "worksheet";
  line.origin = "ai";
  line.scopeLineKey = getWorksheetSubtradeAggregateLineKey(division);
  line.sourceText = rows.map((row) => cleanString(row?.sourceText || row?.normalizedText)).filter(Boolean).join(" | ");
  line.locked = false;
  line.assumptions = uniqueStringList([
    "ASSUMED: Section-wide vendor/subtrade allowance remains provisional until specialist scope is confirmed.",
    ...rows.flatMap((row) => toArray(row?.assumptions))
  ]);
  line.riskFlags = uniqueStringList([
    "Confirm whether this work is self-performed or requires external vendor pricing before final quote issue.",
    ...rows.flatMap((row) => toArray(row?.riskFlags))
  ]);
  const confidenceValues = rows
    .map((row) => parseNumber(row?.confidence, Number.NaN))
    .filter((value) => Number.isFinite(value));
  const averageConfidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : 0.45;
  line.confidence = formatNumberForInput(Math.max(0.05, Math.min(0.99, averageConfidence)));
  return line;
}

function getWorksheetGeneratedMaterialLines(division = {}) {
  ensureDivisionWorksheetDefaults(division);
  if (isGlendaleDivisionId(division?.id)) return [];
  return toArray(division.estimateWorksheet).flatMap((row) => {
    if (!row || !cleanString(row.scopeLineKey)) return [];
    const explicitSuggestions = Array.isArray(row.materialSuggestions) ? row.materialSuggestions.filter(Boolean) : [];
    if (explicitSuggestions.length) {
      return explicitSuggestions
        .map((suggestion) => buildGeneratedWorksheetMaterialLine(division, row, suggestion))
        .filter((line) => parseNumber(line.cost, 0) > 0 || parseNumber(line.unitCost, 0) > 0);
    }
    if (parseNumber(row.materialAllowanceCost, 0) <= 0) {
      return [];
    }
    return [buildGeneratedWorksheetMaterialLine(division, row)];
  });
}

function getWorksheetGeneratedSubtradeLines(division = {}) {
  ensureDivisionWorksheetDefaults(division);
  if (isGlendaleDivisionId(division?.id)) return [];
  const rows = toArray(division.estimateWorksheet).filter((row) => parseNumber(row?.subtradeAllowanceCost, 0) > 0);
  const specificRows = rows.filter((row) => isWorksheetSpecificSubtradeScope(row));
  const genericRows = rows.filter((row) => !isWorksheetSpecificSubtradeScope(row));
  const directRows = genericRows.length > 1 ? [] : genericRows;
  const aggregateRows = genericRows.length > 1 ? genericRows : [];
  return [
    ...specificRows.map((row) => buildGeneratedWorksheetSubtradeLine(division, row)),
    ...directRows.map((row) => buildGeneratedWorksheetSubtradeLine(division, row)),
    ...(aggregateRows.length ? [buildGeneratedWorksheetSubtradeAggregateLine(division, aggregateRows)] : [])
  ].filter(Boolean);
}

function rollupEstimateWorksheetForDivision(division) {
  if (!division || isGlendaleDivisionId(division.id)) return;
  ensureDivisionWorksheetDefaults(division);
  const worksheetRows = Array.isArray(division.estimateWorksheet) ? division.estimateWorksheet : [];
  const technicianHours = worksheetRows.reduce((sum, row) => sum + Math.max(0, parseNumber(row?.generalLabourHours, 0)), 0);
  const supervisionHours = worksheetRows.reduce((sum, row) => sum + Math.max(0, parseNumber(row?.supervisionHours, 0)), 0);
  const projectManagerHours = worksheetRows.reduce((sum, row) => sum + Math.max(0, parseNumber(row?.projectManagerHours, 0)), 0);
  if (technicianHours > 0 || supervisionHours > 0 || projectManagerHours > 0) {
    division.labourNoCost = false;
  }

  if (cleanString(division.estimateRollup.technicianHoursOrigin) !== "manual") {
    division.technicianHours = technicianHours > 0 ? formatNumberForInput(technicianHours) : "";
    division.estimateRollup.technicianHoursOrigin = technicianHours > 0 ? "ai" : "";
  }
  if (cleanString(division.estimateRollup.supervisionHoursOrigin) !== "manual") {
    division.supervisionHours = supervisionHours > 0 ? formatNumberForInput(supervisionHours) : "";
    division.estimateRollup.supervisionHoursOrigin = supervisionHours > 0 ? "ai" : "";
  }
  if (cleanString(division.estimateRollup.projectManagerHoursOrigin) !== "manual") {
    division.projectManagerHours = projectManagerHours > 0 ? formatNumberForInput(projectManagerHours) : "";
    division.estimateRollup.projectManagerHoursOrigin = projectManagerHours > 0 ? "ai" : "";
  }

  const activeRowKeys = new Set(worksheetRows.map((row) => cleanString(row?.scopeLineKey)).filter(Boolean));
  if (hasWorksheetGeneratedSubtradeAggregate(division)) {
    activeRowKeys.add(getWorksheetSubtradeAggregateLineKey(division));
  }
  const lockedGeneratedLines = toArray(division.materialLines).filter(
    (line) =>
      Boolean(line?.autoGenerated) &&
      cleanString(line?.source) === "worksheet" &&
      Boolean(line?.locked) &&
      activeRowKeys.has(cleanString(line?.scopeLineKey))
  );
  const manualLines = toArray(division.materialLines).filter(
    (line) => !Boolean(line?.autoGenerated) || cleanString(line?.source) !== "worksheet"
  );
  const generatedLines = getWorksheetGeneratedMaterialLines(division).filter((line) => {
    const lineKey = cleanString(line?.scopeLineKey);
    return !lockedGeneratedLines.some((existing) => cleanString(existing?.scopeLineKey) === lineKey);
  });
  division.materialLines = [...manualLines, ...lockedGeneratedLines, ...generatedLines];
  division.materialNoCost = division.materialLines.length === 0;

  const lockedGeneratedSubtradeLines = toArray(division.subcontractorLines).filter(
    (line) =>
      Boolean(line?.autoGenerated) &&
      cleanString(line?.source) === "worksheet" &&
      Boolean(line?.locked) &&
      activeRowKeys.has(cleanString(line?.scopeLineKey))
  );
  const manualSubtradeLines = toArray(division.subcontractorLines).filter(
    (line) => !Boolean(line?.autoGenerated) || cleanString(line?.source) !== "worksheet"
  );
  const generatedSubtradeLines = getWorksheetGeneratedSubtradeLines(division).filter((line) => {
    const lineKey = cleanString(line?.scopeLineKey);
    return !lockedGeneratedSubtradeLines.some((existing) => cleanString(existing?.scopeLineKey) === lineKey);
  });
  division.subcontractorLines = [...manualSubtradeLines, ...lockedGeneratedSubtradeLines, ...generatedSubtradeLines];
  division.subcontractorNoCost = division.subcontractorLines.length === 0;
}

function mergeWorksheetRowsForDivision(division, incomingRows = []) {
  ensureDivisionWorksheetDefaults(division);
  const existingByKey = new Map(
    toArray(division.estimateWorksheet).map((row) => [cleanString(row?.scopeLineKey), normalizeEstimateWorksheetRow(row, division)])
  );
  division.estimateWorksheet = incomingRows
    .map((row) => normalizeEstimateWorksheetRow(row, division))
    .filter(Boolean)
    .map((row) => {
      const existing = existingByKey.get(cleanString(row.scopeLineKey));
      if (existing?.locked) {
        return {
          ...existing,
          lineNumber: cleanString(existing.lineNumber || row.lineNumber),
          sourceText: cleanString(existing.sourceText || row.sourceText),
          normalizedText: cleanString(existing.normalizedText || row.normalizedText)
        };
      }
      return row;
    });
}

function splitScopeLinesForLint(scopeText = "") {
  return cleanString(scopeText)
    .replace(/\r\n/g, "\n")
    .split(/\r?\n+/)
    .map((line) => cleanString(line).replace(/^[-*•]\s*/, "").replace(/^\d+(?:\.\d+)*\.?\s*/, ""))
    .filter(Boolean);
}

function hasExplicitScopeMeasurement(text = "") {
  const source = cleanString(text);
  if (!source) return false;
  if (extractMeasuredQuantityFromText(source)) return true;
  if (/\b\d+(?:\.\d+)?\s*(?:each|ea|qty|nos?|no\.?)\b/i.test(source)) return true;
  if (
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i.test(
      source
    ) &&
    new RegExp(`\\b(${COUNT_BASED_SCOPE_NOUN_PATTERN})\\b`, "i").test(source)
  ) {
    return true;
  }
  return false;
}

function scopeLineNeedsMeasuredQuantity(line = "") {
  const text = cleanString(line);
  if (!text) return false;
  if (/\ballowance|lump sum|ls\b|tbd\b|to be confirmed\b/i.test(text)) return false;
  const hasActionVerb =
    /\b(remove|supply|install|replace|paint|repaint|repair|apply|seal|grade|compact|stripe|line painting|pave|demolish)\b/i.test(
      text
    );
  const hasQuantifiableObject =
    /\b(door|doors|window|windows|fixture|fixtures|light|lights|unit|units|panel|panels|pipe|pipes|wire|wiring|asphalt|concrete|gravel|paint|striping|lines?|stall|stalls|wall|walls|equipment)\b/i.test(
      text
    );
  if (!hasActionVerb || !hasQuantifiableObject) return false;
  return !hasExplicitScopeMeasurement(text);
}

const SCOPE_LINT_STOP_WORDS = new Set([
  "and",
  "for",
  "with",
  "the",
  "all",
  "are",
  "into",
  "from",
  "that",
  "this",
  "site",
  "area",
  "areas",
  "within",
  "including",
  "required",
  "install",
  "supply",
  "remove",
  "dispose",
  "existing",
  "designated",
  "following",
  "completion",
  "works"
]);

function tokenizeScopeLintText(value = "") {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((item) => normalizeScopeMatchToken(item))
    .filter((item) => item.length >= 3 && !SCOPE_LINT_STOP_WORDS.has(item));
}

function isLabourExecutionScopeLine(line = "") {
  const text = cleanString(line).toLowerCase();
  if (!text) return false;
  if (/\b(supply|install|provide|furnish)\b/.test(text)) return false;
  return /\b(remove|dispose|demolish|sawcut|loading|load|hauling|haul|cleanup|clean up|grading|compact|compaction)\b/.test(
    text
  );
}

function hasQuantifiedLabourCoverage(division = {}) {
  if (division?.labourNoCost) return false;
  return getDivisionLabourRows(division).some((row) => {
    const hoursRaw = division?.[row.hoursField];
    return hasNumericInput(hoursRaw) && parseNumber(hoursRaw, 0) > 0;
  });
}

function hasQuantifiedCostLineCoverageForScopeLine(division = {}, line = "") {
  const scopeTokens = tokenizeScopeLintText(line);
  if (!scopeTokens.length) return false;
  const scopeFamilies = new Set(detectScopeCoverageFamilies(line));
  const costLines = [...toArray(division?.materialLines), ...toArray(division?.subcontractorLines)];

  return costLines.some((costLine) => {
    const quantityRaw = costLine?.quantity;
    if (!hasNumericInput(quantityRaw) || parseNumber(quantityRaw, 0) <= 0) return false;
    const lineDescription = cleanString(costLine?.description);
    const scopeSourceText = cleanString(costLine?.sourceText);
    const descriptionTokens = new Set(tokenizeScopeLintText(`${costLine?.description || ""} ${scopeSourceText}`));
    if (!descriptionTokens.size) return false;
    let overlap = 0;
    let strongOverlap = 0;
    scopeTokens.forEach((token) => {
      if (!descriptionTokens.has(token)) return;
      overlap += 1;
      if (token.length >= 5) strongOverlap += 1;
    });
    if (overlap >= 2 || strongOverlap >= 1) return true;

    if (scopeFamilies.size) {
      const lineFamilies = detectScopeCoverageFamilies(`${lineDescription} ${scopeSourceText}`);
      if (lineFamilies.some((family) => scopeFamilies.has(family))) {
        return true;
      }
    }
    return false;
  });
}

function buildScopeLintForDivision(division = {}) {
  const blocking = [];
  const warnings = [];
  const lines = splitScopeLinesForLint(division.scope);
  lines.forEach((line) => {
    if (!scopeLineNeedsMeasuredQuantity(line)) return;
    const labourCovered = isLabourExecutionScopeLine(line) && hasQuantifiedLabourCoverage(division);
    const costLineCovered = hasQuantifiedCostLineCoverageForScopeLine(division, line);
    if (labourCovered || costLineCovered) {
      warnings.push(`Scope line has no explicit measurement but is currently covered by quantified estimate input: "${line}"`);
      return;
    }

    blocking.push(`Scope line requires measurable quantity: "${line}"`);
    if (/\bpaint|primer|repaint\b/i.test(line) && /\bdoors?\b/i.test(line)) {
      warnings.push("Paint scope needs door counts by type (bay/single), sides, prep level, and coats.");
    }
  });
  return { blocking, warnings };
}

function hasMeaningfulCostLineInput(line = {}) {
  return (
    Boolean(cleanString(line.description)) ||
    hasNumericInput(line.quantity) ||
    hasNumericInput(line.unitCost) ||
    hasNumericInput(line.cost) ||
    hasNumericInput(line.sellingPrice)
  );
}

function isCompleteCostLineInput(line = {}) {
  const description = cleanString(line.description);
  const hasQuantity = hasNumericInput(line.quantity);
  const hasUnitCost = hasNumericInput(line.unitCost);
  const hasSellingPrice = hasNumericInput(line.sellingPrice);
  const quantity = parseNumber(line.quantity, Number.NaN);
  const unitCost = parseNumber(line.unitCost, Number.NaN);
  const sellingPrice = parseNumber(line.sellingPrice, Number.NaN);
  return (
    Boolean(description) &&
    hasQuantity &&
    hasUnitCost &&
    hasSellingPrice &&
    quantity > 0 &&
    unitCost >= 0 &&
    sellingPrice >= 0
  );
}

function validateDivisionCostRequirements(division, errors = [], options = {}) {
  const allowMissingCosts = Boolean(options.allowMissingCosts);
  applyDivisionModeRules(division);
  const divisionName = getDivisionDisplayTitle(division);
  const isGlendale = isGlendaleDivisionId(division.id);
  const subcontractorLabel = isGlendale ? "consultant" : "subtrade";
  const materialLines = (division.materialLines || []).map(normalizeLineForPayload);
  const subcontractorLines = (division.subcontractorLines || []).map(normalizeLineForPayload);
  const meaningfulMaterialLines = materialLines.filter(hasMeaningfulCostLineInput);
  const meaningfulSubcontractorLines = subcontractorLines.filter(hasMeaningfulCostLineInput);

  if (!cleanString(division.scope)) {
    errors.push(`${divisionName} scope of work is required.`);
  } else if (!allowMissingCosts) {
    const scopeLint = buildScopeLintForDivision(division);
    scopeLint.blocking.forEach((item) => errors.push(`${divisionName} ${item}`));
  }

  if (!division.labourNoCost && !allowMissingCosts) {
    const labourRows = getDivisionLabourRows(division).map((row) => ({
      label: cleanString(row.label).toLowerCase(),
      hours: parseNumber(division[row.hoursField], Number.NaN),
      costRate: parseNumber(division[row.rateField], Number.NaN),
      sellRate: parseNumber(division[row.sellField], Number.NaN),
      hasHours: hasNumericInput(division[row.hoursField]),
      hasCostRate: hasNumericInput(division[row.rateField]),
      hasSellRate: hasNumericInput(division[row.sellField])
    }));
    const hasAnyLabourInput = labourRows.some((row) => row.hasHours || row.hasCostRate || row.hasSellRate);
    if (!hasAnyLabourInput) {
      errors.push(`${divisionName} requires labour details or set labour as no cost.`);
    }
    labourRows.forEach((row) => {
      const hasAnyRowInput = row.hasHours || row.hasCostRate || row.hasSellRate;
      const isCompleteRow =
        row.hasHours &&
        row.hasCostRate &&
        row.hasSellRate &&
        row.hours > 0 &&
        row.costRate >= 0 &&
        row.sellRate >= 0;
      if (hasAnyRowInput && !isCompleteRow) {
        errors.push(
          `${divisionName} ${row.label} must include hours, cost rate, and sell rate, or set labour as no cost.`
        );
      }
    });
  }

  if (!isGlendale && !division.materialNoCost && !allowMissingCosts) {
    if (!meaningfulMaterialLines.length) {
      errors.push(`${divisionName} requires at least one material line or set material as no cost.`);
    }
    meaningfulMaterialLines.forEach((line, index) => {
      if (!isCompleteCostLineInput(line)) {
        errors.push(
          `${divisionName} material line ${index + 1} must include description, quantity, unit cost, and sell total, or set material as no cost.`
        );
      }
    });
  }

  if (!division.subcontractorNoCost && !allowMissingCosts) {
    if (!meaningfulSubcontractorLines.length) {
      errors.push(
        `${divisionName} requires at least one ${subcontractorLabel} line or set ${subcontractorLabel} as no cost.`
      );
    }
    meaningfulSubcontractorLines.forEach((line, index) => {
      if (!isCompleteCostLineInput(line)) {
        errors.push(
          `${divisionName} ${subcontractorLabel} line ${index + 1} must include description, quantity, unit cost, and sell total, or set ${subcontractorLabel} as no cost.`
        );
      }
    });
  }

  return {
    materialLines: isGlendale ? [] : meaningfulMaterialLines,
    subcontractorLines: meaningfulSubcontractorLines
  };
}

function buildPayload() {
  const account = getSelectedAccount();
  const contact = getSelectedContact();
  const accountAddressForPdf = buildPdfAddressObject(account);
  const selectedDivisions = getSelectedDivisionSections();
  const resolvedProjectType = cleanString(state.projectType || resolveAutoProjectType() || "M-Trade");
  const resolvedWillWinJob = cleanString(state.willWinJob || "Yes");
  const resolvedLinkToDrive = cleanString(state.linkToDrive || DEFAULT_LINK_TO_DRIVE_TEXT);
  const scopeText = cleanString(el.quoteBody?.value || state.quoteBody);
  const resolvedQuoteDescription =
    sanitizeBriefDescription(
      cleanString(el.quoteDescription?.value || state.quoteDescription),
      buildLocalQuoteDescription(scopeText)
    );
  if (!cleanString(el.quoteDescription?.value || state.quoteDescription) && resolvedQuoteDescription) {
    setQuoteDescription(resolvedQuoteDescription);
  }

  const errors = [];

  if (!hasSelectedDepartment()) {
    errors.push("Department selection is required.");
  }
  if (!account) errors.push("Business account is required.");
  if (!contact) errors.push("Contact selection is required.");
  if (!selectedDivisions.length) errors.push("At least one trade section must be added.");
  if (!["yes", "no"].includes(resolvedWillWinJob.toLowerCase())) {
    errors.push("Do you think we are going to win this job? must be Yes or No.");
  }
  if (!resolvedLinkToDrive) {
    errors.push("Link to Drive is required.");
  }
  if (!resolvedQuoteDescription) {
    errors.push("Project description is required.");
  }
  if (!state.quoteReviewConfirmed) {
    errors.push("Cost review confirmation is required before creating the quote.");
  }
  if (!cleanString(state.quoteReviewSignerName)) {
    errors.push("Enter the estimator name confirming the cost review.");
  }

  const divisionPayload = selectedDivisions.map((division) => {
    applyDivisionModeRules(division);
    syncDivisionEstimatorName(division);
    const isGlendale = isGlendaleDivisionId(division.id);
    const { materialLines, subcontractorLines } = validateDivisionCostRequirements(division, errors);
    const estimatorId = cleanString(division.estimatorId || division.templateEstimator).toUpperCase();
    const estimatorName = cleanString(division.estimatorName);
    if (!estimatorId) {
      errors.push(`${getDivisionDisplayTitle(division)} estimator is required.`);
    }

    return {
      id: division.id,
      sectionId: cleanString(division.sectionId),
      title: getDivisionDisplayTitle(division),
      estimatorId,
      estimator: estimatorId,
      estimatorName,
      isSelected: true,
      scope: cleanString(division.scope),
      templateMapping: {
        taskCd: cleanString(division.templateTaskCd),
        description: cleanString(division.templateDescription),
        taskType: "Cost and Revenue Task",
        costCode: cleanString(division.templateCostCode),
        revenueGroup: cleanString(division.templateRevenueGroup || "R"),
        taxCategory: cleanString(division.templateTaxCategory || "H"),
        estimator: estimatorId,
        labourUom: cleanString(division.templateLabourUom || "HOUR"),
        materialUom: cleanString(division.templateMaterialUom || "EACH"),
        subtradeUom: cleanString(division.templateSubtradeUom || "EACH")
      },
      labourNoCost: Boolean(division.labourNoCost),
      technicianHours: cleanString(division.technicianHours),
      technicianRate: cleanString(division.technicianRate),
      technicianSellingPrice: resolveLabourSellTotal(
        division.technicianHours,
        division.technicianSellingPrice,
        division.technicianRate
      ),
      supervisionHours: cleanString(division.supervisionHours),
      supervisionRate: cleanString(division.supervisionRate),
      supervisionSellingPrice: resolveLabourSellTotal(
        division.supervisionHours,
        division.supervisionSellingPrice,
        division.supervisionRate
      ),
      projectManagerHours: cleanString(division.projectManagerHours),
      projectManagerRate: cleanString(division.projectManagerRate),
      projectManagerSellingPrice: resolveLabourSellTotal(
        division.projectManagerHours,
        division.projectManagerSellingPrice,
        division.projectManagerRate
      ),
      engineerHours: cleanString(division.engineerHours),
      engineerRate: cleanString(division.engineerRate),
      engineerSellingPrice: resolveLabourSellTotal(
        division.engineerHours,
        division.engineerSellingPrice,
        division.engineerRate
      ),
      seniorEngineerHours: cleanString(division.seniorEngineerHours),
      seniorEngineerRate: cleanString(division.seniorEngineerRate),
      seniorEngineerSellingPrice: resolveLabourSellTotal(
        division.seniorEngineerHours,
        division.seniorEngineerSellingPrice,
        division.seniorEngineerRate
      ),
      materialNoCost: isGlendale ? true : Boolean(division.materialNoCost),
      materialLines: isGlendale ? [] : materialLines,
      subcontractorNoCost: Boolean(division.subcontractorNoCost),
      subcontractorLines
    };
  });

  return {
    valid: errors.length === 0,
    errors,
    payload: {
      quoteType: state.quoteType,
      account: {
        name: cleanString(account?.name),
        businessAccountId: cleanString(account?.businessAccountId),
        owner: cleanString(account?.owner || account?.ownerEmployeeName),
        contactId: cleanString(contact?.contactId),
        contactName: cleanString(contact?.displayName),
        location: "MAIN",
        addressLine1: cleanString(accountAddressForPdf?.addressLine1),
        addressLine2: cleanString(accountAddressForPdf?.addressLine2),
        city: cleanString(accountAddressForPdf?.city),
        state: cleanString(accountAddressForPdf?.state),
        postalCode: cleanString(accountAddressForPdf?.postalCode),
        country: cleanString(accountAddressForPdf?.country),
        address: {
          street: cleanString([accountAddressForPdf?.addressLine1, accountAddressForPdf?.addressLine2].filter(Boolean).join(", ")),
          city: cleanString(accountAddressForPdf?.city),
          state: cleanString(accountAddressForPdf?.state),
          zip: cleanString(accountAddressForPdf?.postalCode),
          country: cleanString(accountAddressForPdf?.country)
        }
      },
      opportunity: {
        willWinJob: resolvedWillWinJob,
        linkToDrive: resolvedLinkToDrive,
        projectType: resolvedProjectType
      },
      divisions: divisionPayload,
      quoteBody: scopeText,
      quoteDescription: resolvedQuoteDescription,
      reviewConfirmation: {
        confirmed: Boolean(state.quoteReviewConfirmed),
        signerName: cleanString(state.quoteReviewSignerName),
        statement: getQuoteReviewStatement(),
        confirmedAt: state.quoteReviewConfirmed ? new Date().toISOString() : ""
      }
    }
  };
}

function buildAiValidationPayload() {
  const selectedDivisions = getSelectedDivisionSections();
  const account = getSelectedAccount();
  const contact = getSelectedContact();
  const accountAddressForPdf = buildPdfAddressObject(account);
  const resolvedProjectType = cleanString(state.projectType || resolveAutoProjectType() || "M-Trade");
  const resolvedWillWinJob = cleanString(state.willWinJob || "Yes");
  const resolvedLinkToDrive = cleanString(state.linkToDrive || DEFAULT_LINK_TO_DRIVE_TEXT);
  const scopeText = cleanString(el.quoteBody?.value || state.quoteBody);
  const estimatorConservativeness = AI_ESTIMATOR_CONSERVATIVENESS;
  state.aiEstimatorConservativeness = estimatorConservativeness;
  const resolvedQuoteDescription =
    sanitizeBriefDescription(
      cleanString(el.quoteDescription?.value || state.quoteDescription),
      buildLocalQuoteDescription(scopeText)
    );
  if (!cleanString(el.quoteDescription?.value || state.quoteDescription) && resolvedQuoteDescription) {
    setQuoteDescription(resolvedQuoteDescription);
  }
  const errors = [];

  if (!hasSelectedDepartment()) {
    errors.push("Department selection is required before running AI review.");
  }
  if (!selectedDivisions.length) {
    errors.push("Add at least one trade section before running AI review.");
  }
  if (!scopeText) {
    errors.push("Final scope of work is required before running AI validation.");
  }

  const divisionPayload = selectedDivisions.map((division) => {
    applyDivisionModeRules(division);
    syncDivisionEstimatorName(division);
    const isGlendale = isGlendaleDivisionId(division.id);
    const { materialLines, subcontractorLines } = validateDivisionCostRequirements(division, errors, {
      allowMissingCosts: false
    });
    const estimatorId = cleanString(division.estimatorId || division.templateEstimator).toUpperCase();
    const estimatorName = cleanString(division.estimatorName);
    return {
      id: division.id,
      sectionId: cleanString(division.sectionId),
      title: getDivisionDisplayTitle(division),
      estimatorId,
      estimator: estimatorId,
      estimatorName,
      isSelected: true,
      scope: cleanString(division.scope),
      templateMapping: {
        taskCd: cleanString(division.templateTaskCd),
        description: cleanString(division.templateDescription),
        taskType: "Cost and Revenue Task",
        costCode: cleanString(division.templateCostCode),
        revenueGroup: cleanString(division.templateRevenueGroup || "R"),
        taxCategory: cleanString(division.templateTaxCategory || "H"),
        estimator: estimatorId,
        labourUom: cleanString(division.templateLabourUom || "HOUR"),
        materialUom: cleanString(division.templateMaterialUom || "EACH"),
        subtradeUom: cleanString(division.templateSubtradeUom || "EACH")
      },
      labourNoCost: Boolean(division.labourNoCost),
      technicianHours: cleanString(division.technicianHours),
      technicianRate: cleanString(division.technicianRate),
      technicianSellingPrice: resolveLabourSellTotal(
        division.technicianHours,
        division.technicianSellingPrice,
        division.technicianRate
      ),
      supervisionHours: cleanString(division.supervisionHours),
      supervisionRate: cleanString(division.supervisionRate),
      supervisionSellingPrice: resolveLabourSellTotal(
        division.supervisionHours,
        division.supervisionSellingPrice,
        division.supervisionRate
      ),
      projectManagerHours: cleanString(division.projectManagerHours),
      projectManagerRate: cleanString(division.projectManagerRate),
      projectManagerSellingPrice: resolveLabourSellTotal(
        division.projectManagerHours,
        division.projectManagerSellingPrice,
        division.projectManagerRate
      ),
      engineerHours: cleanString(division.engineerHours),
      engineerRate: cleanString(division.engineerRate),
      engineerSellingPrice: resolveLabourSellTotal(
        division.engineerHours,
        division.engineerSellingPrice,
        division.engineerRate
      ),
      seniorEngineerHours: cleanString(division.seniorEngineerHours),
      seniorEngineerRate: cleanString(division.seniorEngineerRate),
      seniorEngineerSellingPrice: resolveLabourSellTotal(
        division.seniorEngineerHours,
        division.seniorEngineerSellingPrice,
        division.seniorEngineerRate
      ),
      materialNoCost: isGlendale ? true : Boolean(division.materialNoCost),
      materialLines: isGlendale ? [] : materialLines,
      subcontractorNoCost: Boolean(division.subcontractorNoCost),
      subcontractorLines
    };
  });

  return {
    valid: errors.length === 0,
    errors,
    payload: {
      quoteType: state.quoteType,
      account: {
        name: cleanString(account?.name),
        businessAccountId: cleanString(account?.businessAccountId),
        owner: cleanString(account?.owner || account?.ownerEmployeeName),
        contactId: cleanString(contact?.contactId),
        contactName: cleanString(contact?.displayName),
        location: "MAIN",
        addressLine1: cleanString(accountAddressForPdf?.addressLine1),
        addressLine2: cleanString(accountAddressForPdf?.addressLine2),
        city: cleanString(accountAddressForPdf?.city),
        state: cleanString(accountAddressForPdf?.state || "ON"),
        postalCode: cleanString(accountAddressForPdf?.postalCode),
        country: "CA"
      },
      opportunity: {
        willWinJob: resolvedWillWinJob,
        linkToDrive: resolvedLinkToDrive,
        projectType: resolvedProjectType
      },
      divisions: divisionPayload,
      quoteBody: scopeText,
      quoteDescription: resolvedQuoteDescription,
      estimatorConfig: {
        conservativeness: estimatorConservativeness,
        postureLabel: getAiConservativenessLabel(estimatorConservativeness),
        country: "CA",
        currency: "CAD",
        labourModel: "canadian-commercial"
      }
    }
  };
}

function buildQuoteBodyFromDivisions() {
  const selectedDivisions = getSelectedDivisionSections();
  const sections = selectedDivisions.map((division) => {
    if (!cleanString(division.templateTaskCd) || !cleanString(division.templateCostCode)) {
      const genericItem = getGenericTemplateItemForDivision(division.id);
      if (genericItem) {
        applyTemplateToDivision(division.sectionId, genericItem);
      }
    }

    const rawScope = cleanString(division.scope) || "Scope to be defined.";
    const scopeWithoutHeading = stripDivisionHeadingFromScope(rawScope, getDivisionDisplayTitle(division));
    const normalizedScope = toScopeBulletList(scopeWithoutHeading || rawScope);
    return `${getDivisionDisplayTitle(division)}\n${normalizedScope || "Scope to be defined."}`;
  });
  const text = sections.join("\n\n");
  setQuoteBodyText(text);
}

function autoResizeTextarea(textarea, minHeight = 84) {
  if (!textarea) return;
  const computedMinHeight = parseFloat(window.getComputedStyle(textarea).minHeight);
  const resolvedMinHeight = Number.isFinite(computedMinHeight) ? computedMinHeight : minHeight;
  textarea.style.height = "auto";
  textarea.style.overflowY = "hidden";
  textarea.style.height = `${Math.max(textarea.scrollHeight, resolvedMinHeight)}px`;
}

function lockHorizontalViewportScroll() {
  const clampHorizontalScroll = () => {
    if (window.scrollX !== 0) {
      window.scrollTo(0, window.scrollY);
    }
  };

  clampHorizontalScroll();
  window.addEventListener("scroll", clampHorizontalScroll, { passive: true });
  window.addEventListener(
    "wheel",
    (event) => {
      if (Math.abs(event.deltaX) > 0.5) {
        event.preventDefault();
        clampHorizontalScroll();
      }
    },
    { passive: false }
  );
}

function syncQuoteBodyTextareaSize() {
  autoResizeTextarea(el.quoteBody, 84);
  autoResizeTextarea(el.quoteDescription, 68);
}

function syncDivisionScopeTextareaSizes() {
  if (!el.divisionsContainer) return;
  const scopeTextareas = el.divisionsContainer.querySelectorAll('textarea[data-field="scope"]');
  scopeTextareas.forEach((textarea) => autoResizeTextarea(textarea, 84));
}

function syncCostLineDescriptionTextareaSizes() {
  if (!el.divisionsContainer) return;
  const descriptionTextareas = el.divisionsContainer.querySelectorAll('textarea[data-line-field="description"]');
  descriptionTextareas.forEach((textarea) => autoResizeTextarea(textarea, 56));
}

function setQuoteBodyText(value) {
  const text = String(value ?? "");
  state.quoteBody = text;
  state.scopeSuggestion = cleanString(text);
  if (!el.quoteBody) return;
  el.quoteBody.value = text;
  syncQuoteBodyTextareaSize();
  renderScopeSuggestion();
}

function renderScopeSuggestion() {
  if (!el.scopeSuggestionNotes) return;
  const scopeText = cleanString(el.quoteBody?.value || state.quoteBody) || cleanString(state.scopeSuggestion);
  const suggestionNotes = cleanString(state.scopeSuggestionNotes);

  if (!scopeText) {
    el.scopeSuggestionNotes.textContent = "Use AI Tools to generate or improve scope, then edit this same box as needed.";
    if (el.scopeApplySuggestionBtn) {
      el.scopeApplySuggestionBtn.disabled = true;
    }
    return;
  }

  el.scopeSuggestionNotes.textContent = suggestionNotes || "AI and manual edits are using this same Full Scope of Work box.";
  if (el.scopeApplySuggestionBtn) {
    el.scopeApplySuggestionBtn.disabled = false;
  }
}

function ensureQuoteBodyText() {
  let current = cleanString(el.quoteBody?.value || state.quoteBody);
  if (!current) {
    buildQuoteBodyFromDivisions();
    current = cleanString(el.quoteBody?.value || state.quoteBody);
  }
  return current;
}

function truncateWithEllipsis(value, max = 120) {
  const text = cleanString(value).replace(/\s+/g, " ");
  if (!text) return "";
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const safeSlice = lastSpace > 20 ? slice.slice(0, lastSpace) : slice;
  return safeSlice.trimEnd();
}

function toTitleCase(value) {
  const text = cleanString(value);
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function stripDescriptionNoise(value) {
  return cleanString(value)
    .replace(/[\u2022•▪◦·]/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/^\d+\s*[\.\)\-:]\s*/g, "")
    .replace(/^(construction|electrical|plumbing|hvac|glendale)\s*/i, "")
    .replace(/^(scope of work|statement of work|scope)\s*[:\-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function limitWords(value, maxWords = 16) {
  return cleanString(value)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .join(" ");
}

function toHeadlineCase(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
    .replace(/\bHvac\b/g, "HVAC");
}

function normalizeScopeNumbering(text = "") {
  return String(text || "")
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

function stripScopeLinePrefix(line = "") {
  return cleanString(line)
    .replace(/^[*•▪◦·-]\s*/, "")
    .replace(/^\d+(?:\.\d+)+\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^\d+[)\]:-]\s+/, "")
    .replace(/^\d+\s+(?=[A-Za-z(])/, "")
    .trim();
}

function repairScopeLineText(value = "") {
  return cleanString(value)
    .replace(/\s+:/g, ":")
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function isOrphanDivisionHeadingLine(line = "") {
  return /^(construction|electrical|plumbing|hvac|glendale|service|production)\s*:?\s*$/i.test(cleanString(line));
}

function isScopeContinuationFragment(line = "") {
  const source = repairScopeLineText(line);
  if (!source) return false;
  if (/^(and|or|including|plus|with|to)\b/i.test(source)) return true;
  const wordCount = source.split(/\s+/).filter(Boolean).length;
  return wordCount <= 3 && /^[a-z]/.test(source);
}

function shouldMergeScopeContinuation(previous = "", current = "") {
  const prior = repairScopeLineText(previous);
  const next = repairScopeLineText(current);
  if (!prior || !next || isOrphanDivisionHeadingLine(next)) return false;
  if (isScopeContinuationFragment(next)) return true;
  return (
    /^(maintain|repair|install|remove|reinstall|replace|paint|clean|provide|supply|assign|modify|relocate|upgrade|seal|test|commission|apply)\b/i.test(
      next
    ) &&
    /\b(to|and|for|with|including|plus)\s*$/i.test(prior)
  );
}

function mergeContinuationScopeLines(lines = []) {
  const merged = [];
  (Array.isArray(lines) ? lines : []).forEach((line) => {
    const normalized = repairScopeLineText(line);
    if (!normalized || isOrphanDivisionHeadingLine(normalized)) return;
    if (merged.length && shouldMergeScopeContinuation(merged[merged.length - 1], normalized)) {
      merged[merged.length - 1] = repairScopeLineText(`${merged[merged.length - 1]} ${normalized}`);
      return;
    }
    merged.push(normalized);
  });
  return merged;
}

function normalizeScopeFormattingForUi(text = "") {
  const toLineKey = (line = "") => {
    const headingMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (headingMatch) {
      const headingNumber = cleanString(headingMatch[1]);
      const headingTitle = cleanString(headingMatch[2])
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
      return `heading:${headingNumber}:${headingTitle}`;
    }
    return cleanString(line)
      .replace(/[.:;,\-]+$/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase();
  };

  const isStructuredLine = (line = "") =>
    /^-\s+/.test(line) || /^\d+(?:\.\d+)*\.?\s+[A-Za-z(]/.test(line);
  const actionVerbPattern =
    /\b(remove|supply|install|provide|clean|repair|replace|paint|assign|demolish|prepare|furnish|test|commission|apply|seal|upgrade|relocate|dispose|maintain)\b/i;
  const knownDivisionPattern = /^(construction|electrical|plumbing|hvac|glendale|service|production)\b/i;
  const sentenceSplitPattern = /(?<=[.!?;])\s+(?=[A-Z0-9])/;
  const splitByActionVerbs = (value = "") => {
    const text = cleanString(value);
    if (!text) return [];
    const verbRegex =
      /\b(?:provide|supply(?:\s+and\s+install)?|install|remove|clean|repair|replace|assign|demolish|prepare|furnish|test|commission|apply|seal|upgrade|relocate|dispose|maintain)\b/gi;
    const starts = [];
    let match;
    while ((match = verbRegex.exec(text)) !== null) {
      starts.push(match.index);
    }
    verbRegex.lastIndex = 0;
    if (starts.length <= 1) return [text];

    const segments = [];
    for (let i = 0; i < starts.length; i += 1) {
      const start = starts[i];
      const end = i + 1 < starts.length ? starts[i + 1] : text.length;
      const prefix = i === 0 ? cleanString(text.slice(0, start)) : "";
      let piece = cleanString(text.slice(start, end));
      if (prefix) piece = `${prefix} ${piece}`.replace(/\s+/g, " ").trim();
      if (piece) segments.push(piece);
    }
    return mergeContinuationScopeLines(segments);
  };
  const toSentenceList = (value = "") =>
    cleanString(value)
      .split(sentenceSplitPattern)
      .map((item) => cleanString(item))
      .filter(Boolean)
      .flatMap((item) => splitByActionVerbs(item))
      .map((item) => cleanString(item))
      .filter(Boolean);

  const lines = normalizeScopeNumbering(text)
    .split(/\r?\n/)
    .map((line) =>
      repairScopeLineText(
        cleanString(line)
        .replace(/^[*•▪◦·]\s*/, "- ")
        .replace(/^(\d+)\.\s*\.\s*/g, "$1. ")
        .replace(/^(\d+(?:\.\d+)+)\.\s*/g, "$1 ")
        .replace(/\s+/g, " ")
      )
    )
    .filter(Boolean)
    .filter((line) => !isOrphanDivisionHeadingLine(line));

  const reflowed = [];
  for (const line of lines) {
    const previous = reflowed[reflowed.length - 1];
    if (!previous) {
      reflowed.push(line);
      continue;
    }
    const shouldAppend =
      !isStructuredLine(line) &&
      !/^[A-Z0-9][A-Z0-9 &/().,#:'"-]{2,}$/.test(line);
    if (shouldAppend) {
      reflowed[reflowed.length - 1] = `${previous} ${line}`.replace(/\s+/g, " ").trim();
      continue;
    }
    reflowed.push(line);
  }

  const compact = [];
  for (const line of reflowed) {
    const normalized = toLineKey(line);
    if (!normalized) continue;
    const previous = toLineKey(compact[compact.length - 1] || "");
    if (previous && previous === normalized) continue;
    compact.push(line);
  }

  const expanded = [];
  for (let i = 0; i < compact.length; i += 1) {
    const line = compact[i];
    const headingWithBody = line.match(/^(\d+)\.\s+(.+)$/);
    if (!headingWithBody) {
      expanded.push(line);
      continue;
    }

    const sectionNo = cleanString(headingWithBody[1]);
    const fullHeadingBody = cleanString(headingWithBody[2]);
    const hasChildItemsAhead = compact
      .slice(i + 1)
      .some((nextLine) => new RegExp(`^${sectionNo}\\.\\d+\\s+`).test(nextLine));
    if (hasChildItemsAhead) {
      expanded.push(line);
      continue;
    }

    let headingLabel = "";
    let bodyText = "";
    const knownDivisionMatch = fullHeadingBody.match(knownDivisionPattern);
    if (knownDivisionMatch) {
      headingLabel = toHeadlineCase(cleanString(knownDivisionMatch[1]));
      bodyText = cleanString(fullHeadingBody.slice(cleanString(knownDivisionMatch[0]).length));
    } else {
      const actionVerbMatch = fullHeadingBody.match(actionVerbPattern);
      const actionVerbIndex = Number.isInteger(actionVerbMatch?.index) ? actionVerbMatch.index : -1;
      if (actionVerbIndex > 0) {
        headingLabel = cleanString(fullHeadingBody.slice(0, actionVerbIndex));
        bodyText = cleanString(fullHeadingBody.slice(actionVerbIndex));
      }
    }

    const sentenceLines = toSentenceList(bodyText);
    if (!headingLabel || !sentenceLines.length) {
      expanded.push(line);
      continue;
    }

    expanded.push(`${sectionNo}. ${headingLabel}`);
    sentenceLines.forEach((sentence, sentenceIndex) => {
      expanded.push(`${sectionNo}.${String(sentenceIndex + 1).padStart(2, "0")} ${sentence}`);
    });
  }

  const normalizedLines = expanded
    .map((line) => stripScopeLinePrefix(line))
    .map((line) => repairScopeLineText(line))
    .filter(Boolean)
    .flatMap((line) => {
      const sentenceItems = toSentenceList(line)
        .map((item) => stripScopeLinePrefix(item))
        .map((item) => repairScopeLineText(item))
        .filter(Boolean);
      if (sentenceItems.length < 2) {
        return [line];
      }

      const dedupedItems = [];
      const seenItems = new Set();
      sentenceItems.forEach((item) => {
        const key = cleanString(item).toLowerCase();
        if (!key || seenItems.has(key)) return;
        seenItems.add(key);
        dedupedItems.push(item);
      });
      return dedupedItems.length ? dedupedItems : [line];
    })
    .filter(Boolean)
    .filter((line) => !isOrphanDivisionHeadingLine(line));

  return mergeContinuationScopeLines(normalizedLines).join("\n");
}

function toScopeBulletList(text = "") {
  const lines = splitScopeLinesPreservingInputRows(text)
    .map((line) => cleanString(line).replace(/^[*•▪◦·-]\s*/, ""))
    .filter(Boolean);
  if (!lines.length) return "";

  const divisionHeadingPattern = /^(construction|electrical|plumbing|hvac|glendale|service|production|multi[-\s]?trade)$/i;
  return lines
    .map((line) => (divisionHeadingPattern.test(line) ? line : `- ${line}`))
    .join("\n");
}

function stripDivisionHeadingFromScope(scopeText = "", divisionId = "") {
  const label = cleanString(capitalize(divisionId));
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(`^(?:\\d+\\.\\s*)?${escapedLabel}\\s*$`, "i");
  const lines = normalizeScopeFormattingForUi(scopeText)
    .split(/\r?\n/)
    .map((line) => cleanString(line))
    .filter(Boolean);

  while (lines.length && headingPattern.test(lines[0])) {
    lines.shift();
  }
  return lines.join("\n");
}

function splitScopeLinesPreservingInputRows(scopeText = "") {
  const rawLines = normalizeScopeNumbering(scopeText)
    .split(/\r?\n/)
    .map((line) => repairScopeLineText(line))
    .filter(Boolean);
  if (!rawLines.length) return [];

  const mergedRows = [];
  rawLines.forEach((line) => {
    const isStructuredRow = /^(?:\d+(?:\.\d+)*\.?\s+|[-*•▪◦·]\s+)/.test(line);
    if (!mergedRows.length || isStructuredRow) {
      mergedRows.push(line);
      return;
    }
    mergedRows[mergedRows.length - 1] = `${mergedRows[mergedRows.length - 1]} ${line}`.replace(/\s+/g, " ").trim();
  });

  const cleanedRows = mergedRows
    .map((line) => stripScopeLinePrefix(line))
    .map((line) => repairScopeLineText(line))
    .filter(Boolean);
  if (cleanedRows.length > 1) {
    return mergeContinuationScopeLines(cleanedRows);
  }

  return mergeContinuationScopeLines(
    normalizeScopeFormattingForUi(scopeText)
      .split(/\r?\n+/)
      .map((line) => repairScopeLineText(line))
      .filter(Boolean)
  );
}

function buildScopeLineItemsForWorksheet(scopeText = "") {
  const lines = splitScopeLinesPreservingInputRows(scopeText);
  const occurrenceByLine = new Map();
  return lines.map((line, index) => {
    const normalizedText = cleanString(line).replace(/\s+/g, " ");
    const occurrence = (occurrenceByLine.get(normalizedText.toLowerCase()) || 0) + 1;
    occurrenceByLine.set(normalizedText.toLowerCase(), occurrence);
    return {
      scopeLineKey: createScopeLineKey(normalizedText, occurrence),
      lineNumber: String(index + 1),
      sourceText: normalizedText,
      normalizedText
    };
  });
}

function normalizeWorksheetMaterialSuggestion(suggestion = {}, row = {}) {
  const description = cleanString(suggestion?.description || row?.sourceText || row?.normalizedText || "Material allowance");
  if (!description) return null;
  const rowContext = cleanString(row?.sourceText || row?.normalizedText);
  const quantity = Math.max(0, parseNumber(suggestion?.quantity, 0));
  const cost = Math.max(0, parseNumber(suggestion?.cost, 0));
  const explicitUnitCost = Math.max(0, parseNumber(suggestion?.unitCost, 0));
  const markup = Math.max(0, parseNumber(suggestion?.markup, 50));
  const resolvedQuantity = quantity > 0 ? quantity : cost > 0 || explicitUnitCost > 0 ? 1 : 0;
  const unitCost = explicitUnitCost > 0 ? explicitUnitCost : resolvedQuantity > 0 && cost > 0 ? cost / resolvedQuantity : 0;
  const sellingPrice =
    Math.max(0, parseNumber(suggestion?.sellingPrice, 0)) ||
    (cost > 0 ? cost * (1 + markup / 100) : unitCost > 0 && resolvedQuantity > 0 ? unitCost * resolvedQuantity * (1 + markup / 100) : 0);
  return {
    description,
    quantity: resolvedQuantity,
    uom: resolveSuggestedUom(suggestion?.uom, `${description} ${rowContext}`, "EACH"),
    unitCost,
    cost: cost > 0 ? cost : resolvedQuantity > 0 && unitCost > 0 ? unitCost * resolvedQuantity : 0,
    markup,
    sellingPrice,
    assumptions: Array.isArray(suggestion?.assumptions)
      ? suggestion.assumptions.map((item) => cleanString(item)).filter(Boolean)
      : [],
    riskFlags: Array.isArray(suggestion?.riskFlags)
      ? suggestion.riskFlags.map((item) => cleanString(item)).filter(Boolean)
      : [],
    confidence: Math.max(0.05, Math.min(0.99, parseNumber(suggestion?.confidence, 0.6)))
  };
}

function normalizeEstimateWorksheetRow(row = {}, division = {}) {
  const sourceText = cleanString(row?.sourceText || row?.normalizedText);
  if (!sourceText) return null;
  const normalizedText = cleanString(row?.normalizedText || sourceText).replace(/\s+/g, " ");
  let generalLabourHours = Math.max(0, parseNumber(row?.generalLabourHours, 0));
  const supervisionRatio = getDivisionWorksheetSupervisionRatio(division?.id);
  const rawSupervisionHours = parseNumber(row?.supervisionHours, Number.NaN);
  const rawProjectManagerHours = parseNumber(row?.projectManagerHours, Number.NaN);
  const isSupervisionOnlyScope =
    /(project manager|project coordinator|site supervisor|coordination|scheduling|quality standards|safety protocols|oversight)/i.test(
      sourceText
    );
  const isProjectManagerScope = /(project manager|project coordinator|coordination|scheduling|submittal|closeout)/i.test(sourceText);
  let supervisionHours =
    Number.isFinite(rawSupervisionHours) && rawSupervisionHours > 0
      ? rawSupervisionHours
      : Math.round(generalLabourHours * supervisionRatio * 100) / 100;
  let projectManagerHours =
    Number.isFinite(rawProjectManagerHours) && rawProjectManagerHours > 0 ? rawProjectManagerHours : 0;
  if (isProjectManagerScope && supervisionHours > 0 && projectManagerHours <= 0) {
    projectManagerHours = supervisionHours;
    supervisionHours = 0;
  }
  if (isSupervisionOnlyScope && generalLabourHours > 0 && (!Number.isFinite(rawSupervisionHours) || rawSupervisionHours <= 0)) {
    if (isProjectManagerScope && projectManagerHours <= 0) {
      projectManagerHours = generalLabourHours;
      supervisionHours = 0;
    } else {
      supervisionHours = generalLabourHours;
    }
    generalLabourHours = 0;
  }
  const materialAllowanceCost = Math.max(0, parseNumber(row?.materialAllowanceCost, 0));
  const subtradeAllowanceCost = Math.max(0, parseNumber(row?.subtradeAllowanceCost, 0));
  const materialSuggestions = Array.isArray(row?.materialSuggestions)
    ? row.materialSuggestions.map((item) => normalizeWorksheetMaterialSuggestion(item, row)).filter(Boolean)
    : [];
  const suggestionAllowance = materialSuggestions.reduce((sum, item) => sum + Math.max(0, parseNumber(item?.cost, 0)), 0);
  const confidence = Math.max(0.05, Math.min(0.99, parseNumber(row?.confidence, 0.5)));
  const missingInputs = Array.isArray(row?.missingInputs)
    ? row.missingInputs.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const assumptions = Array.isArray(row?.assumptions)
    ? row.assumptions.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const riskFlags = Array.isArray(row?.riskFlags)
    ? row.riskFlags.map((item) => cleanString(item)).filter(Boolean)
    : [];
  return {
    scopeLineKey: cleanString(row?.scopeLineKey || createScopeLineKey(normalizedText, 1)),
    lineNumber: cleanString(row?.lineNumber || ""),
    sourceText,
    normalizedText,
    generalLabourHours,
    supervisionHours,
    projectManagerHours,
    materialAllowanceCost: materialAllowanceCost > 0 ? materialAllowanceCost : suggestionAllowance,
    subtradeAllowanceCost,
    materialSuggestions,
    confidence,
    assumptions,
    missingInputs,
    riskFlags,
    needsReview: Boolean(row?.needsReview) || confidence < 0.6 || missingInputs.length > 0,
    locked: Boolean(row?.locked),
    origin: cleanString(row?.origin).toLowerCase() === "manual" ? "manual" : "ai"
  };
}

function formatWorksheetConfidence(value = 0) {
  return `${Math.round(Math.max(0, Math.min(1, parseNumber(value, 0))) * 100)}%`;
}

function joinWithAnd(items = []) {
  const values = items.map((item) => cleanString(item)).filter(Boolean);
  if (!values.length) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function summarizeScopeToOneLine(raw, fallback = "") {
  const rawText = String(raw || "");
  const simpleRaw = cleanString(rawText);
  if (simpleRaw && !/[\r\n]/.test(rawText) && simpleRaw.length <= 110) {
    const compact = cleanString(simpleRaw).replace(/\s+/g, " ").replace(/[,:;.\-]+$/g, "");
    if (compact) return toTitleCase(compact);
  }

  const scopeLines = rawText
    .split(/\r?\n/)
    .map((line) =>
      cleanString(line)
        .replace(/^[*•▪◦·]\s*/, "- ")
        .replace(/\s+/g, " ")
    )
    .filter(Boolean);

  const headingPattern = /^[A-Z0-9][A-Z0-9 &/().,#:'"-]{2,}$/;
  const headings = [];
  for (const line of scopeLines) {
    const normalized = cleanString(line).replace(/^\d+\s*[\.\)\-:]\s*/, "");
    if (/^(-\s+|\d+[.)]\s+)/.test(normalized)) continue;
    if (!headingPattern.test(normalized)) continue;
    if (/^(optional items|scope of work|statement of work)\b/i.test(normalized)) continue;
    headings.push(toHeadlineCase(normalized));
  }
  const headingSummary = Array.from(new Set(headings)).slice(0, 4);

  const firstBullet = scopeLines.find((line) => /^(-\s+|\d+[.)]\s+)/.test(line));
  let actionSummary = cleanString(firstBullet ? firstBullet.replace(/^(-\s+|\d+[.)]\s+)/, "") : "");
  actionSummary = actionSummary
    .replace(/^supply\s+and\s+install\s+/i, "Install ")
    .replace(/^furnish\s+and\s+install\s+/i, "Install ")
    .replace(/^supply\s+labou?r\s+and\s+material\s+to\s+/i, "")
    .replace(/[,:;.\-]+$/g, "")
    .trim();
  actionSummary = truncateWithEllipsis(limitWords(actionSummary, 9), 62);

  let summaryText = "";
  if (headingSummary.length) {
    summaryText = `Work includes ${joinWithAnd(headingSummary)}`;
    if (actionSummary) {
      summaryText += `, including ${actionSummary.toLowerCase()}`;
    }
  } else if (actionSummary) {
    summaryText = `Work includes ${actionSummary}`;
  } else {
    summaryText = stripDescriptionNoise(rawText).split(/(?<=[.!?;:])\s+/)[0];
  }

  if (!cleanString(summaryText)) {
    summaryText = stripDescriptionNoise(fallback);
  }
  if (!cleanString(summaryText)) {
    summaryText = "Project scope overview";
  }

  const compactSummary = cleanString(summaryText).replace(/[,:;.\-]+$/g, "");
  const maxWords = limitWords(compactSummary, 16);
  return toTitleCase(truncateWithEllipsis(maxWords, 110));
}

function sanitizeBriefDescription(raw, fallback = "") {
  return summarizeScopeToOneLine(raw, fallback);
}

function buildLocalQuoteDescription(scopeText = "") {
  return sanitizeBriefDescription(scopeText, `${capitalize(state.quoteType)} scope`);
}

function setQuoteDescription(value) {
  const normalized = sanitizeBriefDescription(value, `${capitalize(state.quoteType)} scope`);
  state.quoteDescription = normalized;
  if (el.quoteDescription) {
    el.quoteDescription.value = normalized;
    syncQuoteBodyTextareaSize();
  }
}

function ensureQuoteDescriptionFromScope({ force = false } = {}) {
  const current = cleanString(el.quoteDescription?.value || state.quoteDescription);
  if (!force && current) {
    state.quoteDescription = current;
    return current;
  }
  const scopeText = ensureQuoteBodyText();
  if (!scopeText) return current;
  const fallback = buildLocalQuoteDescription(scopeText);
  setQuoteDescription(fallback);
  return fallback;
}

function buildDescriptionAiPayload(scopeText) {
  const selectedDivisions = getSelectedDivisionSections();
  return {
    quoteType: state.quoteType,
    quoteBody: cleanString(scopeText),
    quoteDescription: cleanString(el.quoteDescription?.value || state.quoteDescription),
    account: {
      name: cleanString(getSelectedAccount()?.name)
    },
    divisions: selectedDivisions.map((division) => ({
      id: division.id,
      sectionId: cleanString(division.sectionId),
      title: getDivisionDisplayTitle(division),
      scope: cleanString(division.scope),
      isSelected: true
    }))
  };
}

async function suggestQuoteDescriptionFromScope({ silent = false, force = true, requireAi = false } = {}) {
  const scopeText = ensureQuoteBodyText();
  if (!scopeText) {
    if (!silent) {
      showStatus("Add scope details first so AI can suggest a description.", "error");
    }
    return "";
  }

  const current = cleanString(el.quoteDescription?.value || state.quoteDescription);
  if (!force && current) {
    state.quoteDescription = current;
    return current;
  }

  const fallback = buildLocalQuoteDescription(scopeText);
  if (el.aiDescriptionBtn) setBusy(el.aiDescriptionBtn, true);
  if (!silent) {
    showStatus("Generating project description from scope...");
  }

  try {
    const result = await apiFetch("/api/ai/quote-description", {
      method: "POST",
      body: buildDescriptionAiPayload(scopeText)
    });
    if (requireAi && !result?.generatedByAI) {
      throw new Error("AI description generation is unavailable right now. Please retry.");
    }
    const description = cleanString(result?.description || fallback);
    setQuoteDescription(description || fallback);
    if (!silent) {
      showStatus("Description generated. You can edit it before creating the quote.", "success");
    }
    return cleanString(el.quoteDescription?.value || state.quoteDescription);
  } catch (error) {
    if (requireAi) {
      if (!silent) {
        showStatus(error.message, "error");
      }
      throw error;
    }
    setQuoteDescription(fallback);
    if (!silent) {
      showStatus(`AI description fallback applied: ${error.message}`, "success");
    }
    return fallback;
  } finally {
    if (el.aiDescriptionBtn) setBusy(el.aiDescriptionBtn, false);
  }
}

function inferTaskPlanSuggestionType(rawText = "") {
  const text = cleanString(rawText).toLowerCase();
  if (!text) return "material";
  if (
    /(subtrade|sub[-\s]?contract|consultant|architect|engineering|permit|inspection|testing|commission)/.test(
      text
    )
  ) {
    return "subtrade";
  }
  if (/(material|supply|asphalt|concrete|aggregate|pipe|wire|fixture|equipment|paint|sealant|fitting|grout|insulation)/.test(text)) {
    return "material";
  }
  if (/(labou?r|supervis|foreman|crew|demolish|remove|install|prepare|grade|compact|repair|paint|clean)/.test(text)) {
    return "labour";
  }
  return "material";
}

function cleanTaskPlanScopeFragment(value = "") {
  return cleanString(value)
    .replace(/^(including|consisting of|with|and)\s+/i, "")
    .replace(/[;.,:\-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTaskPlanAreaLabel(text = "") {
  const source = cleanString(text);
  if (!source) return "";
  const mediumMatch = source.match(/\bmedium\s+duty\s+area(?:\s*\([^)]*\))?/i);
  if (mediumMatch?.[0]) return cleanTaskPlanScopeFragment(mediumMatch[0]);
  const heavyMatch = source.match(/\bheavy\s+duty\s+area(?:\s*\([^)]*\))?/i);
  if (heavyMatch?.[0]) return cleanTaskPlanScopeFragment(heavyMatch[0]);
  return "";
}

function appendTaskPlanAreaLabel(fragment = "", areaLabel = "") {
  const text = cleanTaskPlanScopeFragment(fragment);
  const area = cleanTaskPlanScopeFragment(areaLabel);
  if (!text || !area) return text;
  if (new RegExp(area.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text)) {
    return text;
  }
  if (/(base course|surface course|asphalt|compaction|placement|grading|line painting|parking lines?)/i.test(text)) {
    return `${text} (${area})`;
  }
  return text;
}

function splitTaskPlanTailSegments(value = "") {
  const source = cleanTaskPlanScopeFragment(value);
  if (!source) return [];
  const prepared = source
    .replace(/\bplaced and mechanically compacted\b/gi, "placement and mechanical compaction")
    .replace(/\s*,\s*and\s+/gi, ", ");
  const commaParts = prepared
    .split(/,(?!\d)/)
    .map((part) => cleanTaskPlanScopeFragment(part))
    .filter(Boolean);
  const splitSafe = (part = "") => {
    if (!/\s+\band\b\s+/i.test(part)) return [part];
    if (/\b(supply and install|furnish and install)\b/i.test(part)) return [part];
    if (/\bplacement and mechanical compaction\b/i.test(part)) return [part];
    return part
      .split(/\s+\band\b\s+/i)
      .map((item) => cleanTaskPlanScopeFragment(item))
      .filter(Boolean);
  };
  return commaParts.flatMap((part) => splitSafe(part));
}

function buildDetailedTaskPlanFragments(scopeText = "", taskName = "") {
  const source = cleanTaskPlanScopeFragment(scopeText || taskName);
  if (!source) return [];
  const fragments = [];
  const pushUnique = (value) => {
    const clean = cleanTaskPlanScopeFragment(value);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (fragments.some((item) => item.toLowerCase() === key)) return;
    fragments.push(clean);
  };

  const normalized = source.replace(/\s+/g, " ");
  const areaLabel = extractTaskPlanAreaLabel(normalized);
  const hasActionVerb = (value = "") =>
    /\b(remove|supply|install|provide|demolish|paint|repair|replace|prepare|grade|clean|test|commission|haul|load|dispose|sawcut)\b/i.test(
      cleanString(value)
    );
  let head = normalized;
  let tail = "";
  let combinedIncludingLine = "";
  const consistingMatch = normalized.match(/^(.*?)(?:,\s*)?consisting of\s+(.+)$/i);
  if (consistingMatch) {
    head = cleanTaskPlanScopeFragment(consistingMatch[1]);
    tail = cleanTaskPlanScopeFragment(consistingMatch[2]);
  } else {
    const includingMatch = normalized.match(/^(.*?)(?:,\s*)?including\s+(.+)$/i);
    if (includingMatch) {
      head = cleanTaskPlanScopeFragment(includingMatch[1]);
      tail = cleanTaskPlanScopeFragment(includingMatch[2]);
      const tailSegments = splitTaskPlanTailSegments(tail);
      if (head && tailSegments.length === 1 && !hasActionVerb(tailSegments[0])) {
        combinedIncludingLine = `${head} (${tailSegments[0]})`;
        tail = "";
      }
    }
  }

  if (combinedIncludingLine) {
    pushUnique(combinedIncludingLine);
  } else {
    pushUnique(head || normalized);
  }
  splitTaskPlanTailSegments(tail).forEach((segment) => {
    pushUnique(appendTaskPlanAreaLabel(segment, areaLabel));
  });

  if (/mechanically compacted|mechanical compaction/i.test(normalized)) {
    pushUnique(appendTaskPlanAreaLabel("Placement and mechanical compaction", areaLabel));
  }
  if (/surface grading/i.test(normalized)) {
    pushUnique(appendTaskPlanAreaLabel("Final surface grading", areaLabel));
  }
  if (/repaint|repainting|painting/i.test(normalized) && /parking lines?/i.test(normalized)) {
    pushUnique("Repaint parking lines");
  }

  return fragments;
}

function normalizeTaskPlanLineSuggestion(lineSuggestion = {}, task = {}) {
  const taskText = `${cleanString(task.taskName)} ${cleanString(task.scopeNote)}`;
  const typeRaw = cleanString(lineSuggestion?.type).toLowerCase();
  const inferredType = inferTaskPlanSuggestionType(
    `${cleanString(lineSuggestion?.description)} ${taskText}`
  );
  const type = ["labour", "material", "subtrade"].includes(typeRaw) ? typeRaw : inferredType;
  const description = cleanString(
    lineSuggestion?.description || task.scopeNote || task.taskName || "Scope line item"
  );
  if (!description) return null;
  const fallbackUom = type === "labour" ? "HOUR" : "EACH";
  let uom = resolveSuggestedUom(
    lineSuggestion?.uom,
    `${description} ${taskText}`,
    fallbackUom
  );
  const providedQuantityRaw = cleanString(lineSuggestion?.quantity);
  const providedQuantity = parseNumber(providedQuantityRaw, Number.NaN);
  const hasProvidedQuantity = providedQuantityRaw !== "" && Number.isFinite(providedQuantity);
  let quantity = hasProvidedQuantity ? Math.max(0, providedQuantity) : 0;
  const rawQuantityStatus = cleanString(lineSuggestion?.quantityStatus).toLowerCase();
  let quantityStatus = TASK_PLAN_QUANTITY_STATUSES.has(rawQuantityStatus)
    ? rawQuantityStatus
    : hasProvidedQuantity
      ? "provided"
      : "missing";
  const measuredQuantity = extractMeasuredQuantityFromText(`${description} ${taskText}`);
  if (measuredQuantity) {
    if (!cleanString(lineSuggestion?.uom) || uom === "EACH") {
      uom = measuredQuantity.uom;
    }
    const isSameMeasurement = uom === measuredQuantity.uom;
    if (type !== "labour" && isSameMeasurement && (!hasProvidedQuantity || quantity <= 0)) {
      quantity = measuredQuantity.quantity;
      quantityStatus = "extracted";
    } else if (type === "labour" && quantity <= 0 && measuredQuantity.uom === "HOUR" && !hasProvidedQuantity) {
      quantity = measuredQuantity.quantity;
      quantityStatus = "extracted";
    }
  }
  if (/\ballowance|assumed|tbd|to be confirmed\b/i.test(description) && quantityStatus === "missing") {
    quantityStatus = "assumed";
  }
  if (type !== "labour" && quantity <= 0 && quantityStatus === "provided") {
    quantityStatus = "missing";
  }
  return {
    type,
    description,
    quantity,
    quantityStatus,
    uom,
    unitCost: Math.max(0, parseNumber(lineSuggestion?.unitCost, 0)),
    cost: Math.max(0, parseNumber(lineSuggestion?.cost, 0)),
    markup: 50,
    sellingPrice: Math.max(0, parseNumber(lineSuggestion?.sellingPrice, 0)),
    requiredInputs: Array.isArray(lineSuggestion?.requiredInputs)
      ? lineSuggestion.requiredInputs.map((item) => cleanString(item)).filter(Boolean)
      : [],
    assumptions: Array.isArray(lineSuggestion?.assumptions)
      ? lineSuggestion.assumptions.map((item) => cleanString(item)).filter(Boolean)
      : [],
    riskFlags: Array.isArray(lineSuggestion?.riskFlags)
      ? lineSuggestion.riskFlags.map((item) => cleanString(item)).filter(Boolean)
      : [],
    taskName: cleanString(task.taskName)
  };
}

function buildTaskPlanDetailSuggestions(task = {}) {
  return buildDetailedTaskPlanFragments(cleanString(task?.scopeNote), cleanString(task?.taskName))
    .map((fragment) =>
      normalizeTaskPlanLineSuggestion(
        {
          type: inferTaskPlanSuggestionType(fragment),
          description: fragment,
          quantity: inferTaskPlanSuggestionType(fragment) === "labour" ? 0 : 0,
          quantityStatus: inferTaskPlanSuggestionType(fragment) === "labour" ? "provided" : "missing",
          cost: 0,
          markup: 0,
          sellingPrice: 0
        },
        task
      )
    )
    .filter(Boolean);
}

const WORKSHEET_SUGGESTION_STOP_WORDS = new Set([
  "and",
  "for",
  "with",
  "the",
  "all",
  "within",
  "including",
  "required",
  "completion",
  "works",
  "area",
  "course",
  "final",
  "ensure"
]);

function normalizeWorksheetSuggestionKey(description = "") {
  const source = cleanString(description)
    .toLowerCase()
    .replace(/^\d+(?:\.\d+)*\s*/, "")
    .replace(
      /^(?:supply\s+and\s+install|furnish\s+and\s+install|provide\s+and\s+install|provide|install|remove\s+and\s+dispose\s+of|remove|repainting\s+of|repaint)\s+/,
      ""
    )
    .replace(/\bas required\b/g, " ")
    .replace(/\bfollowing completion of [^,.;]+/g, " ")
    .replace(/\bto ensure [^,.;]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ");

  const tokens = source
    .split(/\s+/)
    .map((token) => normalizeScopeMatchToken(token))
    .filter((token) => token.length >= 3 && !WORKSHEET_SUGGESTION_STOP_WORDS.has(token));
  return tokens.join(" ");
}

function getWorksheetSuggestionScore(lineSuggestion = {}) {
  const quantity = Math.max(0, parseNumber(lineSuggestion.quantity, 0));
  const quantityStatus = cleanString(lineSuggestion.quantityStatus).toLowerCase();
  const uom = cleanString(lineSuggestion.uom).toUpperCase();
  const description = cleanString(lineSuggestion.description);
  const wordCount = description.split(/\s+/).filter(Boolean).length;
  let score = 0;
  if (quantity > 0) score += 100;
  if (quantityStatus === "provided" || quantityStatus === "extracted") score += 30;
  if (quantityStatus === "assumed") score += 10;
  if (uom && uom !== "EACH") score += 8;
  if (/(hl8|hl3|base course|surface course|parking lines?|line paint|gravel|asphalt)/i.test(description)) {
    score += 18;
  }
  if (/^(supply and install|furnish and install|provide and install)\b/i.test(description)) {
    score -= 12;
  }
  score += Math.max(0, 24 - wordCount);
  return score;
}

function isWorksheetLowValueFragment(lineSuggestion = {}) {
  const description = cleanString(lineSuggestion.description);
  if (!description) return true;
  const quantity = Math.max(0, parseNumber(lineSuggestion.quantity, 0));
  const quantityStatus = cleanString(lineSuggestion.quantityStatus).toLowerCase();
  const wordCount = description.split(/\s+/).filter(Boolean).length;
  if (quantity > 0 || quantityStatus === "assumed") return false;
  if (wordCount <= 2) return true;
  return /^(loading|hauling|support|placement|grading|fine leveling|sawcutting as required|legal disposal of all debris off site)$/i.test(
    description
  );
}

function sanitizeWorksheetTaskPlanSuggestions(lineSuggestions = []) {
  const grouped = new Map();

  toArray(lineSuggestions).forEach((lineSuggestion, index) => {
    if (!lineSuggestion || !cleanString(lineSuggestion.description)) return;
    const type = cleanString(lineSuggestion.type).toLowerCase() || "material";
    const key = normalizeWorksheetSuggestionKey(lineSuggestion.description) || cleanString(lineSuggestion.description).toLowerCase();
    const areaKey = normalizeWorksheetSuggestionKey(extractTaskPlanAreaLabel(lineSuggestion.description));
    const groupKey = `${type}|${key}|${areaKey}`;
    const candidate = {
      ...lineSuggestion,
      __score: getWorksheetSuggestionScore(lineSuggestion),
      __index: index
    };
    const existing = grouped.get(groupKey);
    if (!existing || candidate.__score > existing.__score || (candidate.__score === existing.__score && candidate.__index < existing.__index)) {
      grouped.set(groupKey, candidate);
    }
  });

  const deduped = Array.from(grouped.values());
  const courseAreaKeys = new Set(
    deduped
      .filter((line) => /(hl8|hl3|base course|surface course)/i.test(cleanString(line.description)))
      .map((line) => normalizeWorksheetSuggestionKey(extractTaskPlanAreaLabel(line.description)))
      .filter(Boolean)
  );

  const filtered = deduped.filter((line) => {
    const description = cleanString(line.description);
    const type = cleanString(line.type).toLowerCase();
    const quantity = Math.max(0, parseNumber(line.quantity, 0));
    const quantityStatus = cleanString(line.quantityStatus).toLowerCase();
    const areaKey = normalizeWorksheetSuggestionKey(extractTaskPlanAreaLabel(description));

    if (isWorksheetLowValueFragment(line)) return false;

    if (
      /\bhot mix asphalt\b/i.test(description) &&
      !/(hl8|hl3|base course|surface course)/i.test(description) &&
      areaKey &&
      courseAreaKeys.has(areaKey)
    ) {
      return false;
    }

    if (
      type !== "labour" &&
      quantity <= 0 &&
      quantityStatus === "missing" &&
      !/\ballowance|assumed|tbd|to be confirmed\b/i.test(description)
    ) {
      return false;
    }

    return true;
  });

  return filtered.sort((a, b) => {
    const typeOrder = { material: 0, subtrade: 1, labour: 2 };
    const typeDiff = (typeOrder[cleanString(a.type).toLowerCase()] ?? 99) - (typeOrder[cleanString(b.type).toLowerCase()] ?? 99);
    if (typeDiff !== 0) return typeDiff;
    return cleanString(a.description).toLowerCase().localeCompare(cleanString(b.description).toLowerCase());
  });
}

function resolveTaskPlanDivision(taskSectionId = "", taskDivisionId = "") {
  const normalizedSectionId = cleanString(taskSectionId);
  if (normalizedSectionId) {
    const exactMatch = getDivisionSection(normalizedSectionId);
    if (exactMatch) return exactMatch;
  }
  const normalizedTaskDivisionId = normalizeDivisionKey(taskDivisionId);
  const selectedDivisions = getSelectedDivisionSections();
  if (!selectedDivisions.length) return null;
  if (selectedDivisions.length === 1) return selectedDivisions[0];
  if (!normalizedTaskDivisionId) return selectedDivisions[0];
  return (
    selectedDivisions.find((division) => normalizeDivisionKey(division.id) === normalizedTaskDivisionId) ||
    selectedDivisions[0]
  );
}

function pickLabourRowForSuggestion(division, suggestionText = "") {
  const rows = getDivisionLabourRows(division);
  if (!rows.length) return null;
  const text = cleanString(suggestionText).toLowerCase();
  if (isGlendaleDivisionId(division.id)) {
    if (/project manager|project coordinator|coordination|scheduling|submittal|closeout|pm\b/.test(text)) {
      return rows.find((row) => cleanString(row.label).toLowerCase().includes("project manager")) || rows[rows.length - 1] || rows[0];
    }
    if (/senior\s*engineer|sr\.?\s*engineer/.test(text)) {
      return rows.find((row) => /senior|sr\.?/.test(cleanString(row.label).toLowerCase())) || rows[3] || rows[0];
    }
    if (/architect/.test(text)) {
      return rows.find((row) => cleanString(row.label).toLowerCase() === "architect") || rows[1] || rows[0];
    }
    if (/engineer/.test(text)) {
      return rows.find((row) => cleanString(row.label).toLowerCase() === "engineer") || rows[2] || rows[0];
    }
    return rows.find((row) => cleanString(row.label).toLowerCase() === "design") || rows[0];
  }
  if (/project manager|project coordinator|coordination|scheduling|submittal|closeout|pm\b/.test(text)) {
    return rows.find((row) => cleanString(row.label).toLowerCase().includes("project manager")) || rows[2] || rows[0];
  }
  if (/supervis|foreman/.test(text)) {
    return rows.find((row) => cleanString(row.label).toLowerCase().includes("supervision")) || rows[1] || rows[0];
  }
  return rows.find((row) => cleanString(row.label).toLowerCase().includes("general")) || rows[0];
}

function appendCostLineFromSuggestion(division, lineSuggestion, kind, stats) {
  const listKey = kind === "material" ? "materialLines" : "subcontractorLines";
  const noCostKey = kind === "material" ? "materialNoCost" : "subcontractorNoCost";
  if (!Array.isArray(division[listKey])) {
    division[listKey] = [];
  }
  const description = cleanString(lineSuggestion.description);
  if (!description) return;
  const duplicate = hasCostLineDescriptionDuplicate(division[listKey], description);
  if (duplicate) {
    stats.skippedDuplicates += 1;
    return;
  }

  const defaults = getDivisionLineDefaults(division, kind);
  const quantity = parseNumber(lineSuggestion.quantity, 1);
  const cost = parseNumber(lineSuggestion.cost, 0);
  const explicitUnitCost = Math.max(0, parseNumber(lineSuggestion.unitCost, 0));
  const suggestedUom = resolveSuggestedUom(
    lineSuggestion.uom,
    `${description} ${cleanString(lineSuggestion.taskName)}`,
    defaults.uom || "EACH"
  );
  const line = defaultCostLine(kind, defaults);
  const quantityStatus = cleanString(lineSuggestion.quantityStatus).toLowerCase();
  line.description = description;
  line.quantity = quantity > 0 ? formatNumberForInput(quantity) : "";
  line.uom = suggestedUom;
  const hasQuantity = quantity > 0;
  const markupPercent = parseNumber(line.markup, 50);
  const suggestedSell = Math.max(0, parseNumber(lineSuggestion.sellingPrice, 0));
  const looksLikeUnitRate =
    hasQuantity &&
    quantity > 1 &&
    cost > 0 &&
    suggestedSell > 0 &&
    Math.abs(suggestedSell - cost * (1 + markupPercent / 100)) < 0.1;

  let unitCostValue = 0;
  let costTotalValue = 0;
  if (explicitUnitCost > 0) {
    unitCostValue = explicitUnitCost;
    costTotalValue = hasQuantity ? explicitUnitCost * quantity : 0;
  } else if (cost > 0) {
    if (looksLikeUnitRate) {
      unitCostValue = cost;
      costTotalValue = hasQuantity ? cost * quantity : 0;
    } else {
      costTotalValue = cost;
      if (hasQuantity) {
        unitCostValue = cost / quantity;
      }
    }
  }

  line.unitCost = unitCostValue > 0 ? formatNumberForInput(unitCostValue) : "";
  line.cost = costTotalValue > 0 ? formatNumberForInput(costTotalValue) : "";
  line.markup = "50";
  line.sellingPrice = "";
  line.quantityStatus = TASK_PLAN_QUANTITY_STATUSES.has(quantityStatus)
    ? quantityStatus
    : quantity > 0
      ? "provided"
      : "missing";
  line.requiredInputs = Array.isArray(lineSuggestion.requiredInputs)
    ? lineSuggestion.requiredInputs.map((item) => cleanString(item)).filter(Boolean)
    : [];
  line.assumptions = Array.isArray(lineSuggestion.assumptions)
    ? lineSuggestion.assumptions.map((item) => cleanString(item)).filter(Boolean)
    : [];
  line.riskFlags = Array.isArray(lineSuggestion.riskFlags)
    ? lineSuggestion.riskFlags.map((item) => cleanString(item)).filter(Boolean)
    : [];
  if (!line.sellingPrice && line.cost && line.markup) {
    line.sellingPrice = getAutoSellTotal(line.cost, line.markup);
  }
  division[listKey].push(line);
  division[noCostKey] = false;
  if (kind === "material") {
    stats.materialLinesAdded += 1;
  } else {
    stats.subtradeLinesAdded += 1;
  }
}

function buildTaskPlanAiPayload(scopeText = "") {
  const selectedDivisions = getSelectedDivisionSections();
  return {
    quoteType: state.quoteType,
    quoteBody: cleanString(scopeText),
    divisions: selectedDivisions.map((division) => ({
      id: division.id,
      sectionId: cleanString(division.sectionId),
      title: getDivisionDisplayTitle(division),
      scope: cleanString(division.scope),
      isSelected: true,
      scopeLines: buildScopeLineItemsForWorksheet(division.scope),
      templateMapping: {
        taskCd: cleanString(division.templateTaskCd),
        description: cleanString(division.templateDescription),
        taskType: "Cost and Revenue Task",
        costCode: cleanString(division.templateCostCode),
        revenueGroup: cleanString(division.templateRevenueGroup || "R"),
        taxCategory: cleanString(division.templateTaxCategory || "H"),
        estimator: cleanString(division.templateEstimator || ""),
        labourUom: cleanString(division.templateLabourUom || "HOUR"),
        materialUom: cleanString(division.templateMaterialUom || "EACH"),
        subtradeUom: cleanString(division.templateSubtradeUom || "EACH")
      },
      labour: {
        noCost: Boolean(division.labourNoCost),
        technicianHours: cleanString(division.technicianHours),
        technicianRate: cleanString(division.technicianRate),
        technicianSellingPrice: cleanString(division.technicianSellingPrice),
        supervisionHours: cleanString(division.supervisionHours),
        supervisionRate: cleanString(division.supervisionRate),
        supervisionSellingPrice: cleanString(division.supervisionSellingPrice),
        projectManagerHours: cleanString(division.projectManagerHours),
        projectManagerRate: cleanString(division.projectManagerRate),
        projectManagerSellingPrice: cleanString(division.projectManagerSellingPrice)
      },
      materials: {
        noCost: Boolean(division.materialNoCost),
        lines: toArray(division.materialLines).map(buildTaskPlanContextLine)
      },
      subcontractor: {
        noCost: Boolean(division.subcontractorNoCost),
        lines: toArray(division.subcontractorLines).map(buildTaskPlanContextLine)
      }
    }))
  };
}

function applyEstimateWorksheetPlanToDivisions(plan = {}) {
  const groupedRows = new Map();
  const stats = {
    rowsApplied: 0,
    divisionsTouched: new Set(),
    labourHoursAdded: 0,
    materialLinesAdded: 0,
    subtradeLinesAdded: 0,
    needsReviewRows: 0
  };

  toArray(plan?.worksheetRows).forEach((row) => {
    const targetDivision = resolveTaskPlanDivision(row?.sectionId, row?.divisionId);
    if (!targetDivision || isGlendaleDivisionId(targetDivision.id)) return;
    const normalizedRow = normalizeEstimateWorksheetRow(row, targetDivision);
    if (!normalizedRow) return;
    if (!groupedRows.has(targetDivision.sectionId)) {
      groupedRows.set(targetDivision.sectionId, []);
    }
    groupedRows.get(targetDivision.sectionId).push(normalizedRow);
  });

  groupedRows.forEach((rows, sectionId) => {
    const division = getDivisionSection(sectionId);
    if (!division) return;
    ensureDivisionWorksheetDefaults(division);
    const previousGeneratedCount = toArray(division.materialLines).filter(
      (line) => Boolean(line?.autoGenerated) && cleanString(line?.source) === "worksheet"
    ).length;
    const previousGeneratedSubtradeCount = toArray(division.subcontractorLines).filter(
      (line) => Boolean(line?.autoGenerated) && cleanString(line?.source) === "worksheet"
    ).length;
    mergeWorksheetRowsForDivision(division, rows);
    rollupEstimateWorksheetForDivision(division);
    stats.rowsApplied += rows.length;
    stats.divisionsTouched.add(sectionId);
    stats.labourHoursAdded += rows.reduce((sum, row) => sum + Math.max(0, parseNumber(row?.generalLabourHours, 0)), 0);
    stats.needsReviewRows += rows.filter((row) => Boolean(row?.needsReview)).length;
    const currentGeneratedCount = toArray(division.materialLines).filter(
      (line) => Boolean(line?.autoGenerated) && cleanString(line?.source) === "worksheet"
    ).length;
    const currentGeneratedSubtradeCount = toArray(division.subcontractorLines).filter(
      (line) => Boolean(line?.autoGenerated) && cleanString(line?.source) === "worksheet"
    ).length;
    stats.materialLinesAdded += Math.max(0, currentGeneratedCount - previousGeneratedCount);
    stats.subtradeLinesAdded += Math.max(0, currentGeneratedSubtradeCount - previousGeneratedSubtradeCount);
  });

  return {
    rowsApplied: stats.rowsApplied,
    divisionsTouched: stats.divisionsTouched.size,
    labourHoursAdded: stats.labourHoursAdded,
    materialLinesAdded: stats.materialLinesAdded,
    subtradeLinesAdded: stats.subtradeLinesAdded,
    needsReviewRows: stats.needsReviewRows
  };
}

function applyTaskPlanToDivisions(plan = {}) {
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  const stats = {
    tasksApplied: 0,
    divisionsTouched: new Set(),
    labourHoursAdded: 0,
    materialLinesAdded: 0,
    subtradeLinesAdded: 0,
    skippedDuplicates: 0,
    missingQuantityLines: 0
  };

  tasks.forEach((task) => {
    const targetDivision = resolveTaskPlanDivision(task?.sectionId, task?.divisionId);
    if (!targetDivision) return;
    targetDivision.selected = true;
    ensureDivisionTemplateDefaults(targetDivision.sectionId);
    applyDivisionModeRules(targetDivision);
    stats.divisionsTouched.add(targetDivision.sectionId);

    const rawSuggestions = Array.isArray(task?.lineSuggestions) ? task.lineSuggestions : [];
    const aiSuggestions = rawSuggestions
      .map((lineSuggestion) => normalizeTaskPlanLineSuggestion(lineSuggestion, task))
      .filter(Boolean);
    const detailSuggestions = buildTaskPlanDetailSuggestions(task);
    const suggestions = [];
    const seenSuggestionKeys = new Set();
    const primaryScopeKey = cleanString(task?.scopeNote || task?.taskName).toLowerCase();
    const labourSuggestedHoursByField = new Map();
    const pushUniqueSuggestion = (lineSuggestion) => {
      if (!lineSuggestion || !cleanString(lineSuggestion.description)) return;
      const suggestionKey = `${cleanString(lineSuggestion.type).toLowerCase()}|${cleanString(lineSuggestion.description).toLowerCase()}`;
      if (!suggestionKey || seenSuggestionKeys.has(suggestionKey)) return;
      if (detailSuggestions.length > 1 && cleanString(lineSuggestion.description).toLowerCase() === primaryScopeKey) {
        return;
      }
      seenSuggestionKeys.add(suggestionKey);
      suggestions.push(lineSuggestion);
    };

    aiSuggestions.forEach(pushUniqueSuggestion);
    detailSuggestions.forEach(pushUniqueSuggestion);

    if (!suggestions.length) {
      const fallbackSuggestion = normalizeTaskPlanLineSuggestion(
        {
          type: inferTaskPlanSuggestionType(`${cleanString(task?.taskName)} ${cleanString(task?.scopeNote)}`),
          description: cleanString(task?.scopeNote || task?.taskName),
          quantity: 0,
          quantityStatus: "missing",
          cost: 0,
          markup: 0,
          sellingPrice: 0
        },
        task
      );
      if (fallbackSuggestion) suggestions.push(fallbackSuggestion);
    }

    const missingQuantityCountForTask = suggestions.filter((lineSuggestion) => {
      const lineType = cleanString(lineSuggestion?.type).toLowerCase();
      const quantityStatus = cleanString(lineSuggestion?.quantityStatus).toLowerCase();
      const quantity = parseNumber(lineSuggestion?.quantity, 0);
      return (
        lineType !== "labour" &&
        quantity <= 0 &&
        quantityStatus === "missing" &&
        !/\ballowance|assumed|tbd|to be confirmed\b/i.test(cleanString(lineSuggestion?.description))
      );
    }).length;
    if (missingQuantityCountForTask > 0) {
      stats.missingQuantityLines += missingQuantityCountForTask;
    }
    const worksheetSuggestions = sanitizeWorksheetTaskPlanSuggestions(suggestions);

    worksheetSuggestions.forEach((lineSuggestion) => {
      const baseType = cleanString(lineSuggestion.type).toLowerCase();
      const lineType =
        isGlendaleDivisionId(targetDivision.id) && baseType === "material" ? "subtrade" : baseType;

      if (lineType === "labour") {
        const labourRow = pickLabourRowForSuggestion(
          targetDivision,
          `${lineSuggestion.description} ${lineSuggestion.taskName}`
        );
        if (!labourRow) return;
        targetDivision.labourNoCost = false;
        const hoursToAdd = Math.max(0, parseNumber(lineSuggestion.quantity, 0));
        if (hoursToAdd > 0) {
          const currentSuggested = parseNumber(labourSuggestedHoursByField.get(labourRow.hoursField), 0);
          labourSuggestedHoursByField.set(labourRow.hoursField, currentSuggested + hoursToAdd);
        }
        const suggestedRate = Math.max(0, parseNumber(lineSuggestion.cost, 0));
        if (suggestedRate > 0 && parseNumber(targetDivision[labourRow.rateField], 0) <= 0) {
          targetDivision[labourRow.rateField] = formatNumberForInput(suggestedRate);
        }
        const suggestedSellRate = Math.max(0, parseNumber(lineSuggestion.sellingPrice, 0));
        if (suggestedSellRate > 0 && parseNumber(targetDivision[labourRow.sellField], 0) <= 0) {
          targetDivision[labourRow.sellField] = formatNumberForInput(suggestedSellRate);
        }
        return;
      }

      if (lineType === "subtrade") {
        appendCostLineFromSuggestion(targetDivision, lineSuggestion, "subcontractor", stats);
        return;
      }

      if (!isGlendaleDivisionId(targetDivision.id)) {
        appendCostLineFromSuggestion(targetDivision, lineSuggestion, "material", stats);
      }
    });

    getDivisionLabourRows(targetDivision).forEach((row) => {
      const suggestedHours = parseNumber(labourSuggestedHoursByField.get(row.hoursField), 0);
      if (suggestedHours <= 0) return;
      const currentHours = parseNumber(targetDivision[row.hoursField], 0);
      if (currentHours > 0) return;
      targetDivision[row.hoursField] = formatNumberForInput(suggestedHours);
      stats.labourHoursAdded += suggestedHours;
    });

    stats.tasksApplied += 1;
  });

  getDivisionSections().forEach((division) => {
    ensureDivisionLineDefaults(division, "material", { force: false });
    ensureDivisionLineDefaults(division, "subcontractor", { force: false });
  });

  return {
    tasksApplied: stats.tasksApplied,
    divisionsTouched: stats.divisionsTouched.size,
    labourHoursAdded: stats.labourHoursAdded,
    materialLinesAdded: stats.materialLinesAdded,
    subtradeLinesAdded: stats.subtradeLinesAdded,
    skippedDuplicates: stats.skippedDuplicates,
    missingQuantityLines: stats.missingQuantityLines
  };
}

async function handleScopeBuildFromDivisions() {
  const mappingStatus = await ensureScopeMappings({ silent: false });
  if (!mappingStatus.ok) return;

  const selectedDivisions = getSelectedDivisionSections();
  if (!selectedDivisions.length) {
    showStatus("Add at least one trade section before building estimator breakdown.", "error");
    return;
  }

  buildQuoteBodyFromDivisions();
  const scopeText = ensureQuoteBodyText();
  if (!scopeText) {
    showStatus("Add scope details first so AI can build the estimator breakdown.", "error");
    return;
  }

  setBusy(el.scopeBuildBtn, true);
  showStatus("Reading full scope and building estimator breakdown...");
  try {
    const result = await apiFetch("/api/ai/task-plan", {
      method: "POST",
      body: buildTaskPlanAiPayload(scopeText)
    });
    recordUndoSnapshot("Build estimator breakdown from scope");
    if (result?.historicalEstimateSuggestions) {
      setEstimateLibrarySuggestions(result.historicalEstimateSuggestions);
    }
    if (Array.isArray(result?.historicalSectionAnchors)) {
      setHistoricalSectionAnchors(result.historicalSectionAnchors);
    }
    const worksheetStats = applyEstimateWorksheetPlanToDivisions(result);
    const hasWorksheetRows = toArray(result?.worksheetRows).length > 0;
    const legacyPlan = hasWorksheetRows
      ? {
          tasks: toArray(result?.tasks).filter((task) => {
            const targetDivision = resolveTaskPlanDivision(task?.sectionId, task?.divisionId);
            return Boolean(targetDivision && isGlendaleDivisionId(targetDivision.id));
          })
        }
      : result;
    const applyStats = applyTaskPlanToDivisions(legacyPlan);
    renderDivisions();
    buildQuoteBodyFromDivisions();
    ensureQuoteDescriptionFromScope({ force: false });

    const aiModeLabel = result?.generatedByAI ? "AI breakdown complete" : "Fallback breakdown complete";
    const openAiHint = result?.generatedByAI
      ? ""
      : " Set OPENAI_API_KEY on the server to enable full OpenAI extraction.";
    const lintSummary = summarizeScopeLintForSelectedDivisions();
    const noNewBreakdownLines =
      applyStats.materialLinesAdded === 0 &&
      applyStats.subtradeLinesAdded === 0 &&
      applyStats.labourHoursAdded === 0;
    const quantityHint =
      applyStats.missingQuantityLines > 0
        ? ` ${applyStats.missingQuantityLines} line(s) require quantity takeoff before final quote.`
        : "";
    const scopeLintHint =
      lintSummary.blocking > 0
      ? ` ${lintSummary.blocking} scope line(s) still require measurable quantity details.`
        : lintSummary.warnings > 0
          ? ` ${lintSummary.warnings} scope lint warning(s) detected.`
          : "";
    const reviewHint =
      worksheetStats.needsReviewRows > 0
        ? ` ${worksheetStats.needsReviewRows} worksheet row(s) need estimator review.`
        : "";
    const historicalHint =
      parseNumber(result?.anchoredSectionCount, 0) > 0
        ? ` ${parseNumber(result?.anchoredSectionCount, 0)} section(s) were anchored to archived quotes.`
        : parseNumber(result?.historicalRowsApplied, 0) > 0
          ? ` ${parseNumber(result?.historicalRowsApplied, 0)} worksheet row(s) used secondary historical blending.`
          : result?.usedHistoricalLibrary
            ? " Historical matches were reviewed for this breakdown."
            : "";
    if (noNewBreakdownLines && worksheetStats.rowsApplied === 0) {
      showStatus(
        `${aiModeLabel}: breakdown unchanged for this scope input (no new lines to add).${historicalHint}${quantityHint}${scopeLintHint}${openAiHint}`,
        "success"
      );
      return;
    }
    showStatus(
      `${aiModeLabel}: ${worksheetStats.rowsApplied} scope row(s), ${applyStats.materialLinesAdded + worksheetStats.materialLinesAdded} material lines, ${applyStats.subtradeLinesAdded + worksheetStats.subtradeLinesAdded} subtrade lines, ${formatNumberForInput(
        applyStats.labourHoursAdded + worksheetStats.labourHoursAdded
      )} labour hrs suggested across ${Math.max(applyStats.divisionsTouched, worksheetStats.divisionsTouched)} section(s).${historicalHint}${reviewHint}${quantityHint}${scopeLintHint}${openAiHint}`,
      "success"
    );
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(el.scopeBuildBtn, false);
  }
}

function setCustomScopeControlsVisible(visible) {
  const show = Boolean(visible);
  if (el.scopeCustomWrap) {
    el.scopeCustomWrap.classList.toggle("hidden", !show);
  }
  if (el.scopeCustomActions) {
    el.scopeCustomActions.classList.toggle("hidden", !show);
  }
  if (show && el.scopeCustomInstruction) {
    window.requestAnimationFrame(() => {
      el.scopeCustomInstruction.focus();
    });
  }
}

function getScopePolishButtonForMode(mode) {
  if (mode === SCOPE_POLISH_MODES.grammar) return el.scopeGrammarBtn;
  if (mode === SCOPE_POLISH_MODES.custom) return el.scopeCustomRunBtn || el.scopeCustomBtn;
  return el.scopeSuggestBtn;
}

function getScopePolishStatusLabel(mode) {
  if (mode === SCOPE_POLISH_MODES.grammar) return "Fixing grammar on final scope...";
  if (mode === SCOPE_POLISH_MODES.custom) return "Applying custom AI instructions to final scope...";
  return "Improving context and structure for final scope...";
}

async function requestScopePolish({ mode = SCOPE_POLISH_MODES.context, customInstructions = "" } = {}) {
  const normalizedMode = [SCOPE_POLISH_MODES.grammar, SCOPE_POLISH_MODES.context, SCOPE_POLISH_MODES.custom].includes(mode)
    ? mode
    : SCOPE_POLISH_MODES.context;
  const mappingStatus = await ensureScopeMappings({ silent: false });
  if (!mappingStatus.ok) return;

  const sourceText = ensureQuoteBodyText();
  if (!sourceText) {
    showStatus("Add division scopes first so AI can suggest a full scope narrative.", "error");
    return;
  }

  const trimmedCustomInstruction = cleanString(customInstructions);
  if (normalizedMode === SCOPE_POLISH_MODES.custom && !trimmedCustomInstruction) {
    showStatus("Enter a custom instruction before running Custom.", "error");
    return;
  }

  const targetButton = getScopePolishButtonForMode(normalizedMode);
  const statusLabel = getScopePolishStatusLabel(normalizedMode);
  if (el.scopeSuggestionNotes) {
    el.scopeSuggestionNotes.textContent = statusLabel;
  }
  if (targetButton) setBusy(targetButton, true);
  showStatus(statusLabel);
  try {
    const clarifications = buildEstimatorClarificationPayload();
    const result = await apiFetch("/api/ai/quote-polish", {
      method: "POST",
      body: {
        quoteBody: sourceText,
        quoteType: state.quoteType,
        mode: normalizedMode,
        customInstructions: trimmedCustomInstruction,
        clarifications
      }
    });
    recordUndoSnapshot(`AI scope polish (${normalizedMode})`);
    state.scopeSuggestion = toScopeBulletList(cleanString(result?.polishedText || sourceText));
    state.scopeSuggestionNotes = cleanString(
      result?.notes || (result?.generatedByAI ? "AI scope polish completed." : "Scope polish fallback applied.")
    );
    setQuoteBodyText(state.scopeSuggestion);
    ensureQuoteDescriptionFromScope({ force: false });
    renderScopeSuggestion();
    const lintSummary = summarizeScopeLintForSelectedDivisions();
    const lintHint =
      lintSummary.blocking > 0
        ? ` ${lintSummary.blocking} scope line(s) still need measurable quantities.`
        : lintSummary.warnings > 0
          ? ` ${lintSummary.warnings} scope lint warning(s) detected.`
          : "";
    showStatus(`AI scope updated.${lintHint}`, "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    if (targetButton) setBusy(targetButton, false);
  }
}

async function runGrammarThenContextPolish(sourceText, { requireAi = false } = {}) {
  let workingText = cleanString(sourceText);
  const passNotes = [];
  const clarifications = buildEstimatorClarificationPayload();

  const passes = [
    { mode: SCOPE_POLISH_MODES.grammar, label: "Fixing grammar...", noteLabel: "Grammar" },
    { mode: SCOPE_POLISH_MODES.context, label: "Improving context and structure...", noteLabel: "Context" }
  ];

  for (const pass of passes) {
    if (el.scopeSuggestionNotes) {
      el.scopeSuggestionNotes.textContent = pass.label;
    }

    const result = await apiFetch("/api/ai/quote-polish", {
      method: "POST",
      body: {
        quoteBody: workingText,
        quoteType: state.quoteType,
        mode: pass.mode,
        clarifications
      }
    });

    if (requireAi && !result?.generatedByAI) {
      throw new Error(`${pass.noteLabel} AI polish is unavailable right now. Set OPENAI_API_KEY and retry.`);
    }

    const polishedText = toScopeBulletList(cleanString(result?.polishedText || workingText));
    if (polishedText) {
      workingText = polishedText;
    }
    const defaultNote = result?.generatedByAI
      ? `${pass.noteLabel} polish completed by AI.`
      : `${pass.noteLabel} fallback applied.`;
    const resolvedNote = cleanString(result?.notes || defaultNote);
    if (!passNotes.includes(resolvedNote)) {
      passNotes.push(resolvedNote);
    }
  }

  return {
    polishedText: toScopeBulletList(workingText),
    notes: passNotes.filter(Boolean).join(" | ")
  };
}

async function handleScopeSuggest() {
  await requestScopePolish({ mode: SCOPE_POLISH_MODES.context });
}

async function handleScopeGrammarCheck() {
  await requestScopePolish({ mode: SCOPE_POLISH_MODES.grammar });
}

async function handleScopeCustomRun() {
  const customInstruction = cleanString(el.scopeCustomInstruction?.value);
  await requestScopePolish({
    mode: SCOPE_POLISH_MODES.custom,
    customInstructions: customInstruction
  });
}

function handleScopeCustomStart() {
  setCustomScopeControlsVisible(true);
}

function handleScopeCustomCancel() {
  if (el.scopeCustomInstruction) {
    el.scopeCustomInstruction.value = "";
  }
  setCustomScopeControlsVisible(false);
}

async function handleDescriptionSuggest() {
  await suggestQuoteDescriptionFromScope({ silent: false, force: true, requireAi: true });
}

async function handleScopeFinalizeOneClick() {
  const mappingStatus = await ensureScopeMappings({ silent: false });
  if (!mappingStatus.ok) return;

  setBusy(el.scopeFinalizeBtn, true);
  try {
    showStatus("Building scope from selected trade sections...");
    buildQuoteBodyFromDivisions();
    let sourceText = ensureQuoteBodyText();
    if (!sourceText) {
      showStatus("Add division scope details first.", "error");
      return;
    }

    const polishResult = await runGrammarThenContextPolish(sourceText, { requireAi: true });
    const polished = toScopeBulletList(cleanString(polishResult?.polishedText || sourceText));
    const notes = cleanString(polishResult?.notes || "Grammar + context polish completed.");
    recordUndoSnapshot("Review + generate final scope");
    state.scopeSuggestion = polished;
    state.scopeSuggestionNotes = notes || "Final scope generated and applied automatically.";
    renderScopeSuggestion();

    if (polished) {
      const finalScope = toScopeBulletList(polished);
      setQuoteBodyText(finalScope);
      await suggestQuoteDescriptionFromScope({ silent: true, force: true, requireAi: true });
      const lintSummary = summarizeScopeLintForSelectedDivisions();
      const lintHint =
        lintSummary.blocking > 0
          ? ` ${lintSummary.blocking} scope line(s) still need measurable quantities.`
          : lintSummary.warnings > 0
            ? ` ${lintSummary.warnings} scope lint warning(s) detected.`
            : "";
      showStatus(`Final scope and project description generated.${lintHint}`, "success");
      return;
    }

    setQuoteBodyText(sourceText);
    showStatus("Scope built from divisions. AI returned no additional edits.", "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(el.scopeFinalizeBtn, false);
  }
}

async function prepareEstimateForQuoteAction({
  aiRequired = true,
  autoOpenEstimatorQuestions = true,
  showProgressStatus = true,
  showSuccessStatus = true
} = {}) {
  const mappingStatus = await ensureScopeMappings({ silent: false });
  if (!mappingStatus.ok) return { ok: false, warnings: [] };

  const stepThreeValidation = validateStepThreeCostCompletion();
  if (!stepThreeValidation.valid) {
    showStatus(stepThreeValidation.errors[0], "error");
    return { ok: false, warnings: [] };
  }

  const warnings = [];
  try {
    if (el.scopeSuggestionNotes) {
      el.scopeSuggestionNotes.textContent = aiRequired
        ? "Generating final AI-polished scope..."
        : "Preparing final scope and AI validation...";
    }
    if (showProgressStatus) {
      showStatus(
        aiRequired
          ? "Generating final scope and validating estimate..."
          : "Preparing final scope and validating estimate..."
      );
    }

    buildQuoteBodyFromDivisions();
    const sourceText = ensureQuoteBodyText();
    if (!sourceText) {
      showStatus("Add division scope details first.", "error");
      return { ok: false, warnings };
    }

    let polishResult = {
      polishedText: sourceText,
      notes: aiRequired ? "Grammar + context polish completed." : "Final scope prepared for quote creation."
    };
    try {
      polishResult = await runGrammarThenContextPolish(sourceText, { requireAi: aiRequired });
    } catch (error) {
      if (aiRequired) throw error;
      warnings.push(cleanString(error?.message || "AI scope polish did not complete."));
    }

    const polished = toScopeBulletList(cleanString(polishResult?.polishedText || sourceText));
    const notes = cleanString(
      polishResult?.notes || (aiRequired ? "Grammar + context polish completed." : "Final scope prepared for quote creation.")
    );
    recordUndoSnapshot(aiRequired ? "Review, finalize, and validate with AI" : "Prepare estimate for quote creation");
    state.scopeSuggestion = polished;
    state.scopeSuggestionNotes = notes || "Final scope generated and applied automatically.";
    renderScopeSuggestion();

    const finalScope = toScopeBulletList(polished || sourceText);
    setQuoteBodyText(finalScope);

    try {
      await suggestQuoteDescriptionFromScope({ silent: true, force: true, requireAi: aiRequired });
    } catch (error) {
      if (aiRequired) throw error;
      warnings.push(cleanString(error?.message || "AI description generation did not complete."));
      ensureQuoteDescriptionFromScope({ force: true });
    }

    const validationResult = await runAiValidationFlow({
      busyButton: null,
      showProgressStatus: false,
      showSuccessStatus: false,
      autoOpenEstimatorQuestions,
      suppressErrorStatus: !aiRequired
    });
    const lintSummary = summarizeScopeLintForSelectedDivisions();
    const lintHint =
      lintSummary.blocking > 0
        ? ` ${lintSummary.blocking} scope line(s) still need measurable quantities.`
        : lintSummary.warnings > 0
          ? ` ${lintSummary.warnings} scope lint warning(s) detected.`
          : "";

    if (!validationResult.ok) {
      const validationMessage = cleanString(validationResult?.error?.message || "AI validation did not complete.");
      if (aiRequired) {
        showStatus(validationMessage, "error");
        return { ok: false, warnings, validationOk: false, lintHint };
      }
      warnings.push(validationMessage);
    }

    if (showSuccessStatus) {
      showStatus(
        validationResult.ok
          ? `Final scope, project description, and AI validation are ready.${lintHint}`
          : `Final scope and project description are ready.${lintHint}`,
        "success"
      );
    }

    return {
      ok: true,
      warnings,
      validationOk: Boolean(validationResult.ok),
      lintHint
    };
  } catch (error) {
    showStatus(error.message, "error");
    return {
      ok: false,
      error,
      warnings
    };
  }
}

async function handleAiReviewAndFinalizeOneClick() {
  setBusy(el.aiReviewFinalizeBtn, true);
  try {
    await prepareEstimateForQuoteAction({
      aiRequired: true,
      autoOpenEstimatorQuestions: true,
      showProgressStatus: true,
      showSuccessStatus: true
    });
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(el.aiReviewFinalizeBtn, false);
  }
}

function validateStepThreeCostCompletion() {
  const selectedDivisions = getSelectedDivisionSections();
  const errors = [];

  if (!selectedDivisions.length) {
    errors.push("Add at least one trade section before continuing.");
    return {
      valid: false,
      errors
    };
  }

  selectedDivisions.forEach((division) => {
    validateDivisionCostRequirements(division, errors, {
      allowMissingCosts: false
    });
  });

  return {
    valid: errors.length === 0,
    errors
  };
}

function summarizeScopeLintForSelectedDivisions() {
  const selectedDivisions = getSelectedDivisionSections();
  return selectedDivisions.reduce(
    (acc, division) => {
      const lint = buildScopeLintForDivision(division);
      acc.blocking += lint.blocking.length;
      acc.warnings += lint.warnings.length;
      return acc;
    },
    { blocking: 0, warnings: 0 }
  );
}

function handleApplyScopeSuggestion() {
  const suggestion = toScopeBulletList(state.scopeSuggestion);
  if (!suggestion) {
    showStatus("No AI scope suggestion to apply.", "error");
    return;
  }
  recordUndoSnapshot("Apply AI scope suggestion");
  setQuoteBodyText(suggestion);
  ensureQuoteDescriptionFromScope();
  showStatus("Applied AI suggestion to final scope of work.", "success");
}

function normalizeAiValidationSections(sections = {}) {
  const toList = (value) =>
    (Array.isArray(value) ? value : [])
      .map((item) => cleanString(item))
      .filter(Boolean);
  const toDivisionBreakdown = (value) =>
    (Array.isArray(value) ? value : [])
      .map((entry) => ({
        division: cleanString(entry?.division || entry?.name),
        included: toList(entry?.included),
        missingItems: toList(entry?.missingItems || entry?.missing),
        risks: toList(entry?.risks || entry?.riskFlags)
      }))
      .filter((entry) => entry.division || entry.included.length || entry.missingItems.length || entry.risks.length);

  return {
    quickScopeReadback: toList(sections.quickScopeReadback),
    clarifyingQuestions: toList(sections.clarifyingQuestions),
    assumptionsExclusions: toList(sections.assumptionsExclusions),
    divisionBreakdown: toDivisionBreakdown(sections.divisionBreakdown),
    missingScopeRecommendations: toList(sections.missingScopeRecommendations),
    materialSubtradeSuggestions: toList(sections.materialSubtradeSuggestions),
    uomComplianceCheck: toList(sections.uomComplianceCheck)
  };
}

function normalizeEstimatorQuestionKey(question = "") {
  return cleanString(question)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getEstimatorClarificationEntries(questions = state.estimatorClarifyingQuestions) {
  return toArray(questions)
    .map((question) => cleanString(question))
    .filter(Boolean)
    .map((question) => {
      const key = normalizeEstimatorQuestionKey(question);
      return {
        key,
        question,
        answer: cleanString(state.estimatorClarificationAnswers?.[key] || ""),
        answered: Boolean(cleanString(state.estimatorClarificationAnswers?.[key] || ""))
      };
    });
}

function getUnansweredEstimatorClarificationEntries(questions = state.estimatorClarifyingQuestions) {
  return getEstimatorClarificationEntries(questions).filter((entry) => !entry.answered);
}

function getAnsweredEstimatorClarificationEntries(questions = state.estimatorClarifyingQuestions) {
  return getEstimatorClarificationEntries(questions).filter((entry) => entry.answered);
}

function hasUnansweredEstimatorClarifications() {
  return getUnansweredEstimatorClarificationEntries().length > 0;
}

function buildEstimatorClarificationPayload() {
  return getAnsweredEstimatorClarificationEntries().map((entry) => ({
    question: entry.question,
    answer: entry.answer
  }));
}

function getEstimatorClarificationSignature(
  questions = state.estimatorClarifyingQuestions,
  { unansweredOnly = false } = {}
) {
  const entries = unansweredOnly
    ? getUnansweredEstimatorClarificationEntries(questions)
    : getEstimatorClarificationEntries(questions);
  return entries
    .map((entry) => entry.key)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .join("|");
}

function getEstimatorClarificationScopeSignature(divisions = getSelectedDivisionSections()) {
  const rows = toArray(divisions)
    .map((division) => ({
      sectionId: cleanString(division?.sectionId).toLowerCase(),
      divisionId: normalizeDivisionKey(division?.id || division?.title),
      scope: cleanString(division?.scope).replace(/\s+/g, " ").trim()
    }))
    .filter((entry) => entry.sectionId || entry.divisionId || entry.scope)
    .sort((a, b) => {
      const sectionDiff = cleanString(a.sectionId).localeCompare(cleanString(b.sectionId));
      if (sectionDiff !== 0) return sectionDiff;
      const divisionDiff = cleanString(a.divisionId).localeCompare(cleanString(b.divisionId));
      if (divisionDiff !== 0) return divisionDiff;
      return cleanString(a.scope).localeCompare(cleanString(b.scope));
    });
  return rows.length ? JSON.stringify(rows) : "";
}

function isEstimatorClarificationPassCompletedForCurrentScope() {
  const scopeSignature = getEstimatorClarificationScopeSignature();
  return Boolean(scopeSignature) && scopeSignature === estimatorQuestionsCompletionScopeSignature;
}

function markEstimatorClarificationPassCompletedForCurrentScope() {
  estimatorQuestionsCompletionScopeSignature = getEstimatorClarificationScopeSignature();
  estimatorQuestionsAutoOpenSignature = "";
}

function syncEstimatorClarificationsFromValidation(validation = state.aiValidation) {
  const sections = normalizeAiValidationSections(validation?.sections || {});
  const nextQuestions = toArray(sections.clarifyingQuestions);
  if (isEstimatorClarificationPassCompletedForCurrentScope()) {
    const answeredEntries = getAnsweredEstimatorClarificationEntries(state.estimatorClarifyingQuestions);
    const answeredKeys = new Set(answeredEntries.map((entry) => cleanString(entry.key)).filter(Boolean));
    state.estimatorClarifyingQuestions = answeredEntries.map((entry) => entry.question);
    state.estimatorClarificationAnswers = Object.fromEntries(
      Object.entries(state.estimatorClarificationAnswers || {}).filter(
        ([key, answer]) => answeredKeys.has(cleanString(key)) && Boolean(cleanString(answer))
      )
    );
    estimatorQuestionsAutoOpenSignature = "";
    return;
  }
  const validKeys = new Set(nextQuestions.map((question) => normalizeEstimatorQuestionKey(question)).filter(Boolean));
  state.estimatorClarifyingQuestions = nextQuestions;
  state.estimatorClarificationAnswers = Object.fromEntries(
    Object.entries(state.estimatorClarificationAnswers || {}).filter(
      ([key, answer]) => validKeys.has(cleanString(key)) && Boolean(cleanString(answer))
    )
  );
  if (!getEstimatorClarificationSignature(nextQuestions, { unansweredOnly: true })) {
    estimatorQuestionsAutoOpenSignature = "";
  }
}

function renderEstimatorQuestionsModal() {
  if (!el.estimatorQuestionsList || !el.estimatorQuestionsStatus) return;
  const entries = getEstimatorClarificationEntries();
  const unansweredCount = entries.filter((entry) => !entry.answered).length;
  const answeredCount = entries.length - unansweredCount;

  if (!entries.length) {
    el.estimatorQuestionsStatus.textContent = "No estimator questions right now.";
    el.estimatorQuestionsList.innerHTML =
      "<p class=\"hint\">Run AI validation to surface any optional project details that could tighten the final scope.</p>";
    if (el.saveEstimatorQuestionsBtn) el.saveEstimatorQuestionsBtn.disabled = true;
    return;
  }

  el.estimatorQuestionsStatus.textContent = unansweredCount > 0
    ? `${unansweredCount} optional question${unansweredCount === 1 ? "" : "s"} still open. Answer only what you know; AI will keep the rest generic.`
    : `${answeredCount} answer${answeredCount === 1 ? "" : "s"} saved. AI will use them for scope polish and validation.`;
  el.estimatorQuestionsList.innerHTML = entries
    .map(
      (entry, index) => `
        <label class="estimator-question-card">
          <span class="estimator-question-label">
            <strong>Question ${index + 1}</strong>
            <span>${escapeHtml(entry.question)}</span>
          </span>
          <textarea
            rows="3"
            data-estimator-question-key="${escapeAttr(entry.key)}"
            placeholder="Answer if known. Leave blank to keep that part of the final scope generic."
          >${escapeHtml(entry.answer)}</textarea>
        </label>
      `
    )
    .join("");
  if (el.saveEstimatorQuestionsBtn) el.saveEstimatorQuestionsBtn.disabled = false;
}

function openEstimatorQuestionsModal({ focusFirstUnanswered = true } = {}) {
  if (!el.estimatorQuestionsModal) return;
  renderEstimatorQuestionsModal();
  estimatorQuestionsAutoOpenSignature = getEstimatorClarificationSignature(state.estimatorClarifyingQuestions, {
    unansweredOnly: true
  });
  openModal(el.estimatorQuestionsModal);
  window.requestAnimationFrame(() => {
    const target = focusFirstUnanswered
      ? el.estimatorQuestionsList?.querySelector('textarea[data-estimator-question-key]:placeholder-shown')
      : null;
    const fallback = el.estimatorQuestionsList?.querySelector('textarea[data-estimator-question-key]');
    const focusTarget = target || fallback || el.saveEstimatorQuestionsBtn;
    if (focusTarget && typeof focusTarget.focus === "function") {
      focusTarget.focus();
    }
  });
}

function closeEstimatorQuestionsModal() {
  if (!el.estimatorQuestionsModal) return;
  closeModal(el.estimatorQuestionsModal);
}

async function applyEstimatorClarificationsToAi() {
  const clarifications = buildEstimatorClarificationPayload();
  if (!clarifications.length) {
    renderAiValidation();
    return;
  }

  let scopeUpdated = false;
  const sourceText = ensureQuoteBodyText();
  if (sourceText) {
    try {
      const polishResult = await apiFetch("/api/ai/quote-polish", {
        method: "POST",
        body: {
          quoteBody: sourceText,
          quoteType: state.quoteType,
          mode: SCOPE_POLISH_MODES.context,
          clarifications
        }
      });
      const polishedText = toScopeBulletList(cleanString(polishResult?.polishedText || sourceText));
      if (polishedText && polishedText !== cleanString(sourceText)) {
        recordUndoSnapshot("Apply estimator clarification answers");
        state.scopeSuggestion = polishedText;
        state.scopeSuggestionNotes = cleanString(
          polishResult?.notes || `Integrated ${clarifications.length} estimator answer(s) into final scope context.`
        );
        setQuoteBodyText(polishedText);
        ensureQuoteDescriptionFromScope({ force: false });
        renderScopeSuggestion();
        scopeUpdated = true;
      }
    } catch (error) {
      showStatus(`Estimator answers were saved, but scope rebuild failed: ${error.message}`, "error");
    }
  }

  const validationResult = await runAiValidationFlow({
    busyButton: null,
    showProgressStatus: false,
    showSuccessStatus: false
  });
  if (validationResult.ok) {
    showStatus(
      scopeUpdated
        ? "Estimator answers saved. Scope and AI validation were rebuilt."
        : "Estimator answers saved. AI validation was rebuilt with the new answers.",
      "success"
    );
  }
}

function renderListSectionHtml(title, items = []) {
  const rows = (Array.isArray(items) ? items : [])
    .map((item) => cleanString(item))
    .filter(Boolean);
  if (!rows.length) return "";
  return `
    <div class="ai-section">
      <h4>${escapeHtml(title)}</h4>
      <ul>${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderDivisionBreakdownHtml(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  if (!rows.length) return "";
  const body = rows
    .map((entry) => {
      const included = renderListSectionHtml("Included", entry.included || []);
      const missing = renderListSectionHtml("Typical Missing Items", entry.missingItems || []);
      const risks = renderListSectionHtml("Risk Flags", entry.risks || []);
      return `
        <div class="ai-item">
          <h4>${escapeHtml(entry.division || "Division")}</h4>
          ${included || "<p class=\"hint\">No included details returned.</p>"}
          ${missing}
          ${risks}
        </div>
      `;
    })
    .join("");
  return `<div class="ai-section"><h4>Division Breakdown</h4>${body}</div>`;
}

function ensureSuggestionLineSuggestion(suggestion) {
  if (!suggestion) return null;
  const defaultType = parseNumber(suggestion.estimatedHours, 0) > 0 ? "labour" : "material";
  if (!suggestion.lineSuggestion || typeof suggestion.lineSuggestion !== "object") {
    suggestion.lineSuggestion = {
      type: defaultType,
      description: "Suggested line",
      quantity: defaultType === "labour" ? Math.max(0, parseNumber(suggestion.estimatedHours, 0)) : 0,
      quantityStatus: defaultType === "labour" ? "provided" : "missing",
      uom: defaultType === "labour" ? "HOUR" : inferUomFromText(`${suggestion.scopeText} ${suggestion.title}`),
      cost: parseNumber(suggestion.estimatedMaterialCost, 0),
      markup: 50,
      sellingPrice: 0
    };
  }
  return suggestion.lineSuggestion;
}

function updateValidationSuggestionField(index, field, rawValue) {
  const suggestion = state.aiValidation?.suggestions?.[index];
  if (!suggestion) return;
  const value = String(rawValue ?? "");

  if (field === "divisionId" || field === "title" || field === "reason" || field === "scopeText") {
    suggestion[field] = cleanString(value);
    return;
  }

  if (field === "estimatedHours") {
    suggestion.estimatedHours = Math.max(0, parseNumber(value, 0));
    return;
  }
  if (field === "estimatedMaterialCost") {
    suggestion.estimatedMaterialCost = Math.max(0, parseNumber(value, 0));
    return;
  }

  const lineSuggestion = ensureSuggestionLineSuggestion(suggestion);
  if (!lineSuggestion) return;
  if (field === "lineType") {
    lineSuggestion.type = cleanString(value || lineSuggestion.type || "material").toLowerCase();
    if (lineSuggestion.type === "labour" && parseNumber(suggestion.estimatedHours, 0) <= 0) {
      suggestion.estimatedHours = Math.max(1, parseNumber(lineSuggestion.quantity, 1));
    }
    if ((lineSuggestion.type === "material" || lineSuggestion.type === "subtrade") && parseNumber(suggestion.estimatedMaterialCost, 0) <= 0) {
      suggestion.estimatedMaterialCost = Math.max(0, parseNumber(lineSuggestion.cost, 0));
    }
    return;
  }
  if (field === "lineDescription") {
    lineSuggestion.description = cleanString(value);
    return;
  }
  if (field === "lineQuantity") {
    lineSuggestion.quantity = Math.max(0, parseNumber(value, 0));
    lineSuggestion.quantityStatus = parseNumber(lineSuggestion.quantity, 0) > 0 ? "provided" : "missing";
    return;
  }
  if (field === "lineCost") {
    lineSuggestion.cost = Math.max(0, parseNumber(value, 0));
  } else if (field === "lineMarkup") {
    lineSuggestion.markup = parseNumber(value, 0);
  } else if (field === "lineSellingPrice") {
    lineSuggestion.sellingPrice = Math.max(0, parseNumber(value, 0));
    return;
  } else {
    return;
  }

  if (parseNumber(lineSuggestion.sellingPrice, 0) <= 0) {
    lineSuggestion.sellingPrice = Math.max(
      0,
      Math.round(parseNumber(lineSuggestion.cost, 0) * (1 + parseNumber(lineSuggestion.markup, 0) / 100) * 100) / 100
    );
  }
  const lineType = cleanString(lineSuggestion.type).toLowerCase();
  if (lineType === "labour") {
    suggestion.estimatedHours = Math.max(
      parseNumber(suggestion.estimatedHours, 0),
      parseNumber(lineSuggestion.quantity, 1)
    );
  } else if (lineType === "material" || lineType === "subtrade") {
    suggestion.estimatedMaterialCost = Math.max(
      0,
      Math.round(parseNumber(lineSuggestion.cost, 0) * parseNumber(lineSuggestion.quantity, 1) * 100) / 100
    );
  }
}

function handleAiValidationSuggestionChange(event) {
  const target = event.target;
  if (!target || cleanString(target.dataset?.action) !== "edit-validation") return;
  const index = parseNumber(target.dataset.suggestionIndex, -1);
  if (index < 0) return;
  const field = cleanString(target.dataset.field);
  if (!field) return;
  const eventType = cleanString(event.type).toLowerCase();
  if (eventType === "input") {
    recordUndoBeforeEdit(target, "Edit AI validation suggestion");
  }
  if (eventType === "change") {
    if (!undoEditSessionTargets.has(target)) {
      recordUndoSnapshot("Edit AI validation suggestion");
    }
    closeUndoEditSession(target);
  }
  updateValidationSuggestionField(index, field, target.value);
}

function renderAiValidation() {
  if (!state.aiValidation) {
    el.aiValidation.textContent = "No validation results yet.";
    return;
  }

  const sections = normalizeAiValidationSections(state.aiValidation.sections || {});
  const score = parseNumber(state.aiValidation.score, 0);
  const summary = escapeHtml(state.aiValidation.summary || "");
  const allSuggestions = Array.isArray(state.aiValidation.suggestions) ? state.aiValidation.suggestions : [];
  const getGroupKey = (suggestion = {}) => {
    return cleanString(suggestion?.sectionId || suggestion?.divisionId || "general").toLowerCase();
  };
  const getDivisionTitle = (groupKey = "", divisionRows = []) => {
    const section = getDivisionSection(groupKey);
    if (section) return getDivisionDisplayTitle(section);
    const suggestionTitle = cleanString(divisionRows[0]?.item?.sectionTitle);
    if (suggestionTitle) return suggestionTitle;
    const divisionId = cleanString(divisionRows[0]?.item?.divisionId || groupKey).toLowerCase();
    const match = DIVISIONS.find((division) => division.id === divisionId);
    return match?.title || capitalize(divisionId || "General");
  };
  const selectedDivisionIds = getSelectedDivisionSections()
    .map((division) => cleanString(division.sectionId).toLowerCase())
    .filter(Boolean);
  const grouped = new Map();
  allSuggestions.forEach((item, index) => {
    const key = getGroupKey(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ item, index });
  });
  grouped.forEach((_value, key) => {
    if (!selectedDivisionIds.includes(key)) {
      selectedDivisionIds.push(key);
    }
  });

  const compactIntro = [
    cleanString(sections.quickScopeReadback?.[0]),
    cleanString(sections.missingScopeRecommendations?.[0]),
    cleanString(sections.assumptionsExclusions?.[0])
  ]
    .filter(Boolean)
    .slice(0, 2);

  const divisionCards = selectedDivisionIds
    .map((divisionId) => {
      const divisionRows = grouped.get(divisionId) || [];
      const totalHours = divisionRows.reduce((sum, row) => sum + parseNumber(row.item?.estimatedHours, 0), 0);
      const totalMaterial = divisionRows.reduce(
        (sum, row) => sum + parseNumber(row.item?.estimatedMaterialCost, 0),
        0
      );
      const missingTitles = Array.from(
        new Set(
          divisionRows
            .map((row) => cleanString(row.item?.title))
            .filter(Boolean)
        )
      );

      const rowsHtml = divisionRows
        .map(({ item, index }) => {
          const lineSuggestion = ensureSuggestionLineSuggestion(item);
          const lineType = cleanString(lineSuggestion?.type || "material").toLowerCase();
          const suggestedSell =
            parseNumber(lineSuggestion?.sellingPrice, 0) > 0
              ? parseNumber(lineSuggestion?.sellingPrice, 0)
              : Math.round(
                  parseNumber(lineSuggestion?.cost, 0) *
                    (1 + parseNumber(lineSuggestion?.markup, 0) / 100) *
                    100
                ) / 100;
          return `
            <div class="ai-suggestion-row ${item.accepted ? "is-accepted" : ""}">
              <div class="ai-suggestion-main">
                <div class="ai-suggestion-head">
                  <strong>${escapeHtml(item.title || `Suggestion ${index + 1}`)}</strong>
                  <span class="ai-chip">
                    ${escapeHtml(lineType.toUpperCase())}
                  </span>
                </div>
                <p class="hint">${escapeHtml(item.reason || "AI recommendation available.")}</p>
              </div>
              <div class="ai-suggestion-metrics">
                <span>Hrs ${escapeHtml(parseNumber(item.estimatedHours, 0).toFixed(2))}</span>
                <span>Cost $${escapeHtml(parseNumber(item.estimatedMaterialCost, 0).toFixed(2))}</span>
              </div>
              <div class="row wrap">
                <button class="btn" data-action="accept-validation" data-suggestion-index="${index}" ${item.accepted ? "disabled" : ""}>
                  ${item.accepted ? "Accepted" : "Accept"}
                </button>
                <details class="ai-edit-details">
                  <summary>Edit</summary>
                  <div class="ai-item-grid">
                    <label>
                      Line Type
                      <select data-action="edit-validation" data-suggestion-index="${index}" data-field="lineType">
                        <option value="labour" ${lineType === "labour" ? "selected" : ""}>Labour</option>
                        <option value="material" ${lineType === "material" ? "selected" : ""}>Material</option>
                        <option value="subtrade" ${lineType === "subtrade" ? "selected" : ""}>Subtrade</option>
                      </select>
                    </label>
                    <label>
                      Labour Hours
                      <input type="number" min="0" step="0.25" data-action="edit-validation" data-suggestion-index="${index}" data-field="estimatedHours" value="${escapeAttr(
                        parseNumber(item.estimatedHours, 0).toString()
                      )}" />
                    </label>
                    <label>
                      Material/Subtrade Cost
                      <input type="number" min="0" step="0.01" data-action="edit-validation" data-suggestion-index="${index}" data-field="estimatedMaterialCost" value="${escapeAttr(
                        parseNumber(item.estimatedMaterialCost, 0).toFixed(2)
                      )}" />
                    </label>
                    <label>
                      Qty
                      <input type="number" min="0" step="0.01" data-action="edit-validation" data-suggestion-index="${index}" data-field="lineQuantity" value="${escapeAttr(
                        parseNumber(lineSuggestion?.quantity, 0).toString()
                      )}" />
                    </label>
                    <label>
                      Line Cost
                      <input type="number" min="0" step="0.01" data-action="edit-validation" data-suggestion-index="${index}" data-field="lineCost" value="${escapeAttr(
                        parseNumber(lineSuggestion?.cost, 0).toFixed(2)
                      )}" />
                    </label>
                    <label>
                      Markup %
                      <input type="number" step="0.1" data-action="edit-validation" data-suggestion-index="${index}" data-field="lineMarkup" value="${escapeAttr(
                        parseNumber(lineSuggestion?.markup, 0).toString()
                      )}" />
                    </label>
                    <label>
                      Sell
                      <input type="number" min="0" step="0.01" data-action="edit-validation" data-suggestion-index="${index}" data-field="lineSellingPrice" value="${escapeAttr(
                        suggestedSell.toFixed(2)
                      )}" />
                    </label>
                    <label>
                      Scope Suggestion
                      <input data-action="edit-validation" data-suggestion-index="${index}" data-field="scopeText" value="${escapeAttr(
                        item.scopeText || ""
                      )}" />
                    </label>
                  </div>
                </details>
              </div>
            </div>
          `;
        })
        .join("");

      return `
        <div class="ai-item ai-division-card">
          <div class="ai-division-head">
            <h4>${escapeHtml(getDivisionTitle(divisionId, divisionRows))}</h4>
            <span class="ai-chip">${escapeHtml(String(divisionRows.length))} suggestion${divisionRows.length === 1 ? "" : "s"}</span>
          </div>
          <p class="hint">Labour ${escapeHtml(totalHours.toFixed(2))} hrs | Material/Subtrade $${escapeHtml(totalMaterial.toFixed(2))}</p>
          ${
            missingTitles.length
              ? `<p class="hint">Focus: ${escapeHtml(missingTitles.join(" | "))}</p>`
              : "<p class=\"hint\">No missing scope or cost flags.</p>"
          }
          ${rowsHtml || ""}
        </div>
      `;
    })
    .join("");

  const hasSuggestions = allSuggestions.length > 0;
  const unansweredClarificationEntries = getUnansweredEstimatorClarificationEntries(sections.clarifyingQuestions);
  const answeredClarificationEntries = getAnsweredEstimatorClarificationEntries(sections.clarifyingQuestions);
  const clarificationActionLabel = unansweredClarificationEntries.length
    ? `Answer Questions (${unansweredClarificationEntries.length})`
    : answeredClarificationEntries.length
      ? `Review Answers (${answeredClarificationEntries.length})`
      : "";
  const headerActions = hasSuggestions
    ? `<div class="row wrap">
        <button class="btn" data-action="accept-all-validation">Accept All</button>
        ${
          clarificationActionLabel
            ? `<button class="btn" data-action="open-estimator-questions">${escapeHtml(clarificationActionLabel)}</button>`
            : ""
        }
      </div>`
    : clarificationActionLabel
      ? `<div class="row wrap"><button class="btn" data-action="open-estimator-questions">${escapeHtml(clarificationActionLabel)}</button></div>`
      : "";
  const compactNotes = compactIntro.length
    ? `<p class="hint">${escapeHtml(compactIntro.join(" | "))}</p>`
    : "";
  const clarifyingQuestionsHtml = unansweredClarificationEntries.length
    ? renderListSectionHtml("Estimator Questions", unansweredClarificationEntries.map((entry) => entry.question))
    : answeredClarificationEntries.length
      ? `
        <div class="ai-section">
          <h4>Estimator Questions</h4>
          <p class="hint">${escapeHtml(`${answeredClarificationEntries.length} answer${answeredClarificationEntries.length === 1 ? "" : "s"} saved. AI will use them for final scope and validation.`)}</p>
        </div>
      `
      : "";
  const assumptionsHtml = renderListSectionHtml("Assumptions / Exclusions", sections.assumptionsExclusions);

  el.aiValidation.innerHTML = `
    <div class="ai-section ai-summary">
      <h4>AI Validation</h4>
      <p><strong>Score ${score}/100</strong> - ${summary}</p>
      ${compactNotes}
      ${headerActions}
    </div>
    ${clarifyingQuestionsHtml}
    ${assumptionsHtml}
    ${divisionCards || "<p class=\"hint\">No trade sections to validate yet.</p>"}
  `;
}

function acceptValidationSuggestion(index, { silent = false, trackHistory = true } = {}) {
  const suggestion = state.aiValidation?.suggestions?.[index];
  if (!suggestion || suggestion.accepted) return;

  const sectionId = cleanString(suggestion.sectionId);
  const divisionId = cleanString(suggestion.divisionId);
  const target =
    getDivisionSection(sectionId) ||
    getSelectedDivisionSections().find((division) => normalizeDivisionKey(division.id) === normalizeDivisionKey(divisionId)) ||
    getSelectedDivisionSections()[0];
  if (!target) return;
  if (trackHistory) {
    recordUndoSnapshot("Accept AI validation suggestion");
  }

  target.selected = true;
  ensureDivisionTemplateDefaults(target.sectionId);
  if (suggestion.scopeText) {
    target.scope = target.scope ? `${target.scope}\n${suggestion.scopeText}` : suggestion.scopeText;
  }
  const lineSuggestion = ensureSuggestionLineSuggestion(suggestion);
  const lineType = cleanString(lineSuggestion?.type).toLowerCase();
  const estimatedHours = parseNumber(suggestion.estimatedHours, 0);
  const lineHours = lineType === "labour" ? parseNumber(lineSuggestion?.quantity, 0) : 0;
  const hoursToAdd = Math.max(estimatedHours, lineHours);
  if (hoursToAdd > 0) {
    target.labourNoCost = false;
    target.technicianHours = String(parseNumber(target.technicianHours, 0) + hoursToAdd);
  }

  if (lineSuggestion && (lineType === "material" || lineType === "subtrade")) {
    const listKey = lineType === "subtrade" ? "subcontractorLines" : "materialLines";
    const noCostKey = lineType === "subtrade" ? "subcontractorNoCost" : "materialNoCost";
    if (!Array.isArray(target[listKey])) {
      target[listKey] = [];
    }
    const lineDescription = cleanString(lineSuggestion.description || "Suggested line");
    if (hasCostLineDescriptionDuplicate(target[listKey], lineDescription)) {
      suggestion.accepted = true;
      if (!silent) {
        renderDivisions();
        renderAiValidation();
      }
      return;
    }

    const line = {
      description: lineDescription,
      quantity: parseNumber(lineSuggestion.quantity, 0) > 0 ? formatNumberForInput(lineSuggestion.quantity) : "",
      uom: resolveSuggestedUom(
        lineSuggestion.uom,
        lineSuggestion.description || suggestion.scopeText || suggestion.title,
        "EACH"
      ),
      costCode: "",
      cost: parseNumber(lineSuggestion.cost, 0) > 0 ? formatNumberForInput(lineSuggestion.cost) : "",
      markup: "50",
      sellingPrice: "",
      expenseGroup: lineType === "subtrade" ? "S" : "MQ",
      taxCategory: ""
    };
    line.quantityStatus = TASK_PLAN_QUANTITY_STATUSES.has(cleanString(lineSuggestion.quantityStatus).toLowerCase())
      ? cleanString(lineSuggestion.quantityStatus).toLowerCase()
      : parseNumber(lineSuggestion.quantity, 0) > 0
        ? "provided"
        : "missing";
    line.requiredInputs = Array.isArray(lineSuggestion.requiredInputs)
      ? lineSuggestion.requiredInputs.map((item) => cleanString(item)).filter(Boolean)
      : [];
    line.assumptions = Array.isArray(lineSuggestion.assumptions)
      ? lineSuggestion.assumptions.map((item) => cleanString(item)).filter(Boolean)
      : [];
    line.riskFlags = Array.isArray(lineSuggestion.riskFlags)
      ? lineSuggestion.riskFlags.map((item) => cleanString(item)).filter(Boolean)
      : [];
    const suggestedUnitCost = Math.max(0, parseNumber(lineSuggestion.unitCost, 0));
    line.unitCost = suggestedUnitCost > 0 ? String(suggestedUnitCost) : "";

    if (lineType === "subtrade") {
      target[noCostKey] = false;
      target[listKey].push(line);
    } else {
      target[noCostKey] = false;
      target[listKey].push(line);
    }
  } else if (!lineSuggestion && parseNumber(suggestion.estimatedMaterialCost, 0) > 0) {
    if (hasCostLineDescriptionDuplicate(target.materialLines || [], suggestion.title || "AI material allowance")) {
      suggestion.accepted = true;
      if (!silent) {
        renderDivisions();
        renderAiValidation();
      }
      return;
    }
    target.materialNoCost = false;
    target.materialLines.push({
      description: cleanString(suggestion.title || "AI material allowance"),
      quantity: "1",
      quantityStatus: "assumed",
      uom: inferUomFromText(`${suggestion.scopeText} ${suggestion.title}`),
      costCode: "",
      cost: String(parseNumber(suggestion.estimatedMaterialCost, 0)),
      unitCost: "",
      markup: "50",
      sellingPrice: String(Math.round(parseNumber(suggestion.estimatedMaterialCost, 0) * 1.5 * 100) / 100),
      assumptions: ["ASSUMED: Allowance pending measured quantity takeoff."],
      expenseGroup: "MQ",
      taxCategory: ""
    });
  }

  suggestion.accepted = true;
  if (!silent) {
    renderDivisions();
    renderAiValidation();
  }
}

function acceptAllValidationSuggestions() {
  const suggestions = Array.isArray(state.aiValidation?.suggestions) ? state.aiValidation.suggestions : [];
  const pendingSuggestions = suggestions.filter((suggestion) => suggestion && !suggestion.accepted);
  if (!pendingSuggestions.length) return;
  let applied = 0;
  recordUndoSnapshot("Accept all AI validation suggestions");
  suggestions.forEach((suggestion, index) => {
    if (!suggestion?.accepted) {
      acceptValidationSuggestion(index, { silent: true, trackHistory: false });
      applied += 1;
    }
  });
  renderDivisions();
  renderAiValidation();
  if (applied > 0) {
    showStatus(`Applied ${applied} AI suggestion${applied === 1 ? "" : "s"} to the estimate.`, "success");
  }
}

async function handleAiValidate() {
  await runAiValidationFlow({
    busyButton: el.aiValidateBtn,
    showProgressStatus: true,
    showSuccessStatus: true
  });
}

async function runAiValidationFlow({
  busyButton = null,
  showProgressStatus = true,
  showSuccessStatus = true,
  autoOpenEstimatorQuestions = true,
  suppressErrorStatus = false
} = {}) {
  const mappingStatus = await ensureScopeMappings({ silent: false });
  if (!mappingStatus.ok) {
    return { ok: false };
  }

  const { valid, errors, payload } = buildAiValidationPayload();
  if (!valid) {
    if (!suppressErrorStatus) {
      showStatus(errors[0], "error");
    }
    return { ok: false };
  }

  const currentQuoteBody = cleanString(el.quoteBody.value);
  if (!currentQuoteBody) {
    buildQuoteBodyFromDivisions();
  }
  payload.quoteBody = cleanString(el.quoteBody.value);
  payload.clarifications = buildEstimatorClarificationPayload();
  payload.quoteDescription =
    sanitizeBriefDescription(
      cleanString(el.quoteDescription?.value || state.quoteDescription),
      buildLocalQuoteDescription(payload.quoteBody)
    );

  if (el.aiValidation) {
    el.aiValidation.textContent = "Reviewing quote completeness...";
  }
  setBusy(busyButton, true);
  if (showProgressStatus) {
    showStatus(`Running AI estimator validation (${getAiConservativenessLabel(state.aiEstimatorConservativeness)})...`);
  }
  try {
    const aiValidationResult = await apiFetch("/api/ai/quote-validate", {
      method: "POST",
      body: payload
    });
    recordUndoSnapshot("Run AI validation");
    state.aiValidation = aiValidationResult;
    syncEstimatorClarificationsFromValidation(aiValidationResult);
    renderAiValidation();
    renderEstimatorQuestionsModal();
    const unansweredSignature = getEstimatorClarificationSignature(state.estimatorClarifyingQuestions, {
      unansweredOnly: true
    });
    if (
      autoOpenEstimatorQuestions &&
      !isEstimatorClarificationPassCompletedForCurrentScope() &&
      unansweredSignature &&
      unansweredSignature !== estimatorQuestionsAutoOpenSignature
    ) {
      openEstimatorQuestionsModal({ focusFirstUnanswered: true });
    }
    if (showSuccessStatus) {
      showStatus(
        hasUnansweredEstimatorClarifications()
          ? "AI review completed. Optional estimator questions are available if you want AI to tighten the final scope and validation."
          : "AI estimator review completed. Edit suggestions or accept them.",
        "success"
      );
    }
    return { ok: true };
  } catch (error) {
    if (!suppressErrorStatus) {
      showStatus(error.message, "error");
    }
    return { ok: false, error };
  } finally {
    setBusy(busyButton, false);
  }
}

function buildPdfAddressObject(account) {
  if (!account) return null;
  const address = account.address || {};
  const pickAddressValue = (...values) => {
    for (const value of values) {
      const text = cleanString(value);
      if (text) return text;
    }
    return "";
  };
  const line1 = pickAddressValue(
    address.addressLine1,
    address.line1,
    address.address1,
    address.AddressLine1,
    address.Line1,
    address.Address1,
    account.addressLine1,
    account.AddressLine1,
    account.line1,
    account.Line1
  );
  const line2 = pickAddressValue(
    address.addressLine2,
    address.line2,
    address.address2,
    address.AddressLine2,
    address.Line2,
    address.Address2,
    account.addressLine2,
    account.AddressLine2,
    account.line2,
    account.Line2
  );
  const streetSource =
    typeof address.street === "string"
      ? address.street
      : typeof address.Street === "string"
        ? address.Street
      : typeof address.address === "string"
        ? address.address
        : typeof address.Address === "string"
          ? address.Address
      : typeof account.street === "string"
        ? account.street
      : typeof account.Street === "string"
        ? account.Street
        : typeof account.address === "string"
          ? account.address
          : "";
  const parsedStreetParts = cleanString(streetSource)
    .split(/\r?\n|,/)
    .map((item) => cleanString(item))
    .filter(Boolean);
  const seenStreet = new Set();
  const streetParts = [line1, line2, ...parsedStreetParts].filter((line) => {
    const key = cleanString(line).toLowerCase();
    if (!key || seenStreet.has(key)) return false;
    seenStreet.add(key);
    return true;
  });
  return {
    name: pickAddressValue(account.name, account.Name),
    addressLine1: cleanString(streetParts[0] || ""),
    addressLine2: cleanString(streetParts.slice(1).join(", ")),
    city: pickAddressValue(address.city, address.City, account.city, account.City),
    state: pickAddressValue(
      address.state,
      address.province,
      address.State,
      address.Province,
      account.state,
      account.province,
      account.State,
      account.Province
    ),
    postalCode: pickAddressValue(
      address.zip,
      address.postalCode,
      address.PostalCode,
      address.Zip,
      address.ZipCode,
      account.zip,
      account.postalCode,
      account.PostalCode,
      account.Zip,
      account.ZipCode
    ),
    country: pickAddressValue(address.country, address.Country, account.country, account.Country)
  };
}

function extractQuoteNumberCandidate(text) {
  const raw = cleanString(text);
  if (!raw) return "";
  const qHash = raw.match(/\bQ#\s*([A-Za-z0-9_-]+)/i);
  if (qHash?.[1]) return cleanString(qHash[1]);
  const pq = raw.match(/\b(PQ[0-9]{4,})\b/i);
  if (pq?.[1]) return cleanString(pq[1]);
  const labeled = raw.match(/\bquote\s*#?\s*[:\-]?\s*([A-Za-z0-9_-]+)/i);
  if (labeled?.[1]) return cleanString(labeled[1]);
  return "";
}

async function handleCreateQuote() {
  resetResult();
  setBusy(el.createQuoteBtn, true);
  showStatus("Validating estimate with AI and creating opportunity/project quote...");

  try {
    const preparationResult = await prepareEstimateForQuoteAction({
      aiRequired: false,
      autoOpenEstimatorQuestions: false,
      showProgressStatus: false,
      showSuccessStatus: false
    });
    if (!preparationResult.ok) {
      return;
    }

    const { valid, errors, payload } = buildPayload();
    if (!valid) {
      showStatus(errors[0], "error");
      return;
    }

    payload.quoteBody = cleanString(el.quoteBody.value);
    payload.quoteDescription =
      sanitizeBriefDescription(
        cleanString(el.quoteDescription?.value || state.quoteDescription),
        buildLocalQuoteDescription(payload.quoteBody)
      );

    showStatus("Creating opportunity and project quote...");
    const result = await apiFetch("/api/quote", {
      method: "POST",
      body: payload
    });
    state.lastQuoteResult = result;
    syncQuoteActionButtons();
    const quoteFileAttached = Boolean(result?.quoteFile?.attached);
    const quoteFileAttempted = Boolean(result?.quoteFile?.attempted);
    const quoteFileMessage = cleanString(result?.quoteFile?.message);
    const pricingBookCreated = Boolean(result?.pricingBook?.created);
    const pricingBookAttempted = Boolean(result?.pricingBook?.attempted);
    const pricingBookMessage = cleanString(result?.pricingBook?.message);
    const pricingBookSeedAttempted = Boolean(result?.pricingBook?.seed?.attempted);
    const pricingBookSummaryApplied = Boolean(result?.pricingBook?.seed?.summaryApplied);
    const pricingBookSeedPreviewGrandTotal = parseNumber(result?.pricingBook?.seedPreview?.grandTotal, 0);
    const linesCount = parseNumber(result?.linesCount, 0);
    const scopePolishAttempted = Boolean(result?.scopePolish?.attempted);
    const scopePolishGeneratedByAI = Boolean(result?.scopePolish?.generatedByAI);
    const warnings = Array.isArray(preparationResult?.warnings) ? [...preparationResult.warnings] : [];
    if (pricingBookAttempted && !pricingBookCreated) {
      warnings.push(`Pricing book was not created: ${pricingBookMessage || "Unknown pricing-book error."}`);
    }
    if (pricingBookCreated && pricingBookSeedAttempted && !pricingBookSummaryApplied) {
      warnings.push("Pricing book summary was not applied. BACKUP link was not updated.");
    }
    if (pricingBookCreated && linesCount > 0 && pricingBookSeedPreviewGrandTotal <= 0) {
      warnings.push("Pricing-book seed input grand total was $0.00. Review division cost inputs/template mapping.");
    }
    if (quoteFileAttempted && !quoteFileAttached) {
      warnings.push(`Quote file was not attached: ${quoteFileMessage || "Unknown upload error."}`);
    }
    if (scopePolishAttempted && !scopePolishGeneratedByAI) {
      warnings.push("OpenAI scope polish ran in fallback mode. Set OPENAI_API_KEY to enable full AI text cleanup.");
    }
    if (warnings.length) {
      showStatus(
        `Validated and created Quote ${result.quoteNbr} and Opportunity ${result.opportunityId}. ${warnings.join(" ")}`,
        "error"
      );
    } else {
      showStatus(`Validated and created Quote ${result.quoteNbr} and Opportunity ${result.opportunityId}.`, "success");
    }
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(el.createQuoteBtn, false);
  }
}

function parseFilenameFromContentDisposition(raw) {
  const value = cleanString(raw);
  const match = value.match(/filename=\"?([^\";]+)\"?/i);
  return match ? match[1] : "quote-backup.pdf";
}

async function handleDownloadPdf() {
  const mappingStatus = await ensureScopeMappings({ silent: false });
  if (!mappingStatus.ok) return;

  const { valid, errors, payload } = buildPayload();
  if (!valid) {
    showStatus(errors[0], "error");
    return;
  }

  const account = getSelectedAccount();
  const selectedContact = getSelectedContact();
  const quoteNumber =
    cleanString(state.lastQuoteResult?.quoteNbr) ||
    extractQuoteNumberCandidate(el.quoteBody?.value) ||
    "PENDING";
  const salesRep =
    cleanString(account?.owner || account?.ownerEmployeeName) ||
    cleanString(payload?.account?.owner) ||
    cleanString(selectedContact?.displayName) ||
    cleanString(payload?.account?.contactName) ||
    cleanString(state.username) ||
    "TBD";
  const body = {
    ...payload,
    quoteBody: cleanString(el.quoteBody.value),
    quoteDescription:
      sanitizeBriefDescription(
        cleanString(el.quoteDescription?.value || state.quoteDescription),
        buildLocalQuoteDescription(cleanString(el.quoteBody.value))
      ),
    quoteNumber,
    salesRep,
    transactionDate: new Date().toISOString(),
    billTo: buildPdfAddressObject(account),
    shipTo: buildPdfAddressObject(account)
  };

  setBusy(el.downloadPdfBtn, true);
  showStatus("Generating PDF...");

  try {
    const headers = {
      "Content-Type": "application/json"
    };
    if (state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }

    const response = await fetch(resolveAppPath("/api/quote/backup-pdf"), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      credentials: "same-origin"
    });

    if (!response.ok) {
      const payloadError = await response.json().catch(() => ({}));
      throw new Error(payloadError?.error || `PDF generation failed (${response.status})`);
    }

    const blob = await response.blob();
    const fileName = parseFilenameFromContentDisposition(response.headers.get("content-disposition"));
    const driveFileUrl = cleanString(response.headers.get("x-drive-file-url"));
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    showStatus(
      driveFileUrl
        ? `PDF downloaded. Drive file: ${driveFileUrl}`
        : "PDF downloaded.",
      "success"
    );
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(el.downloadPdfBtn, false);
  }
}

function openModal(modal) {
  modal.classList.remove("hidden");
}

function closeModal(modal) {
  modal.classList.add("hidden");
  if (modal === el.accountModal) {
    closeSalesRepDropdown();
  }
}

async function handleSaveEstimatorQuestions() {
  if (!el.estimatorQuestionsList) return;
  const inputs = Array.from(el.estimatorQuestionsList.querySelectorAll("textarea[data-estimator-question-key]"));
  if (!inputs.length) {
    closeEstimatorQuestionsModal();
    return;
  }

  recordUndoSnapshot("Save estimator clarification answers");
  const nextAnswers = {
    ...(state.estimatorClarificationAnswers || {})
  };
  inputs.forEach((input) => {
    const key = cleanString(input.dataset?.estimatorQuestionKey);
    if (!key) return;
    const answer = cleanString(input.value);
    if (answer) {
      nextAnswers[key] = answer;
    } else {
      delete nextAnswers[key];
    }
  });
  const answeredEntries = getEstimatorClarificationEntries().filter((entry) =>
    Boolean(cleanString(nextAnswers?.[entry.key] || ""))
  );
  state.estimatorClarifyingQuestions = answeredEntries.map((entry) => entry.question);
  state.estimatorClarificationAnswers = Object.fromEntries(
    answeredEntries
      .map((entry) => [entry.key, cleanString(nextAnswers?.[entry.key] || "")])
      .filter(([, answer]) => Boolean(answer))
  );
  markEstimatorClarificationPassCompletedForCurrentScope();
  renderEstimatorQuestionsModal();
  closeEstimatorQuestionsModal();

  if (!buildEstimatorClarificationPayload().length) {
    showStatus("Estimator question pass completed. AI will keep unresolved details generic for this scope.", "success");
    return;
  }

  showStatus("Saving estimator answers and rebuilding AI scope/validation...");
  if (el.saveEstimatorQuestionsBtn) setBusy(el.saveEstimatorQuestionsBtn, true);
  try {
    await applyEstimatorClarificationsToAi();
  } finally {
    if (el.saveEstimatorQuestionsBtn) setBusy(el.saveEstimatorQuestionsBtn, false);
  }
}

async function createBusinessAccount() {
  const name = cleanString(el.newAccountName.value);
  const city = cleanString(el.newAccountCity?.value);
  const postalCode = normalizeCanadianPostalCode(el.newAccountPostal?.value);
  await autoSelectSalesRepFromQuery();
  const selectedSalesRep = getSelectedNewAccountSalesRep();
  if (!name) {
    showStatus("New account name is required.", "error");
    return;
  }
  if (!selectedSalesRep?.employeeId) {
    showStatus("Sales rep is required.", "error");
    return;
  }
  if (!city) {
    showStatus("City is required.", "error");
    return;
  }
  if (!postalCode || !isValidCanadianPostalCode(postalCode)) {
    showStatus("Postal Code is required in Canadian format (e.g., A1A 1A1).", "error");
    return;
  }
  if (el.newAccountPostal) {
    el.newAccountPostal.value = postalCode;
  }

  setBusy(el.saveAccountBtn, true);
  showStatus("Creating business account...");

  try {
    const payload = {
      businessAccountId: cleanString(el.newAccountId?.value),
      name,
      email: cleanString(el.newAccountEmail?.value),
      phone: cleanString(el.newAccountPhone?.value),
      addressLine1: cleanString(el.newAccountAddress1?.value),
      addressLine2: cleanString(el.newAccountAddress2?.value),
      city,
      state: cleanString(el.newAccountState?.value || DEFAULT_ACCOUNT_PROVINCE) || DEFAULT_ACCOUNT_PROVINCE,
      postalCode,
      country: cleanString(el.newAccountCountry?.value || DEFAULT_ACCOUNT_COUNTRY) || DEFAULT_ACCOUNT_COUNTRY,
      ownerId: cleanString(selectedSalesRep.employeeId),
      owner: cleanString(selectedSalesRep.name)
    };

    const result = await apiFetch("/api/business-accounts", {
      method: "POST",
      body: payload
    });

    closeModal(el.accountModal);
    clearNewAccountFields();
    await loadAccounts({ force: true });
    if (result?.item?.businessAccountId) {
      state.selectedAccountId = result.item.businessAccountId;
      state.accountQuery = cleanString(result?.item?.name || "");
      renderAccounts();
      await loadContactsForSelectedAccount();
    }
    showStatus(`Business account created: ${result?.item?.name || name}`, "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(el.saveAccountBtn, false);
  }
}

function clearNewAccountFields() {
  state.selectedNewAccountSalesRepId = "";
  state.newAccountSalesRepQuery = "";
  [
    el.newAccountId,
    el.newAccountSalesRepId,
    el.newAccountSalesRepInput,
    el.newAccountName,
    el.newAccountEmail,
    el.newAccountPhone,
    el.newAccountAddress1,
    el.newAccountAddress2,
    el.newAccountCity,
    el.newAccountState,
    el.newAccountPostal,
    el.newAccountCountry
  ].forEach((input) => {
    if (!input) return;
    if (input === el.newAccountState) {
      input.value = DEFAULT_ACCOUNT_PROVINCE;
    } else if (input === el.newAccountCountry) {
      input.value = DEFAULT_ACCOUNT_COUNTRY;
    } else {
      input.value = "";
    }
  });
  closeSalesRepDropdown();
  renderSalesRepOptions();
}

async function createContact() {
  const account = getSelectedAccount();
  if (!account) {
    showStatus("Select a business account first.", "error");
    return;
  }

  const firstName = cleanString(el.newContactFirstName.value);
  const lastName = cleanString(el.newContactLastName.value);
  const displayName = cleanString(el.newContactDisplayName.value);
  const email = cleanString(el.newContactEmail.value);
  const phone = cleanString(el.newContactPhone.value);
  const contactClass = cleanString(el.newContactClass.value);

  if (!firstName) {
    showStatus("First name is required.", "error");
    return;
  }
  if (!lastName) {
    showStatus("Last name is required.", "error");
    return;
  }
  if (!email) {
    showStatus("Email is required.", "error");
    return;
  }
  if (!phone) {
    showStatus("Phone is required.", "error");
    return;
  }
  if (!contactClass) {
    showStatus("Contact class is required.", "error");
    return;
  }

  setBusy(el.saveContactBtn, true);
  showStatus("Creating contact...");

  try {
    const payload = {
      businessAccountId: account.businessAccountId,
      firstName,
      lastName,
      displayName,
      email,
      phone,
      contactClass
    };
    const result = await apiFetch("/api/contacts", {
      method: "POST",
      body: payload
    });

    closeModal(el.contactModal);
    clearNewContactFields();
    await loadContactsForSelectedAccount();
    if (result?.item?.contactId) {
      state.selectedContactId = result.item.contactId;
      renderContacts();
    }
    showStatus(`Contact created: ${result?.item?.displayName || displayName}`, "success");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    setBusy(el.saveContactBtn, false);
  }
}

function clearNewContactFields() {
  [el.newContactFirstName, el.newContactLastName, el.newContactDisplayName, el.newContactEmail, el.newContactPhone].forEach(
    (input) => {
      if (input) input.value = "";
    }
  );
  if (el.newContactClass) {
    el.newContactClass.value = "";
    if (typeof el.newContactClass.selectedIndex === "number") {
      el.newContactClass.selectedIndex = 0;
    }
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function capitalize(value) {
  const text = cleanString(value);
  if (!text) return "Division";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function onDivisionInput(event) {
  if (!hasSelectedDepartment()) {
    showStatus("Select Department first before moving to Estimation Input.", "error");
    renderDivisions();
    return;
  }
  const eventType = cleanString(event.type).toLowerCase();
  const divisionId = cleanString(event.target?.dataset?.division);
  const division = getDivisionSection(divisionId);
  if (!divisionId || !division) return;
  ensureDivisionWorksheetDefaults(division);

  const worksheetField = cleanString(event.target?.dataset?.worksheetField);
  const worksheetToggle = cleanString(event.target?.dataset?.worksheetToggle);
  const worksheetRowIndex = parseNumber(event.target?.dataset?.rowIndex, -1);
  if ((worksheetField || worksheetToggle) && worksheetRowIndex >= 0) {
    const worksheetRows = Array.isArray(division.estimateWorksheet) ? division.estimateWorksheet : [];
    const worksheetRow = worksheetRows[worksheetRowIndex];
    if (!worksheetRow) return;
    if (worksheetToggle === "locked") {
      if (eventType !== "change") return;
      recordUndoSnapshot(`Update ${getDivisionActionLabel(divisionId)} estimate worksheet`);
      worksheetRow.locked = Boolean(event.target.checked);
      worksheetRow.origin = worksheetRow.locked ? "manual" : "ai";
      rollupEstimateWorksheetForDivision(division);
      renderDivisions();
      updateDivisionTotalsDisplay(divisionId);
      return;
    }
    if (eventType === "input") {
      recordUndoBeforeEdit(event.target, `Update ${getDivisionActionLabel(divisionId)} estimate worksheet`);
    }
    if (eventType === "change") {
      if (!undoEditSessionTargets.has(event.target)) {
        recordUndoSnapshot(`Update ${getDivisionActionLabel(divisionId)} estimate worksheet`);
      }
      closeUndoEditSession(event.target);
    }
    worksheetRow[worksheetField] = Math.max(0, parseNumber(event.target.value, 0));
    if (worksheetField === "generalLabourHours") {
      worksheetRow.supervisionHours = Math.round(
        parseNumber(worksheetRow.generalLabourHours, 0) * getDivisionWorksheetSupervisionRatio(division.id) * 100
      ) / 100;
    }
    worksheetRow.origin = "manual";
    worksheetRow.locked = true;
    if (worksheetField === "materialAllowanceCost" && parseNumber(worksheetRow.materialAllowanceCost, 0) <= 0) {
      worksheetRow.materialSuggestions = [];
    }
    rollupEstimateWorksheetForDivision(division);
    if (eventType === "change") {
      renderDivisions();
    } else {
      updateDivisionTotalsDisplay(divisionId);
    }
    return;
  }

  const field = cleanString(event.target?.dataset?.field);
  if (field) {
    if (event.target?.type === "checkbox" && eventType !== "change") return;
    if (eventType === "input") {
      recordUndoBeforeEdit(event.target, `Update ${getDivisionActionLabel(divisionId)} ${field}`);
    }
    if (eventType === "change") {
      if (!undoEditSessionTargets.has(event.target)) {
        recordUndoSnapshot(`Update ${getDivisionActionLabel(divisionId)} ${field}`);
      }
      closeUndoEditSession(event.target);
    }
    const value = event.target.type === "checkbox" ? Boolean(event.target.checked) : event.target.value;
    if (field === "sectionTitle") {
      setDivisionSectionTitle(division, value);
      resetQuoteReviewConfirmation({ keepSignerName: true });
      updateQuoteMarkupSummaryDisplay();
      renderAiValidation();
      return;
    }
    division[field] = value;
    if (field === "estimatorId") {
      division.estimatorId = cleanString(value).toUpperCase();
      division.templateEstimator = division.estimatorId;
      syncDivisionEstimatorName(division);
    }
    if (field === "technicianHours") {
      division.estimateRollup.technicianHoursOrigin = "manual";
    }
    if (field === "supervisionHours") {
      division.estimateRollup.supervisionHoursOrigin = "manual";
    }
    if (field === "projectManagerHours") {
      division.estimateRollup.projectManagerHoursOrigin = "manual";
    }
    applyDivisionModeRules(division);
    if (field === "scope") {
      autoResizeTextarea(event.target, 84);
    }
    if (
      field === "templateCostCode" ||
      field === "templateTaxCategory" ||
      field === "templateMaterialUom" ||
      field === "templateSubtradeUom"
    ) {
      ensureDivisionLineDefaults(division, "material", { force: true });
      ensureDivisionLineDefaults(division, "subcontractor", { force: true });
    }
    if (field === "labourNoCost" || field === "materialNoCost" || field === "subcontractorNoCost") {
      resetQuoteReviewConfirmation({ keepSignerName: true });
      renderDivisions();
      return;
    }
    resetQuoteReviewConfirmation({ keepSignerName: true });
    updateDivisionTotalsDisplay(divisionId);
    return;
  }

  const kind = cleanString(event.target?.dataset?.kind);
  const lineField = cleanString(event.target?.dataset?.lineField);
  const lineIndex = parseNumber(event.target?.dataset?.lineIndex, -1);
  if (!kind || !lineField || lineIndex < 0) return;
  if (eventType === "input") {
    recordUndoBeforeEdit(event.target, `Update ${getDivisionActionLabel(divisionId)} ${kind} line`);
  }
  if (eventType === "change") {
    if (!undoEditSessionTargets.has(event.target)) {
      recordUndoSnapshot(`Update ${getDivisionActionLabel(divisionId)} ${kind} line`);
    }
    closeUndoEditSession(event.target);
  }

  const listKey = kind === "material" ? "materialLines" : "subcontractorLines";
  const lines = division[listKey];
  if (!Array.isArray(lines) || !lines[lineIndex]) return;
  lines[lineIndex][lineField] = event.target.value;
  if (lineField === "description" && cleanString(event.target?.tagName).toLowerCase() === "textarea") {
    autoResizeTextarea(event.target, 56);
  }
  const currentLine = lines[lineIndex];
  if (currentLine?.autoGenerated && cleanString(currentLine?.source) === "worksheet") {
    currentLine.locked = true;
    currentLine.origin = "manual";
  }
  const setLineInput = (fieldName, fieldValue) => {
    const input = el.divisionsContainer.querySelector(
      `[data-division="${divisionId}"][data-kind="${kind}"][data-line-index="${lineIndex}"][data-line-field="${fieldName}"]`
    );
    if (input) input.value = fieldValue;
  };

  if (lineField === "cost") {
    if (!hasNumericInput(currentLine.cost)) {
      currentLine.cost = "";
      setLineInput("cost", "");
    }
  } else if (lineField === "unitCost") {
    const quantity = parseNumber(currentLine.quantity, Number.NaN);
    const unitCost = parseNumber(currentLine.unitCost, Number.NaN);
    const hasQuantity = hasNumericInput(currentLine.quantity);
    const hasUnitCost = hasNumericInput(currentLine.unitCost);
    if (hasQuantity && hasUnitCost && quantity >= 0 && unitCost >= 0) {
      currentLine.cost = formatNumberForInput(unitCost * quantity);
    } else if (!hasUnitCost) {
      currentLine.cost = "";
    }
    setLineInput("cost", currentLine.cost || "");
  } else if (lineField === "quantity") {
    const quantity = parseNumber(currentLine.quantity, Number.NaN);
    const unitCost = parseNumber(currentLine.unitCost, Number.NaN);
    const hasQuantity = hasNumericInput(currentLine.quantity);
    const hasUnitCost = hasNumericInput(currentLine.unitCost);
    if (hasQuantity && hasUnitCost && quantity >= 0 && unitCost >= 0) {
      currentLine.cost = formatNumberForInput(unitCost * quantity);
      setLineInput("cost", currentLine.cost || "");
    }
  }

  if (lineField === "cost" || lineField === "unitCost" || lineField === "quantity" || lineField === "markup") {
    const autoSell = getAutoSellTotal(currentLine.cost, currentLine.markup);
    currentLine.sellingPrice = autoSell;
    setLineInput("sellingPrice", autoSell);
  }
  resetQuoteReviewConfirmation({ keepSignerName: true });
  updateDivisionTotalsDisplay(divisionId);
}

function onDivisionClick(event) {
  if (!hasSelectedDepartment()) {
    showStatus("Select Department first before moving to Estimation Input.", "error");
    renderDivisions();
    return;
  }
  const action = cleanString(event.target?.dataset?.action);
  if (!action) return;

  if (action === "add-division-section") {
    const tradeId = cleanString(event.target?.dataset?.trade);
    if (!tradeId) return;
    recordUndoSnapshot(`Add ${capitalize(tradeId)} section`);
    const section = createDivisionSection(tradeId);
    state.divisionSections.push(section);
    const genericItem = getGenericTemplateItemForDivision(section.id);
    if (genericItem) {
      applyTemplateToDivision(section.sectionId, genericItem);
    } else {
      ensureDivisionTemplateDefaults(section.sectionId);
    }
    resetQuoteReviewConfirmation({ keepSignerName: true });
    renderDivisions();
    window.requestAnimationFrame(() => {
      const scopeField = el.divisionsContainer?.querySelector(
        `[data-division="${section.sectionId}"][data-field="scope"]`
      );
      if (scopeField && typeof scopeField.focus === "function") {
        scopeField.focus();
      }
    });
    return;
  }

  const divisionId = cleanString(event.target?.dataset?.division);
  const division = getDivisionSection(divisionId);
  if (action === "toggle-worksheet" && division) {
    ensureDivisionWorksheetDefaults(division);
    division.worksheetCollapsed = !division.worksheetCollapsed;
    renderDivisions();
    return;
  }
  if (action === "remove-division-section" && divisionId && division) {
    recordUndoSnapshot(`Remove ${getDivisionDisplayTitle(division)}`);
    state.divisionSections = getDivisionSections().filter(
      (item) => cleanString(item.sectionId) !== divisionId
    );
    if (state.estimateLibrarySuggestions && typeof state.estimateLibrarySuggestions === "object") {
      delete state.estimateLibrarySuggestions[divisionId];
    }
    if (state.historicalSectionAnchors && typeof state.historicalSectionAnchors === "object") {
      delete state.historicalSectionAnchors[divisionId];
    }
    if (Array.isArray(state.aiValidation?.suggestions)) {
      state.aiValidation.suggestions = state.aiValidation.suggestions.filter(
        (suggestion) => cleanString(suggestion?.sectionId) !== divisionId
      );
    }
    resetQuoteReviewConfirmation({ keepSignerName: true });
    renderDivisions();
    renderAiValidation();
    return;
  }

  if (action === "add-line" && divisionId) {
    const kind = cleanString(event.target?.dataset?.kind);
    if (!["material", "subcontractor"].includes(kind)) return;
    if (!division) return;
    if (kind === "material" && isGlendaleDivisionId(division.id)) return;
    recordUndoSnapshot(`Add ${kind} line to ${getDivisionDisplayTitle(division)}`);
    const listKey = kind === "material" ? "materialLines" : "subcontractorLines";
    const noCostKey = kind === "material" ? "materialNoCost" : "subcontractorNoCost";
    division[noCostKey] = false;
    const defaults = getDivisionLineDefaults(division, kind);
    division[listKey].push(defaultCostLine(kind, defaults));
    resetQuoteReviewConfirmation({ keepSignerName: true });
    renderDivisions();
    return;
  }

  if (action === "remove-line" && divisionId) {
    const kind = cleanString(event.target?.dataset?.kind);
    const listKey = kind === "material" ? "materialLines" : "subcontractorLines";
    const lineIndex = parseNumber(event.target?.dataset?.lineIndex, -1);
    if (lineIndex >= 0 && division) {
      recordUndoSnapshot(`Remove ${kind} line from ${getDivisionDisplayTitle(division)}`);
      division[listKey].splice(lineIndex, 1);
      resetQuoteReviewConfirmation({ keepSignerName: true });
      renderDivisions();
    }
    return;
  }

  if (action === "apply-task-suggestion") {
    return;
  }

  if (action === "accept-validation") {
    acceptValidationSuggestion(parseNumber(event.target?.dataset?.suggestionIndex, -1));
    renderDivisions();
    renderAiValidation();
    return;
  }

  if (action === "accept-all-validation") {
    acceptAllValidationSuggestions();
    return;
  }

  if (action === "open-estimator-questions") {
    openEstimatorQuestionsModal({ focusFirstUnanswered: true });
    return;
  }

  if (action === "apply-history-match") {
    applyHistoricalEstimateMatch(
      cleanString(event.target?.dataset?.division),
      cleanString(event.target?.dataset?.scopeLineKey),
      parseNumber(event.target?.dataset?.matchIndex, -1)
    );
  }
}

function bindEvents() {
  el.loginBtn.addEventListener("click", signIn);
  if (el.loginUsername) {
    el.loginUsername.addEventListener("keydown", handleLoginFieldKeydown);
  }
  if (el.loginPassword) {
    el.loginPassword.addEventListener("keydown", handleLoginFieldKeydown);
  }
  if (el.forgotPasswordBtn) {
    el.forgotPasswordBtn.addEventListener("click", handleForgotPassword);
  }
  if (el.rememberPassword) {
    el.rememberPassword.addEventListener("change", (event) => {
      if (!event.target.checked) {
        clearSavedCredentials();
      }
    });
  }
  el.logoutBtn.addEventListener("click", signOut);
  if (el.quoteTypeInputs.length) {
    const selected = el.quoteTypeInputs.find((input) => input.checked);
    state.quoteType = selected ? cleanString(selected.value) : "";
    syncProjectTypeField();
    syncDepartmentGate();
    el.quoteTypeInputs.forEach((input) => {
      input.addEventListener("change", (event) => {
        if (event.target.checked) {
          state.quoteType = cleanString(event.target.value);
          syncProjectTypeField();
          syncDepartmentGate();
          if (hasAuthenticatedSession() && !state.accounts.length && !state.accountsLoading) {
            if (!hydrateAccountsFromCache()) {
              loadAccounts({ force: false }).catch((error) => {
                showStatus(error.message, "error");
              });
            }
          }
        }
      });
    });
  }
  el.accountComboInput.addEventListener("focus", () => {
    if (!ensureDepartmentSelected("Select a Department before choosing an account.")) return;
    openAccountDropdown();
    renderAccounts();
  });
  el.accountComboInput.addEventListener("input", () => {
    if (!hasSelectedDepartment()) return;
    state.accountQuery = cleanString(el.accountComboInput.value);
    const selected = getSelectedAccount();
    if (selected && cleanString(selected.name).toLowerCase() !== state.accountQuery.toLowerCase()) {
      state.selectedAccountId = "";
      state.selectedContactId = "";
      state.contacts = [];
      renderContacts();
      renderAccountAddress();
    }
    openAccountDropdown();
    renderAccounts();
  });
  el.accountComboInput.addEventListener("blur", () => {
    if (!hasSelectedDepartment()) return;
    setTimeout(async () => {
      await autoSelectAccountFromQuery();
      closeAccountDropdown();
    }, 120);
  });
  el.accountComboInput.addEventListener("keydown", (event) => {
    if (!hasSelectedDepartment()) return;
    if (event.key === "Escape") {
      closeAccountDropdown();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      autoSelectAccountFromQuery();
    }
  });
  el.accountDropdown.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  el.accountDropdown.addEventListener("click", async (event) => {
    if (!hasSelectedDepartment()) return;
    const button = event.target.closest("[data-action='select-account']");
    if (!button) return;
    await selectAccountById(button.dataset.accountId);
  });
  if (el.newAccountSalesRepInput && el.newAccountSalesRepDropdown) {
    el.newAccountSalesRepInput.addEventListener("focus", () => {
      openSalesRepDropdown();
      renderSalesRepOptions();
    });
    el.newAccountSalesRepInput.addEventListener("input", () => {
      state.newAccountSalesRepQuery = cleanString(el.newAccountSalesRepInput.value);
      const selected = getSelectedNewAccountSalesRep();
      if (selected && cleanString(selected.name).toLowerCase() !== state.newAccountSalesRepQuery.toLowerCase()) {
        state.selectedNewAccountSalesRepId = "";
        if (el.newAccountSalesRepId) {
          el.newAccountSalesRepId.value = "";
        }
      }
      openSalesRepDropdown();
      renderSalesRepOptions();
    });
    el.newAccountSalesRepInput.addEventListener("blur", () => {
      setTimeout(async () => {
        await autoSelectSalesRepFromQuery();
        closeSalesRepDropdown();
      }, 120);
    });
    el.newAccountSalesRepInput.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeSalesRepDropdown();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        autoSelectSalesRepFromQuery();
      }
    });
    el.newAccountSalesRepDropdown.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    el.newAccountSalesRepDropdown.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action='select-sales-rep']");
      if (!button) return;
      selectNewAccountSalesRepById(button.dataset.employeeId);
    });
  }
  el.contactSelect.addEventListener("change", (event) => {
    state.selectedContactId = event.target.value;
  });
  if (el.willWinJobSelect) {
    el.willWinJobSelect.value = state.willWinJob || "Yes";
    el.willWinJobSelect.addEventListener("change", (event) => {
      recordUndoSnapshot("Update win probability field");
      state.willWinJob = cleanString(event.target.value) || "Yes";
    });
  }
  if (el.linkToDriveInput) {
    el.linkToDriveInput.value = state.linkToDrive || DEFAULT_LINK_TO_DRIVE_TEXT;
    state.linkToDrive = cleanString(el.linkToDriveInput.value || DEFAULT_LINK_TO_DRIVE_TEXT);
    el.linkToDriveInput.addEventListener("input", (event) => {
      recordUndoBeforeEdit(event.target, "Edit link to drive");
      state.linkToDrive = cleanString(event.target.value || DEFAULT_LINK_TO_DRIVE_TEXT);
    });
    el.linkToDriveInput.addEventListener("change", (event) => {
      if (!undoEditSessionTargets.has(event.target)) {
        recordUndoSnapshot("Edit link to drive");
      }
      closeUndoEditSession(event.target);
    });
    el.linkToDriveInput.addEventListener("blur", (event) => {
      closeUndoEditSession(event.target);
    });
  }
  el.refreshAccountsBtn.addEventListener("click", async () => {
    if (!ensureDepartmentSelected("Select a Department before refreshing accounts.")) return;
    try {
      await loadAccounts({ force: true });
    } catch (error) {
      showStatus(error.message, "error");
    }
  });
  el.refreshContactsBtn.addEventListener("click", loadContactsForSelectedAccount);
  el.newAccountBtn.addEventListener("click", async () => {
    if (!ensureDepartmentSelected("Select a Department before creating a new account.")) return;
    clearNewAccountFields();
    openModal(el.accountModal);
    try {
      await loadEmployees({ force: false });
    } catch (error) {
      showStatus(`Unable to load sales reps: ${error.message}`, "error");
    }
  });
  el.newContactBtn.addEventListener("click", () => openModal(el.contactModal));
  el.cancelAccountBtn.addEventListener("click", () => {
    closeSalesRepDropdown();
    closeModal(el.accountModal);
  });
  el.cancelContactBtn.addEventListener("click", () => closeModal(el.contactModal));
  if (el.closeEstimatorQuestionsBtn) {
    el.closeEstimatorQuestionsBtn.addEventListener("click", closeEstimatorQuestionsModal);
  }
  if (el.saveEstimatorQuestionsBtn) {
    el.saveEstimatorQuestionsBtn.addEventListener("click", handleSaveEstimatorQuestions);
  }
  el.saveAccountBtn.addEventListener("click", createBusinessAccount);
  el.saveContactBtn.addEventListener("click", createContact);
  if (el.aiValidateBtn) {
    el.aiValidateBtn.addEventListener("click", handleAiValidate);
  }
  if (el.aiReviewFinalizeBtn) {
    el.aiReviewFinalizeBtn.addEventListener("click", handleAiReviewAndFinalizeOneClick);
  }
  if (el.scopeFinalizeBtn) {
    el.scopeFinalizeBtn.addEventListener("click", handleScopeFinalizeOneClick);
  }
  if (el.scopeBuildBtn) {
    el.scopeBuildBtn.addEventListener("click", handleScopeBuildFromDivisions);
  }
  if (el.librarySuggestBtn) {
    el.librarySuggestBtn.addEventListener("click", handleEstimateLibrarySuggest);
  }
  if (el.librarySyncBtn) {
    el.librarySyncBtn.addEventListener("click", handleEstimateLibrarySync);
  }
  if (el.prototypeToggleBtn) {
    el.prototypeToggleBtn.addEventListener("click", () => {
      state.prototypePanelOpen = !state.prototypePanelOpen;
      renderPrototypeEstimatePanel();
    });
  }
  if (el.step3AccordionBtn) {
    el.step3AccordionBtn.addEventListener("click", () => {
      if (!isStepTwoComplete()) return;
      openBuilderAccordion("step3");
    });
  }
  if (el.step4AccordionBtn) {
    el.step4AccordionBtn.addEventListener("click", () => {
      if (!isStepTwoComplete()) return;
      openBuilderAccordion("step4");
    });
  }
  if (el.step5AccordionBtn) {
    el.step5AccordionBtn.addEventListener("click", () => {
      if (!isStepTwoComplete()) return;
      openBuilderAccordion("step5");
    });
  }
  if (el.prototypeGenerateBtn) {
    el.prototypeGenerateBtn.addEventListener("click", handleGeneratePrototypeEstimate);
  }
  if (el.prototypeApplyBtn) {
    el.prototypeApplyBtn.addEventListener("click", handleApplyPrototypeEstimate);
  }
  if (el.prototypeApproveBtn) {
    el.prototypeApproveBtn.addEventListener("click", handleApprovePrototypeFeedback);
  }
  if (el.scopeSuggestBtn) {
    el.scopeSuggestBtn.addEventListener("click", handleScopeSuggest);
  }
  if (el.scopeCustomBtn) {
    el.scopeCustomBtn.addEventListener("click", handleScopeCustomStart);
  }
  if (el.scopeCustomRunBtn) {
    el.scopeCustomRunBtn.addEventListener("click", handleScopeCustomRun);
  }
  if (el.scopeCustomCancelBtn) {
    el.scopeCustomCancelBtn.addEventListener("click", handleScopeCustomCancel);
  }
  if (el.aiDescriptionBtn) {
    el.aiDescriptionBtn.addEventListener("click", handleDescriptionSuggest);
  }
  if (el.scopeApplySuggestionBtn) {
    el.scopeApplySuggestionBtn.addEventListener("click", handleApplyScopeSuggestion);
  }
  if (el.scopeGrammarBtn) {
    el.scopeGrammarBtn.addEventListener("click", handleScopeGrammarCheck);
  }
  el.createQuoteBtn.addEventListener("click", handleCreateQuote);
  if (el.openQuoteBtn) {
    el.openQuoteBtn.addEventListener("click", openCurrentQuote);
  }
  el.downloadPdfBtn.addEventListener("click", handleDownloadPdf);
  el.quoteBody.addEventListener("input", (event) => {
    recordUndoBeforeEdit(event.target, "Edit full scope of work");
    state.quoteBody = event.target.value;
    state.scopeSuggestion = cleanString(event.target.value);
    syncQuoteBodyTextareaSize();
    renderScopeSuggestion();
  });
  el.quoteBody.addEventListener("change", (event) => {
    if (!undoEditSessionTargets.has(event.target)) {
      recordUndoSnapshot("Edit full scope of work");
    }
    closeUndoEditSession(event.target);
  });
  el.quoteBody.addEventListener("blur", (event) => {
    closeUndoEditSession(event.target);
  });
  if (el.prototypeScopeInput) {
    el.prototypeScopeInput.addEventListener("input", (event) => {
      recordUndoBeforeEdit(event.target, "Edit prototype master scope");
      state.prototypeScopeText = event.target.value;
    });
    el.prototypeScopeInput.addEventListener("change", (event) => {
      if (!undoEditSessionTargets.has(event.target)) {
        recordUndoSnapshot("Edit prototype master scope");
      }
      closeUndoEditSession(event.target);
    });
    el.prototypeScopeInput.addEventListener("blur", (event) => {
      closeUndoEditSession(event.target);
    });
  }
  if (el.quoteDescription) {
    el.quoteDescription.addEventListener("input", (event) => {
      recordUndoBeforeEdit(event.target, "Edit project description");
      state.quoteDescription = cleanString(event.target.value);
      syncQuoteBodyTextareaSize();
    });
    el.quoteDescription.addEventListener("change", (event) => {
      if (!undoEditSessionTargets.has(event.target)) {
        recordUndoSnapshot("Edit project description");
      }
      closeUndoEditSession(event.target);
    });
    el.quoteDescription.addEventListener("blur", (event) => {
      closeUndoEditSession(event.target);
    });
  }
  if (el.quoteReviewConfirmCheckbox) {
    el.quoteReviewConfirmCheckbox.checked = Boolean(state.quoteReviewConfirmed);
    el.quoteReviewConfirmCheckbox.addEventListener("change", (event) => {
      recordUndoSnapshot("Update cost review confirmation");
      state.quoteReviewConfirmed = Boolean(event.target.checked);
    });
  }
  if (el.quoteReviewSignerInput) {
    el.quoteReviewSignerInput.value = cleanString(state.quoteReviewSignerName);
    el.quoteReviewSignerInput.addEventListener("input", (event) => {
      recordUndoBeforeEdit(event.target, "Edit cost review signer name");
      state.quoteReviewSignerName = cleanString(event.target.value);
    });
    el.quoteReviewSignerInput.addEventListener("change", (event) => {
      if (!undoEditSessionTargets.has(event.target)) {
        recordUndoSnapshot("Edit cost review signer name");
      }
      state.quoteReviewSignerName = cleanString(event.target.value);
      closeUndoEditSession(event.target);
    });
    el.quoteReviewSignerInput.addEventListener("blur", (event) => {
      closeUndoEditSession(event.target);
    });
  }

  document.addEventListener("keydown", handleUndoRedoShortcut);

  el.divisionsContainer.addEventListener("input", onDivisionInput);
  el.divisionsContainer.addEventListener("change", onDivisionInput);
  el.divisionsContainer.addEventListener("click", onDivisionClick);
  if (el.aiValidation) {
    el.aiValidation.addEventListener("click", onDivisionClick);
    el.aiValidation.addEventListener("input", handleAiValidationSuggestionChange);
    el.aiValidation.addEventListener("change", handleAiValidationSuggestionChange);
  }

  [el.accountModal, el.contactModal, el.estimatorQuestionsModal].forEach((modal) => {
    if (!modal) return;
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });
}

function boot() {
  if (!INTEGRATED_AUTH_MODE) {
    hydrateSavedCredentials();
  }
  lockHorizontalViewportScroll();
  bindEvents();
  syncAiEstimatorControls();
  setCustomScopeControlsVisible(false);
  renderDivisions();
  renderScopeSuggestion();
  renderAiValidation();
  renderEstimatorQuestionsModal();
  renderEstimateLibraryStatus();
  if (el.quoteDescription) {
    el.quoteDescription.value = cleanString(state.quoteDescription);
  }
  if (el.quoteReviewConfirmCheckbox) {
    el.quoteReviewConfirmCheckbox.checked = Boolean(state.quoteReviewConfirmed);
  }
  if (el.quoteReviewSignerInput) {
    el.quoteReviewSignerInput.value = cleanString(state.quoteReviewSignerName);
  }
  syncQuoteBodyTextareaSize();
  setAuthUI(false);
  syncQuoteActionButtons();
  showAuthStatus(
    INTEGRATED_AUTH_MODE
      ? "Checking MeadowBrook sales session..."
      : state.token || (readSavedCredentials() && !readManualSignOutPreference())
      ? "Restoring session..."
      : "Ready to sign in."
  );
  recordUndoSnapshot("Initial state");
  verifyExistingSession();
}

boot();
