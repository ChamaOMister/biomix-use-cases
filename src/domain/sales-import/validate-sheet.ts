import { resolveInputLimits } from "./limits";
import { HEADER_BY_FIELD, SOURCE_COLUMNS, normalizeHeader, type SalesField } from "./columns";
import {
  parseBillingDate,
  parseBusinessUnit,
  parseDateComponent,
  parseIdentifier,
  parseMoneyCents,
  parseOptionalText,
  parsePackageQuantity,
  parsePaymentSchedule,
  parseRequiredText,
  type FieldProblem,
  type FieldResult,
} from "./fields";
import { cellAddress, EMPTY_CELL, isBlankCell, type SheetCell, type SheetData } from "./sheet";
import type {
  ImportIssue,
  ImportSummary,
  InvoiceGroup,
  IssueSeverity,
  SalesImportOptions,
  SalesImportResult,
  SalesLine,
  SheetSelection,
} from "./types";

const FIELD_BY_HEADER = new Map<string, SalesField>(
  SOURCE_COLUMNS.map(({ header, field }) => [normalizeHeader(header), field]),
);

/** Attributes every line of one invoice must share. */
const INVOICE_ATTRIBUTES = [
  "customerId",
  "billingDate",
  "sellerName",
  "businessUnit",
  "paymentSchedule",
] as const satisfies ReadonlyArray<keyof SalesLine & SalesField>;

export function assertImportOptions(options: SalesImportOptions): void {
  if (typeof options.importId !== "string" || options.importId.trim() === "") {
    throw new TypeError("importId must be a non-empty string");
  }
  if (options.invoiceIdentity !== "invoice-number-unique-within-import") {
    throw new TypeError("invoiceIdentity must be 'invoice-number-unique-within-import'");
  }
  const format = options.textDateFormat;
  if (format !== undefined && format !== "YYYY-MM-DD" && format !== "DD/MM/YYYY") {
    throw new TypeError("textDateFormat must be 'YYYY-MM-DD' or 'DD/MM/YYYY'");
  }
  const bps = options.expectedCommissionBasisPoints;
  if (bps !== undefined && !(Number.isInteger(bps) && bps >= 0 && bps <= 10_000)) {
    throw new TypeError("expectedCommissionBasisPoints must be an integer from 0 to 10000");
  }
  resolveInputLimits(options.limits);
}

function emptySummary(overrides: Partial<ImportSummary> = {}): ImportSummary {
  return { dataRows: 0, blankRowsSkipped: 0, validRows: 0, rowsWithErrors: 0, rowsValidated: false, ...overrides };
}

export function rejectWithoutSheet(
  importId: string,
  sheet: string | null,
  issue: Omit<ImportIssue, "severity" | "sheet" | "row" | "cell" | "column" | "field">,
): Extract<SalesImportResult, { status: "rejected" }> {
  return {
    status: "rejected",
    importId,
    sheet,
    issues: [{ severity: "error", sheet, row: null, cell: null, column: null, field: null, ...issue }],
    summary: emptySummary(),
  };
}

export function selectSheet(
  sheetNames: string[],
  selection: SheetSelection,
): { ok: true; name: string } | { ok: false; issue: Pick<ImportIssue, "code" | "message" | "suggestion"> } {
  const available = sheetNames.map((name) => `"${name}"`).join(", ") || "none";
  if ("name" in selection) {
    return sheetNames.includes(selection.name)
      ? { ok: true, name: selection.name }
      : {
          ok: false,
          issue: {
            code: "SHEET_NOT_FOUND",
            message: `The workbook has no sheet named "${selection.name}". Sheets: ${available}.`,
            suggestion: "Choose the sales sheet by its exact name. Reference tabs are never merged in.",
          },
        };
  }
  const [only] = sheetNames;
  return sheetNames.length === 1 && only !== undefined
    ? { ok: true, name: only }
    : {
        ok: false,
        issue: {
          code: "SHEET_SELECTION_AMBIGUOUS",
          message: `This workbook has ${sheetNames.length} sheets (${available}); the sales export has one.`,
          suggestion: "Choose the sheet that holds the sales rows, or upload the single-sheet export itself.",
        },
      };
}

