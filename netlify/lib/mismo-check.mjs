// Strict check for the MISMO 3.4 file that a visitor's browser sends with a lead.
// The file comes from the visitor's browser, and a loan officer will import it into their loan system,
// so only the exact shape Voklogik produces is accepted: known element names, known attributes,
// no DOCTYPE, entities, CDATA or processing instructions, balanced nesting, and a size limit.
// If the check fails the lead is still sent, just without the attachment.
export const MAX_BYTES = 150000;
const MAX_ELEMENTS = 4000, MAX_DEPTH = 20;

const TAGS = new Set([
  "ABOUT_VERSION",
  "ABOUT_VERSIONS",
  "ADDRESS",
  "AMORTIZATION",
  "AMORTIZATION_RULE",
  "ASSET",
  "ASSETS",
  "ASSET_DETAIL",
  "AddressLineText",
  "AssetCashOrMarketValueAmount",
  "AssetType",
  "AssetTypeOtherDescription",
  "BORROWER",
  "BORROWER_DETAIL",
  "BaseLoanAmount",
  "BorrowerClassificationType",
  "COLLATERAL",
  "COLLATERALS",
  "CONTACT_POINT",
  "CONTACT_POINTS",
  "CONTACT_POINT_EMAIL",
  "CONTACT_POINT_TELEPHONE",
  "CURRENT_INCOME",
  "CURRENT_INCOME_ITEM",
  "CURRENT_INCOME_ITEMS",
  "CURRENT_INCOME_ITEM_DETAIL",
  "CityName",
  "CombinedLTVRatioPercent",
  "ContactPointEmailValue",
  "ContactPointTelephoneValue",
  "CreatedDatetime",
  "CurrentIncomeMonthlyTotalAmount",
  "DEAL",
  "DEALS",
  "DEAL_SET",
  "DEAL_SETS",
  "DataVersionIdentifier",
  "DataVersionName",
  "FirstName",
  "HELOCIndicator",
  "HELOCMaximumBalanceAmount",
  "HOUSING_EXPENSE",
  "HOUSING_EXPENSES",
  "HousingExpensePaymentAmount",
  "HousingExpenseTimingType",
  "HousingExpenseType",
  "HousingExpenseTypeOtherDescription",
  "INDIVIDUAL",
  "IncomeType",
  "IncomeTypeOtherDescription",
  "InitialPrincipalAndInterestPaymentAmount",
  "LIABILITIES",
  "LIABILITY",
  "LIABILITY_DETAIL",
  "LOAN",
  "LOANS",
  "LOAN_DETAIL",
  "LTV",
  "LTVRatioPercent",
  "LastName",
  "LiabilityExclusionIndicator",
  "LiabilityMonthlyPaymentAmount",
  "LiabilityRemainingTermMonthsCount",
  "LiabilityType",
  "LiabilityTypeOtherDescription",
  "LiabilityUnpaidBalanceAmount",
  "LienPriorityType",
  "LoanAmortizationPeriodCount",
  "LoanAmortizationPeriodType",
  "LoanPurposeType",
  "MESSAGE",
  "NAME",
  "NoteRatePercent",
  "OWNED_PROPERTY",
  "PARTIES",
  "PARTY",
  "PAYMENT",
  "PAYMENT_RULE",
  "PROPERTIES",
  "PROPERTY",
  "PROPERTY_DETAIL",
  "PartyRoleType",
  "PostalCode",
  "PropertyEstimatedValueAmount",
  "PropertyUsageType",
  "QUALIFICATION",
  "RELATIONSHIP",
  "RELATIONSHIPS",
  "ROLE",
  "ROLES",
  "ROLE_DETAIL",
  "SALES_CONTRACT",
  "SALES_CONTRACTS",
  "SALES_CONTRACT_DETAIL",
  "SalesContractAmount",
  "StateCode",
  "TERMS_OF_LOAN",
  "TotalLiabilitiesMonthlyPaymentAmount",
  "TotalMonthlyIncomeAmount",
  "TotalMonthlyProposedHousingExpenseAmount",
]);
const ATTRS = new Set(["xmlns", "xmlns:xlink", "MISMOReferenceModelIdentifier", "SequenceNumber", "xlink:label", "xlink:from", "xlink:to", "xlink:arcrole", "LoanRoleType"]);
const NS = "http://www.mismo.org/residential/2009/schemaprops";
const XLINK = "http://www.w3.org/1999/xlink";
const DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';
const TAG = /<(\/?)([A-Za-z_][A-Za-z0-9_]*)((?:\s+[A-Za-z_][A-Za-z0-9_:.-]*="[^"<>&]{0,300}")*)\s*(\/?)>/y;
const ATTR = /\s+([A-Za-z_][A-Za-z0-9_:.-]*)="([^"]*)"/g;

export function checkMismo(xml) {
  const bad = (reason) => ({ ok: false, reason });
  if (typeof xml !== "string") return bad("not text");
  if (xml.length > MAX_BYTES) return bad("too large");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) return bad("control characters");
  if (!xml.startsWith(DECL)) return bad("missing xml declaration");
  let body = xml.slice(DECL.length);
  // one leading comment is allowed (Voklogik writes a short notice there)
  const c = /^<!--([^<>&]{0,600})-->\n/.exec(body);
  if (c && !c[1].includes("--")) body = body.slice(c[0].length);
  if (/<[!?]/.test(body)) return bad("forbidden markup");
  if (/&(?!(?:amp|lt|gt|quot);)/.test(body)) return bad("forbidden entity");

  const stack = []; let i = 0, count = 0, root = false;
  while (i < body.length) {
    const lt = body.indexOf("<", i);
    const text = body.slice(i, lt === -1 ? body.length : lt);
    if (text.includes(">")) return bad("stray >");
    if (lt === -1) { if (text.trim()) return bad("text outside root"); break; }
    TAG.lastIndex = lt;
    const m = TAG.exec(body);
    if (!m) return bad("malformed tag");
    i = TAG.lastIndex;
    const [, closing, name, attrs, selfClose] = m;
    if (!TAGS.has(name)) return bad("unknown element " + name.slice(0, 40));
    if (closing) {
      if (attrs.trim() || selfClose) return bad("bad closing tag");
      if (stack.pop() !== name) return bad("unbalanced");
      continue;
    }
    if (++count > MAX_ELEMENTS) return bad("too many elements");
    if (!stack.length) { if (root) return bad("second root"); if (name !== "MESSAGE") return bad("wrong root"); root = true; }
    let a; ATTR.lastIndex = 0;
    while ((a = ATTR.exec(attrs))) {
      if (!ATTRS.has(a[1])) return bad("unknown attribute " + a[1].slice(0, 40));
      if (a[1] === "xmlns" && a[2] !== NS) return bad("wrong namespace");
      if (a[1] === "xmlns:xlink" && a[2] !== XLINK) return bad("wrong xlink namespace");
    }
    if (selfClose) { if (name !== "RELATIONSHIP") return bad("unexpected empty element"); continue; }
    stack.push(name);
    if (stack.length > MAX_DEPTH) return bad("too deep");
  }
  if (stack.length || !root) return bad("incomplete");
  if (!/MISMOReferenceModelIdentifier="3\.4\./.test(body.slice(0, 600))) return bad("not MISMO 3.4");
  return { ok: true };
}
