import type { SalesField } from "./columns";
import type { InputLimits } from "./limits";
import type { CalendarDate, TextDateFormat } from "./dates";

export type BusinessUnit = "AGRO" | "HOME_GARDEN";

export type PaymentSchedule =
  | "UPFRONT"
  | "NET_30"
  | "INSTALLMENTS_30_60_90"
  | "INSTALLMENTS_0_30_60_90";

export interface SourceRef {
  importId: string;
  sheet: string;
  /** 1-based spreadsheet row number, as the user sees it. */
  row: number;
}

/** One invoice product line (the source grain), not one invoice. */
export interface SalesLine {
  /** `importId/sheet/row`; stable within an import and independent of invoice/product values. */
  lineId: string;
  source: SourceRef;
  billingDate: CalendarDate;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  taxId: string | null;
  customerState: string | null;
  customerCity: string | null;
  productId: string;
  productName: string;
  productCategory: string;
  productUsage: string | null;
  productType: string | null;
  sellerName: string;
  businessUnit: BusinessUnit;
  paymentSchedule: PaymentSchedule;
  /** Count of packages, not mass or volume. */
  packageQuantity: number;
  unitPriceCents: number;
  lineAmountCents: number;
  commissionAmountCents: number;
  /** Raw source label; mass vs. volume is ambiguous in the source, so it is never converted. */
  sourceWeight: string | null;
  sourceMeasurementUnit: string | null;
}

/** Invoice-level attributes, grouped once from its lines within a single import. */
export interface InvoiceGroup {
  invoiceNumber: string;
  customerId: string;
  billingDate: CalendarDate;
  sellerName: string;
  businessUnit: BusinessUnit;
  paymentSchedule: PaymentSchedule;
  lineIds: string[];
  totalAmountCents: number;
  totalCommissionCents: number;
}

export type IssueSeverity = "error" | "warning";

export type IssueCode =
  | "WORKBOOK_UNREADABLE"
  | "INPUT_FILE_TOO_LARGE"
  | "INPUT_TOO_MANY_ENTRIES"
  | "INPUT_EXPANSION_TOO_LARGE"
  | "INPUT_TOO_MANY_MERGED_CELLS"
  | "INPUT_TOO_MANY_CELLS"
  | "INPUT_TOO_MANY_ROWS"
  | "INPUT_TOO_MANY_COLUMNS"
  | "SHEET_NOT_FOUND"
  | "SHEET_SELECTION_AMBIGUOUS"
  | "HEADER_MISSING_COLUMN"
  | "HEADER_DUPLICATE_COLUMN"
  | "HEADER_UNKNOWN_COLUMN"
  | "HEADER_INVALID_CELL"
  | "NO_DATA_ROWS"
  | "CELL_FORMULA"
  | "CELL_ERROR_VALUE"
  | "CELL_MERGED"
  | "CELL_UNSUPPORTED_TYPE"
  | "FIELD_REQUIRED"
  | "ID_INVALID"
  | "BUSINESS_UNIT_UNKNOWN"
  | "PAYMENT_TERM_UNKNOWN"
  | "QUANTITY_INVALID"
  | "MONEY_FORMAT"
  | "MONEY_PRECISION"
  | "MONEY_OUT_OF_RANGE"
  | "MONEY_NOT_FINITE"
  | "MONEY_NOT_POSITIVE"
  | "MONEY_NEGATIVE"
  | "LINE_AMOUNT_MISMATCH"
  | "COMMISSION_RATE_MISMATCH"
  | "DATE_NOT_A_DATE_CELL"
  | "DATE_TEXT_FORMAT"
  | "DATE_INVALID"
  | "DATE_HAS_TIME"
  | "DATE_OUT_OF_RANGE"
  | "DATE_COMPONENT_INVALID"
  | "DATE_COMPONENT_MISMATCH"
  | "DATE_DAY_MONTH_SWAPPED"
  | "INVOICE_ATTRIBUTE_CONFLICT"
  | "TOTAL_OUT_OF_RANGE";

/**
 * An actionable problem located in the source, meant for the person fixing the workbook.
 * Field-value messages do not quote mapped data cells, but `sheet`, `column`, `message` and
 * `suggestion` can contain workbook-controlled text (sheet names, unknown header text), which
 * may hold identity data. Treat issues as potentially sensitive: never log them whole; log only
 * `issueDiagnostics(issue)`.
 */
export interface ImportIssue {
  severity: IssueSeverity;
  code: IssueCode;
  sheet: string | null;
  row: number | null;
  /** A1-style address, e.g. `R7`. */
  cell: string | null;
  /** Source header as the contract spells it (or as found, for unknown headers). */
  column: string | null;
  field: SalesField | null;
  message: string;
  suggestion: string;
  /** Other rows involved, e.g. the first line of an invoice this row conflicts with. */
  relatedRows?: number[];
}

export type SheetSelection = { name: string } | { single: true };

export interface SalesImportOptions {
  /** Caller-assigned identifier; becomes part of every line ID. */
  importId: string;
  /** The sales sheet must be named explicitly; `single` accepts a workbook with exactly one sheet. */
  sheet: SheetSelection;
  /**
   * The only supported invoice identity: the invoice number is asserted unique within this
   * import. Numbers reused across series/issuers/years need an explicit identity field first.
   */
  invoiceIdentity: "invoice-number-unique-within-import";
  /** Format accepted for text dates. Excel date cells are always accepted. Default `YYYY-MM-DD`. */
  textDateFormat?: TextDateFormat;
  /**
   * Demo convention check (e.g. 500 = 5%), rounded half-up to the cent. Mismatches are warnings,
   * because the rate is not a company-wide rule. Omit to skip the check.
   */
  expectedCommissionBasisPoints?: number;
  /** Overrides for the resource limits in `DEFAULT_INPUT_LIMITS` (tests and deployment tuning). */
  limits?: Partial<InputLimits>;
}

export interface ImportSummary {
  /** Non-blank rows below the header. */
  dataRows: number;
  blankRowsSkipped: number;
  validRows: number;
  rowsWithErrors: number;
  /** False when header/sheet problems stopped validation before the rows were read. */
  rowsValidated: boolean;
}

export type SalesImportResult =
  | {
      status: "accepted";
      importId: string;
      sheet: string;
      lines: SalesLine[];
      invoices: InvoiceGroup[];
      /** Warnings only. */
      issues: ImportIssue[];
      summary: ImportSummary;
    }
  | {
      /** Any blocking error rejects the whole import; no partial lines are exposed. */
      status: "rejected";
      importId: string;
      sheet: string | null;
      issues: ImportIssue[];
      summary: ImportSummary;
      /** The workbook's sheet names, only when choosing the sheet failed, so the uploader can pick one. */
      sheetNames?: string[];
    };