function formatBrl(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const integer = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}R$ ${integer},${fraction}`;
}

/** Half-up rounding of a non-negative amount × basis points, in integer arithmetic. */
function commissionAtRate(amountCents: number, basisPoints: number): bigint {
  return (BigInt(amountCents) * BigInt(basisPoints) + 5_000n) / 10_000n;
}

interface ParsedRow {
  row: number;
  values: Partial<SalesLine>;
  hasError: boolean;
}

export function validateSalesSheet(sheet: SheetData, options: SalesImportOptions): SalesImportResult {
  assertImportOptions(options);
  const { importId } = options;
  const textDateFormat = options.textDateFormat ?? "YYYY-MM-DD";
  const issues: ImportIssue[] = [];
  const columns = new Map<SalesField, number>();

  const push = (
    severity: IssueSeverity,
    row: number | null,
    field: SalesField | null,
    problem: FieldProblem,
    extra: Partial<ImportIssue> = {},
  ) => {
    const columnIndex = field ? columns.get(field) : undefined;
    issues.push({
      severity,
      code: problem.code,
      sheet: sheet.name,
      row,
      cell: row !== null && columnIndex !== undefined ? cellAddress(columnIndex, row) : null,
      column: field ? HEADER_BY_FIELD[field] : null,
      field,
      message: problem.message,
      suggestion: problem.suggestion,
      ...extra,
    });
  };

  // --- Header -----------------------------------------------------------------------------
  const headerRow = sheet.rows[0] ?? [];
  headerRow.forEach((cell, index) => {
    if (isBlankCell(cell)) return;
    const address = cellAddress(index, 1);
    if (cell.kind !== "text") {
      push("error", 1, null, {
        code: "HEADER_INVALID_CELL",
        message: `Header cell ${address} is not plain text.`,
        suggestion: "Use plain, unmerged text headers in row 1.",
      }, { cell: address });
      return;
    }
    const field = FIELD_BY_HEADER.get(normalizeHeader(cell.text));
    if (!field) {
      push("warning", 1, null, {
        code: "HEADER_UNKNOWN_COLUMN",
        message: `Column ${address} "${cell.text.trim()}" is not part of the import contract and is ignored.`,
        suggestion: "Remove the column, or rename it if it is a misspelled contract column.",
      }, { cell: address, column: cell.text.trim() });
      return;
    }
    const first = columns.get(field);
    if (first !== undefined) {
      push("error", 1, null, {
        code: "HEADER_DUPLICATE_COLUMN",
        message: `"${HEADER_BY_FIELD[field]}" appears in both ${cellAddress(first, 1)} and ${address}.`,
        suggestion: "Keep exactly one column per contract field.",
      }, { cell: address, column: HEADER_BY_FIELD[field], field });
      return;
    }
    columns.set(field, index);
  });
  for (const { header, field } of SOURCE_COLUMNS) {
    if (!columns.has(field)) {
      push("error", 1, field, {
        code: "HEADER_MISSING_COLUMN",
        message: `Required column "${header}" is missing from row 1.`,
        suggestion: `Add a "${header}" column using the source spelling.`,
      });
    }
  }

  const bodyRows = sheet.rows.slice(1).map((cells, index) => ({ row: index + 2, cells }));
  const dataRows = bodyRows.filter(({ cells }) => !cells.every(isBlankCell));
  const blankRowsSkipped = bodyRows.length - dataRows.length;

  if (issues.some((issue) => issue.severity === "error")) {
    return {
      status: "rejected",
      importId,
      sheet: sheet.name,
      issues,
      summary: emptySummary({ dataRows: dataRows.length, blankRowsSkipped }),
    };
  }

  // --- Rows -------------------------------------------------------------------------------
  const parsedRows = dataRows.map(({ row, cells }): ParsedRow => {
    const parsed: ParsedRow = { row, values: {}, hasError: false };
    const cellOf = (field: SalesField): SheetCell => cells[columns.get(field) ?? -1] ?? EMPTY_CELL;
    const error = (field: SalesField, problem: FieldProblem) => {
      parsed.hasError = true;
      push("error", row, field, problem);
    };
    const take = <K extends keyof SalesLine & SalesField>(field: K, result: FieldResult<SalesLine[K]>) => {
      if (result.ok) parsed.values[field] = result.value;
      else error(field, result.problem);
    };
    const h = HEADER_BY_FIELD;

    // Billing date is authoritative; day/month/year columns must agree with it when present.
    const date = parseBillingDate(cellOf("billingDate"), h.billingDate, textDateFormat);
    if (!date.ok) error("billingDate", date.problem);
    const components = {
      billingDay: parseDateComponent(cellOf("billingDay"), h.billingDay, "day"),
      billingMonth: parseDateComponent(cellOf("billingMonth"), h.billingMonth, "month"),
      billingYear: parseDateComponent(cellOf("billingYear"), h.billingYear, "year"),
    };
    for (const [field, result] of Object.entries(components) as Array<
      [keyof typeof components, FieldResult<number | null>]
    >) {
      if (!result.ok) error(field, result.problem);
    }
    if (date.ok) {
      const [year, month, day] = date.value.split("-").map(Number);
      const given = {
        billingDay: components.billingDay.ok ? components.billingDay.value : null,
        billingMonth: components.billingMonth.ok ? components.billingMonth.value : null,
        billingYear: components.billingYear.ok ? components.billingYear.value : null,
      };
      const swapped =
        day !== month &&
        given.billingDay === month &&
        given.billingMonth === day &&
        (given.billingYear === null || given.billingYear === year);
      if (swapped) {
        error("billingDate", {
          code: "DATE_DAY_MONTH_SWAPPED",
          message: `${h.billingDate} is ${date.value}, but ${h.billingDay}/${h.billingMonth} say day ${given.billingDay}, month ${given.billingMonth}. Day and month may be swapped.`,
          suggestion: "Confirm the intended date and correct the source. The importer does not choose either value.",
        });
      } else {
        const expected = { billingDay: day, billingMonth: month, billingYear: year };
        let mismatch = false;
        for (const field of ["billingDay", "billingMonth", "billingYear"] as const) {
          if (given[field] !== null && given[field] !== expected[field]) {
            mismatch = true;
            error(field, {
              code: "DATE_COMPONENT_MISMATCH",
              message: `${h[field]} is ${given[field]}, but ${h.billingDate} ${date.value} implies ${expected[field]}.`,
              suggestion: `Confirm the intended billing date, then correct ${h.billingDate} or ${h[field]}.`,
            });
          }
        }
        if (!mismatch) parsed.values.billingDate = date.value;
      }
    }

    take("invoiceNumber", parseIdentifier(cellOf("invoiceNumber"), h.invoiceNumber, true));
    take("customerName", parseRequiredText(cellOf("customerName"), h.customerName));
    take("customerState", parseOptionalText(cellOf("customerState"), h.customerState));
    take("customerCity", parseOptionalText(cellOf("customerCity"), h.customerCity));
    take("productCategory", parseRequiredText(cellOf("productCategory"), h.productCategory));
    take("productUsage", parseOptionalText(cellOf("productUsage"), h.productUsage));
    take("productId", parseIdentifier(cellOf("productId"), h.productId, true));
    take("productName", parseRequiredText(cellOf("productName"), h.productName));
    take("productType", parseOptionalText(cellOf("productType"), h.productType));
    take("sellerName", parseRequiredText(cellOf("sellerName"), h.sellerName));
    take("businessUnit", parseBusinessUnit(cellOf("businessUnit"), h.businessUnit));
    take("paymentSchedule", parsePaymentSchedule(cellOf("paymentSchedule"), h.paymentSchedule));
    take("packageQuantity", parsePackageQuantity(cellOf("packageQuantity"), h.packageQuantity));
    take("lineAmountCents", parseMoneyCents(cellOf("lineAmountCents"), h.lineAmountCents, "positive"));
    take(
      "commissionAmountCents",
      parseMoneyCents(cellOf("commissionAmountCents"), h.commissionAmountCents, "non-negative"),
    );
    take("sourceWeight", parseOptionalText(cellOf("sourceWeight"), h.sourceWeight));
    take("unitPriceCents", parseMoneyCents(cellOf("unitPriceCents"), h.unitPriceCents, "positive"));
    take("sourceMeasurementUnit", parseOptionalText(cellOf("sourceMeasurementUnit"), h.sourceMeasurementUnit));
    take("taxId", parseIdentifier(cellOf("taxId"), h.taxId, false));
    take("customerId", parseIdentifier(cellOf("customerId"), h.customerId, true));

    const { packageQuantity, unitPriceCents, lineAmountCents, commissionAmountCents } = parsed.values;
    if (packageQuantity !== undefined && unitPriceCents !== undefined && lineAmountCents !== undefined) {
      const expected = BigInt(packageQuantity) * BigInt(unitPriceCents);
      if (expected !== BigInt(lineAmountCents)) {
        error("lineAmountCents", {
          code: "LINE_AMOUNT_MISMATCH",
          message: `${h.lineAmountCents} is ${formatBrl(BigInt(lineAmountCents))}, but ${h.packageQuantity} × ${h.unitPriceCents} is ${formatBrl(expected)}.`,
          suggestion: "Correct the quantity, unit price or line amount so they reconcile exactly.",
        });
      }
    }
    const bps = options.expectedCommissionBasisPoints;
    if (bps !== undefined && lineAmountCents !== undefined && commissionAmountCents !== undefined) {
      const expected = commissionAtRate(lineAmountCents, bps);
      if (expected !== BigInt(commissionAmountCents)) {
        push("warning", row, "commissionAmountCents", {
          code: "COMMISSION_RATE_MISMATCH",
          message: `${h.commissionAmountCents} is ${formatBrl(BigInt(commissionAmountCents))}; ${(bps / 100).toFixed(2)}% of the line amount, rounded half-up, is ${formatBrl(expected)}.`,
          suggestion: "Confirm whether this line uses a different commission rate. The recorded amount is kept.",
        });
      }
    }
    return parsed;
  });

  // --- Invoice consistency (invoice number asserted unique within this import) ------------
  const byInvoice = new Map<string, ParsedRow[]>();
  for (const parsed of parsedRows) {
    const invoiceNumber = parsed.values.invoiceNumber;
    if (invoiceNumber === undefined) continue;
    const group = byInvoice.get(invoiceNumber);
    if (group) group.push(parsed);
    else byInvoice.set(invoiceNumber, [parsed]);
  }
  for (const group of byInvoice.values()) {
    for (const attribute of INVOICE_ATTRIBUTES) {
      const reference = group.find((parsed) => parsed.values[attribute] !== undefined);
      if (!reference) continue;
      for (const parsed of group) {
        const value = parsed.values[attribute];
        if (parsed === reference || value === undefined || value === reference.values[attribute]) continue;
        parsed.hasError = true;
        push(
          "error",
          parsed.row,
          attribute,
          {
            code: "INVOICE_ATTRIBUTE_CONFLICT",
            message: `${HEADER_BY_FIELD[attribute]} differs from row ${reference.row}, which has the same ${HEADER_BY_FIELD.invoiceNumber}.`,
            suggestion:
              "Make every line of the invoice agree, or give different invoices different numbers. Invoice numbers are treated as unique within this import.",
          },
          { relatedRows: [reference.row] },
        );
      }
    }
  }

  if (dataRows.length === 0) {
    push("error", null, null, {
      code: "NO_DATA_ROWS",
      message: "The sheet has a header but no sales rows.",
      suggestion: "Select the sheet that contains the invoice lines.",
    });
  }

  // --- Invoice totals (only meaningful when every line is valid) --------------------------
  const invoices: InvoiceGroup[] = [];
  const lines: SalesLine[] = [];
  if (!issues.some((issue) => issue.severity === "error")) {
    const invoiceIndex = new Map<string, InvoiceGroup>();
    for (const parsed of parsedRows) {
      const line = {
        lineId: `${importId}/${encodeURIComponent(sheet.name)}/${parsed.row}`,
        source: { importId, sheet: sheet.name, row: parsed.row },
        ...parsed.values,
      } as SalesLine;
      lines.push(line);
      let invoice = invoiceIndex.get(line.invoiceNumber);
      if (!invoice) {
        invoice = {
          invoiceNumber: line.invoiceNumber,
          customerId: line.customerId,
          billingDate: line.billingDate,
          sellerName: line.sellerName,
          businessUnit: line.businessUnit,
          paymentSchedule: line.paymentSchedule,
          lineIds: [],
          totalAmountCents: 0,
          totalCommissionCents: 0,
        };
        invoiceIndex.set(line.invoiceNumber, invoice);
        invoices.push(invoice);
      }
      invoice.lineIds.push(line.lineId);
      invoice.totalAmountCents += line.lineAmountCents;
      invoice.totalCommissionCents += line.commissionAmountCents;
      if (!Number.isSafeInteger(invoice.totalAmountCents) || !Number.isSafeInteger(invoice.totalCommissionCents)) {
        parsed.hasError = true;
        push("error", parsed.row, "lineAmountCents", {
          code: "TOTAL_OUT_OF_RANGE",
          message: "The invoice total exceeds the range that can be represented exactly in cents.",
          suggestion: "Check the amounts on this invoice's lines.",
        });
        break;
      }
    }
  }

  issues.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  const rowsWithErrors = parsedRows.filter((parsed) => parsed.hasError).length;
  const summary: ImportSummary = {
    dataRows: dataRows.length,
    blankRowsSkipped,
    validRows: dataRows.length - rowsWithErrors,
    rowsWithErrors,
    rowsValidated: true,
  };

  if (issues.some((issue) => issue.severity === "error")) {
    return { status: "rejected", importId, sheet: sheet.name, issues, summary };
  }
  return { status: "accepted", importId, sheet: sheet.name, lines, invoices, issues, summary };
}
