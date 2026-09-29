/**
 * Clean invoice-delivery JSON contract (decision 002). `validateDelivery` checks one parsed JSON
 * payload against the contract and the seller reference data. It returns either the typed
 * delivery or its located errors; a delivery is never partially accepted. Error paths are JSON
 * Pointers into the payload. Messages never quote payload values.
 *
 * Reachable from Node scripts through built-in type stripping, so relative imports keep their
 * `.ts` extension and type-only imports use `import type`.
 */
import { dueDatesRepresentable, MAX_CALENDAR_DATE } from "../collections/schedule.ts";
import { isValidCalendarDate, type CalendarDate } from "../sales-import/dates.ts";
import type { BusinessUnit, PaymentSchedule } from "../sales-import/types.ts";
import { cityKey, DEFAULT_FEED_REFERENCE, type FeedReference, type FeedSeller } from "./reference-data.ts";

export const BUSINESS_UNIT_LABELS: Readonly<Record<BusinessUnit, string>> = {
  AGRO: "Agro",
  HOME_GARDEN: "Home & Garden",
};

/** Labels as the data contract spells them; day offsets are in `docs/data-contract.md`. */
export const PAYMENT_SCHEDULE_LABELS: Readonly<Record<PaymentSchedule, string>> = {
  UPFRONT: "Upfront",
  NET_30: "30 Days",
  INSTALLMENTS_30_60_90: "3 installments (30, 60 and 90 days)",
  INSTALLMENTS_0_30_60_90: "4 installments (Upfront, 30, 60 and 90 days)",
};

/** Demo convention: commission is 5% of the line amount, rounded half-up to the cent. */
export const COMMISSION_BASIS_POINTS = 500;

export function commissionCents(lineAmountCents: number): number {
  return Number((BigInt(lineAmountCents) * BigInt(COMMISSION_BASIS_POINTS) + 5000n) / 10000n);
}

export const DELIVERY_LIMITS = {
  maxInvoices: 5000,
  maxLinesPerInvoice: 200,
  maxIdLength: 64,
  maxTextLength: 200,
  /** Errors beyond this are counted as `truncated`, not returned. */
  maxErrors: 200,
} as const;

/** Every field is required; any other field is rejected. */
export const DELIVERY_FIELDS = ["deliveryId", "invoices"] as const;
export const INVOICE_FIELDS = [
  "invoiceNumber",
  "billingDate",
  "customer",
  "sellerId",
  "businessUnit",
  "paymentSchedule",
  "lines",
] as const;
export const CUSTOMER_FIELDS = ["id", "name", "segment", "city", "state"] as const;
export const LINE_FIELDS = [
  "productId",
  "productName",
  "productCategory",
  "packageQuantity",
  "unitPriceCents",
  "lineAmountCents",
  "commissionAmountCents",
] as const;

export interface FeedCustomer {
  id: string;
  name: string;
  segment: string;
  city: string;
  /** Two-letter state code (UF). */
  state: string;
}

/** One invoice product line. The same product may appear on several lines of one invoice. */
export interface FeedLine {
  productId: string;
  productName: string;
  productCategory: string;
  /** Count of packages, not mass or volume. */
  packageQuantity: number;
  unitPriceCents: number;
  lineAmountCents: number;
  commissionAmountCents: number;
}

/** An invoice as sent: business unit and payment schedule use their contract labels. */
export interface InvoicePayload {
  invoiceNumber: string;
  billingDate: CalendarDate;
  customer: FeedCustomer;
  sellerId: string;
  businessUnit: string;
  paymentSchedule: string;
  lines: FeedLine[];
}

export interface DeliveryPayload {
  deliveryId: string;
  invoices: InvoicePayload[];
}

export interface FeedInvoice {
  invoiceNumber: string;
  billingDate: CalendarDate;
  customer: FeedCustomer;
  sellerId: string;
  businessUnit: BusinessUnit;
  paymentSchedule: PaymentSchedule;
  lines: FeedLine[];
}

export interface FeedDelivery {
  deliveryId: string;
  invoices: FeedInvoice[];
}

export const DELIVERY_ERROR_CODES = [
  "TYPE_INVALID",
  "FIELD_REQUIRED",
  "FIELD_UNKNOWN",
  "DELIVERY_ID_INVALID",
  "TEXT_INVALID",
  "DATE_INVALID",
  "LIST_EMPTY",
  "LIST_TOO_LONG",
  "QUANTITY_INVALID",
  "MONEY_INVALID",
  "LINE_AMOUNT_MISMATCH",
  "COMMISSION_MISMATCH",
  "BUSINESS_UNIT_UNKNOWN",
  "PAYMENT_SCHEDULE_UNKNOWN",
  "SELLER_UNKNOWN",
  "BUSINESS_UNIT_SELLER_MISMATCH",
  "CITY_OUTSIDE_TERRITORY",
  "CUSTOMER_SELLER_MISMATCH",
  "CUSTOMER_ATTRIBUTE_CONFLICT",
  "PRODUCT_ATTRIBUTE_CONFLICT",
  "INVOICE_DUPLICATE",
  "TOTAL_OUT_OF_RANGE",
] as const;

export type DeliveryErrorCode = (typeof DELIVERY_ERROR_CODES)[number];

export interface DeliveryError {
  code: DeliveryErrorCode;
  /** JSON Pointer to the offending value, e.g. `/invoices/3/lines/0/lineAmountCents`. */
  path: string;
  /** The invoice's number when it could be read, so the error can be found without counting. */
  invoiceNumber: string | null;
  message: string;
  /** Another location involved, e.g. the first occurrence of a repeated invoice number. */
  relatedPath?: string;
}

export interface DeliverySummary {
  invoiceCount: number;
  lineCount: number;
  salesCents: number;
  commissionCents: number;
  firstBillingDate: CalendarDate;
  lastBillingDate: CalendarDate;
}

export type DeliveryValidation =
  | { ok: true; delivery: FeedDelivery; summary: DeliverySummary }
  | { ok: false; errors: DeliveryError[]; truncated: boolean };

export interface ValidateDeliveryOptions {
  reference?: FeedReference;
  /** Owning seller of an already-stored customer, or undefined for a customer not stored yet. */
  customerOwner?: (customerId: string) => string | undefined;
  /** Business unit of an already-stored product, or undefined for a product not stored yet. */
  productBusinessUnit?: (productId: string) => BusinessUnit | undefined;
}

// Maps, not object lookups: an object would also "find" inherited keys like "constructor".
const BUSINESS_UNIT_BY_LABEL = new Map(
  (Object.entries(BUSINESS_UNIT_LABELS) as [BusinessUnit, string][]).map(([code, label]) => [label, code]),
);
const PAYMENT_SCHEDULE_BY_LABEL = new Map(
  (Object.entries(PAYMENT_SCHEDULE_LABELS) as [PaymentSchedule, string][]).map(([code, label]) => [label, code]),
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The payload's `deliveryId` when it is valid, whatever the rest of the payload holds. */
export function peekDeliveryId(input: unknown): string | null {
  if (!isJsonObject(input) || !Object.hasOwn(input, "deliveryId")) return null;
  const id = input.deliveryId;
  return typeof id === "string" && UUID.test(id) ? id : null;
}
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_KEY_IN_PATH = 64;

function pointer(segment: string | number): string {
  return `/${String(segment).replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

class Problems {
  readonly errors: DeliveryError[] = [];
  truncated = false;

  add(error: DeliveryError): void {
    if (this.errors.length < DELIVERY_LIMITS.maxErrors) this.errors.push(error);
    else this.truncated = true;
  }
}

interface Location {
  path: string;
  invoiceNumber: string | null;
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isCleanText(text: string, maxLength: number): boolean {
  if (text.length === 0 || text.length > maxLength || text.trim() !== text) return false;
  if (text.normalize("NFC") !== text) return false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/** Reports unknown, missing and null fields. Returns null if the value is not an object. */
function readObject(
  value: unknown,
  at: Location,
  fields: readonly string[],
  problems: Problems,
): JsonObject | null {
  if (!isJsonObject(value)) {
    problems.add({ code: "TYPE_INVALID", ...at, message: "Expected a JSON object." });
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) {
      problems.add({
        code: "FIELD_UNKNOWN",
        path: at.path + pointer(key.slice(0, MAX_KEY_IN_PATH)),
        invoiceNumber: at.invoiceNumber,
        message: "This field is not part of the delivery contract.",
      });
    }
  }
  for (const key of fields) {
    if (!Object.hasOwn(value, key) || value[key] === null) {
      problems.add({
        code: "FIELD_REQUIRED",
        path: at.path + pointer(key),
        invoiceNumber: at.invoiceNumber,
        message: `${key} is required.`,
      });
    }
  }
  return value;
}

class FieldReader {
  private readonly record: JsonObject;
  private readonly at: Location;
  private readonly problems: Problems;

  constructor(record: JsonObject, at: Location, problems: Problems) {
    this.record = record;
    this.at = at;
    this.problems = problems;
  }

  location(key: string): Location {
    return { path: this.at.path + pointer(key), invoiceNumber: this.at.invoiceNumber };
  }

  report(key: string, code: DeliveryErrorCode, message: string, relatedPath?: string): void {
    this.problems.add({ code, ...this.location(key), message, ...(relatedPath ? { relatedPath } : {}) });
  }

  /** Missing and null fields were already reported by `readObject`. */
  private value(key: string): unknown {
    return Object.hasOwn(this.record, key) ? (this.record[key] ?? undefined) : undefined;
  }

  text(key: string, maxLength: number): string | null {
    const value = this.value(key);
    if (value === undefined) return null;
    if (typeof value !== "string") {
      this.report(key, "TYPE_INVALID", `${key} must be a string.`);
      return null;
    }
    if (!isCleanText(value, maxLength)) {
      this.report(
        key,
        "TEXT_INVALID",
        `${key} must be non-empty text of at most ${maxLength} characters, in Unicode NFC form, without surrounding spaces or control characters.`,
      );
      return null;
    }
    return value;
  }

  deliveryId(key: string): string | null {
    const value = this.value(key);
    if (value === undefined) return null;
    if (typeof value !== "string" || !UUID.test(value)) {
      this.report(key, "DELIVERY_ID_INVALID", `${key} must be a UUID in lowercase canonical form.`);
      return null;
    }
    return value;
  }

  date(key: string): CalendarDate | null {
    const value = this.value(key);
    if (value === undefined) return null;
    const match = typeof value === "string" ? ISO_DATE.exec(value) : null;
    if (!match || !isValidCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
      this.report(key, "DATE_INVALID", `${key} must be a real calendar date written as YYYY-MM-DD.`);
      return null;
    }
    return value as CalendarDate;
  }

  label<T>(key: string, labels: ReadonlyMap<string, T>, code: DeliveryErrorCode, message: string): T | null {
    const value = this.value(key);
    if (value === undefined) return null;
    if (typeof value !== "string") {
      this.report(key, "TYPE_INVALID", `${key} must be a string.`);
      return null;
    }
    const found = labels.get(value);
    if (found === undefined) {
      this.report(key, code, message);
      return null;
    }
    return found;
  }

  integer(key: string, min: number, code: DeliveryErrorCode, message: string): number | null {
    const value = this.value(key);
    if (value === undefined) return null;
    if (typeof value !== "number") {
      this.report(key, "TYPE_INVALID", `${key} must be a JSON number.`);
      return null;
    }
    if (!Number.isSafeInteger(value) || value < min) {
      this.report(key, code, message);
      return null;
    }
    return value;
  }

  array(key: string, maxItems: number): unknown[] | null {
    const value = this.value(key);
    if (value === undefined) return null;
    if (!Array.isArray(value)) {
      this.report(key, "TYPE_INVALID", `${key} must be a JSON array.`);
      return null;
    }
    if (value.length === 0) {
      this.report(key, "LIST_EMPTY", `${key} must contain at least one item.`);
      return null;
    }
    if (value.length > maxItems) {
      this.report(key, "LIST_TOO_LONG", `${key} may contain at most ${maxItems} items.`);
      return null;
    }
    return value;
  }

  object(key: string, fields: readonly string[]): JsonObject | null {
    const value = this.value(key);
    if (value === undefined) return null;
    return readObject(value, this.location(key), fields, this.problems);
  }
}

function readLine(value: unknown, at: Location, problems: Problems): FeedLine | null {
  const record = readObject(value, at, LINE_FIELDS, problems);
  if (!record) return null;
  const read = new FieldReader(record, at, problems);
  const productId = read.text("productId", DELIVERY_LIMITS.maxIdLength);
  const productName = read.text("productName", DELIVERY_LIMITS.maxTextLength);
  const productCategory = read.text("productCategory", DELIVERY_LIMITS.maxTextLength);
  const packageQuantity = read.integer(
    "packageQuantity",
    1,
    "QUANTITY_INVALID",
    "packageQuantity must be a whole number of packages of at least 1.",
  );
  const unitPriceCents = read.integer(
    "unitPriceCents",
    1,
    "MONEY_INVALID",
    "unitPriceCents must be a whole number of cents greater than zero.",
  );
  const lineAmountCents = read.integer(
    "lineAmountCents",
    1,
    "MONEY_INVALID",
    "lineAmountCents must be a whole number of cents greater than zero.",
  );
  const commission = read.integer(
    "commissionAmountCents",
    0,
    "MONEY_INVALID",
    "commissionAmountCents must be a whole, non-negative number of cents.",
  );
  let consistent = true;
  if (packageQuantity !== null && unitPriceCents !== null && lineAmountCents !== null) {
    const expected = packageQuantity * unitPriceCents;
    if (!Number.isSafeInteger(expected) || expected !== lineAmountCents) {
      read.report(
        "lineAmountCents",
        "LINE_AMOUNT_MISMATCH",
        "lineAmountCents must equal packageQuantity × unitPriceCents exactly.",
      );
      consistent = false;
    }
  }
  if (lineAmountCents !== null && commission !== null && commissionCents(lineAmountCents) !== commission) {
    read.report(
      "commissionAmountCents",
      "COMMISSION_MISMATCH",
      "commissionAmountCents must be 5% of lineAmountCents, rounded half-up to the cent.",
    );
    consistent = false;
  }
  if (
    !consistent ||
    productId === null ||
    productName === null ||
    productCategory === null ||
    packageQuantity === null ||
    unitPriceCents === null ||
    lineAmountCents === null ||
    commission === null
  ) {
    return null;
  }
  return {
    productId,
    productName,
    productCategory,
    packageQuantity,
    unitPriceCents,
    lineAmountCents,
    commissionAmountCents: commission,
  };
}

/** What could be read from one invoice; null parts were reported. */
interface InvoiceDraft {
  path: string;
  invoiceNumber: string | null;
  billingDate: CalendarDate | null;
  customer: FeedCustomer | null;
  sellerId: string | null;
  businessUnit: BusinessUnit | null;
  paymentSchedule: PaymentSchedule | null;
  /** Null when the list itself is unusable; a null entry is a line with errors. */
  lines: (FeedLine | null)[] | null;
}

function peekInvoiceNumber(value: unknown): string | null {
  if (!isJsonObject(value) || !Object.hasOwn(value, "invoiceNumber")) return null;
  const number = value.invoiceNumber;
  return typeof number === "string" && isCleanText(number, DELIVERY_LIMITS.maxIdLength) ? number : null;
}

function readInvoice(value: unknown, path: string, problems: Problems): InvoiceDraft | null {
  const at: Location = { path, invoiceNumber: peekInvoiceNumber(value) };
  const record = readObject(value, at, INVOICE_FIELDS, problems);
  if (!record) return null;
  const read = new FieldReader(record, at, problems);
  const invoiceNumber = read.text("invoiceNumber", DELIVERY_LIMITS.maxIdLength);
  const billingDate = read.date("billingDate");
  const sellerId = read.text("sellerId", DELIVERY_LIMITS.maxIdLength);
  const businessUnit = read.label(
    "businessUnit",
    BUSINESS_UNIT_BY_LABEL,
    "BUSINESS_UNIT_UNKNOWN",
    'businessUnit must be "Agro" or "Home & Garden".',
  );
  const paymentSchedule = read.label(
    "paymentSchedule",
    PAYMENT_SCHEDULE_BY_LABEL,
    "PAYMENT_SCHEDULE_UNKNOWN",
    "paymentSchedule must be one of the four contract payment schedules, spelled exactly.",
  );
  if (billingDate !== null && paymentSchedule !== null && !dueDatesRepresentable(billingDate, paymentSchedule)) {
    read.report(
      "billingDate",
      "DATE_INVALID",
      `billingDate is too late for its payment schedule: an installment would fall due after ${MAX_CALENDAR_DATE}.`,
    );
  }

  let customer: FeedCustomer | null = null;
  const customerRecord = read.object("customer", CUSTOMER_FIELDS);
  if (customerRecord) {
    const customerAt = read.location("customer");
    const readCustomer = new FieldReader(customerRecord, customerAt, problems);
    const id = readCustomer.text("id", DELIVERY_LIMITS.maxIdLength);
    const name = readCustomer.text("name", DELIVERY_LIMITS.maxTextLength);
    const segment = readCustomer.text("segment", DELIVERY_LIMITS.maxTextLength);
    const city = readCustomer.text("city", DELIVERY_LIMITS.maxTextLength);
    const state = readCustomer.text("state", DELIVERY_LIMITS.maxIdLength);
    if (id !== null && name !== null && segment !== null && city !== null && state !== null) {
      customer = { id, name, segment, city, state };
    }
  }

  const items = read.array("lines", DELIVERY_LIMITS.maxLinesPerInvoice);
  const lines = items
    ? items.map((item, index) =>
        readLine(item, { path: `${path}/lines/${index}`, invoiceNumber: at.invoiceNumber }, problems),
      )
    : null;

  return { path, invoiceNumber, billingDate, customer, sellerId, businessUnit, paymentSchedule, lines };
}

function checkAcrossInvoices(
  drafts: readonly InvoiceDraft[],
  reference: FeedReference,
  { customerOwner, productBusinessUnit }: ValidateDeliveryOptions,
  problems: Problems,
): void {
  const invoiceByNumber = new Map<string, InvoiceDraft>();
  const firstCustomer = new Map<string, InvoiceDraft & { customer: FeedCustomer }>();
  const firstProduct = new Map<string, { path: string; line: FeedLine; businessUnit: BusinessUnit | null }>();

  for (const draft of drafts) {
    const at = (field: string): Location => ({ path: `${draft.path}${field}`, invoiceNumber: draft.invoiceNumber });
    const add = (code: DeliveryErrorCode, field: string, message: string, relatedPath?: string) =>
      problems.add({ code, ...at(field), message, ...(relatedPath ? { relatedPath } : {}) });

    if (draft.invoiceNumber !== null) {
      const first = invoiceByNumber.get(draft.invoiceNumber);
      if (first) {
        add(
          "INVOICE_DUPLICATE",
          "/invoiceNumber",
          "This invoice number already appears earlier in the delivery; each invoice is sent once per delivery.",
          `${first.path}/invoiceNumber`,
        );
      } else {
        invoiceByNumber.set(draft.invoiceNumber, draft);
      }
    }

    let seller: FeedSeller | undefined;
    if (draft.sellerId !== null) {
      seller = reference.sellers.get(draft.sellerId);
      if (!seller) add("SELLER_UNKNOWN", "/sellerId", "sellerId is not a known seller.");
    }
    if (seller && draft.businessUnit !== null && seller.seller.businessUnit !== draft.businessUnit) {
      add("BUSINESS_UNIT_SELLER_MISMATCH", "/businessUnit", "businessUnit must be the seller's business unit.");
    }
    const { customer } = draft;
    if (seller && customer && !seller.cityKeys.has(cityKey(customer.city, customer.state))) {
      add(
        "CITY_OUTSIDE_TERRITORY",
        "/customer/city",
        "The customer's city and state are not in the seller's territory; sellers only sell inside their own territory.",
      );
    }

    if (customer && draft.sellerId !== null) {
      const owner = customerOwner?.(customer.id);
      if (owner !== undefined && owner !== draft.sellerId) {
        add("CUSTOMER_SELLER_MISMATCH", "/sellerId", "This customer is already owned by another seller.");
      }
    }
    if (customer) {
      const first = firstCustomer.get(customer.id);
      if (!first) {
        firstCustomer.set(customer.id, { ...draft, customer });
      } else {
        for (const field of ["name", "segment", "city", "state"] as const) {
          if (first.customer[field] !== customer[field]) {
            add(
              "CUSTOMER_ATTRIBUTE_CONFLICT",
              `/customer/${field}`,
              `The same customer ID has a different ${field} earlier in this delivery.`,
              `${first.path}/customer/${field}`,
            );
          }
        }
        if (first.sellerId !== null && draft.sellerId !== null && first.sellerId !== draft.sellerId) {
          add(
            "CUSTOMER_SELLER_MISMATCH",
            "/sellerId",
            "The same customer has a different seller earlier in this delivery; each customer has one owning seller.",
            `${first.path}/sellerId`,
          );
        }
      }
    }

    draft.lines?.forEach((line, index) => {
      if (!line) return;
      const linePath = `/lines/${index}`;
      const storedUnit = productBusinessUnit?.(line.productId);
      if (storedUnit !== undefined && draft.businessUnit !== null && storedUnit !== draft.businessUnit) {
        add(
          "PRODUCT_ATTRIBUTE_CONFLICT",
          `${linePath}/productId`,
          "This product is already stored under the other business unit; a product belongs to one business unit.",
        );
      }
      const first = firstProduct.get(line.productId);
      if (!first) {
        firstProduct.set(line.productId, { path: `${draft.path}${linePath}`, line, businessUnit: draft.businessUnit });
        return;
      }
      for (const field of ["productName", "productCategory"] as const) {
        if (first.line[field] !== line[field]) {
          add(
            "PRODUCT_ATTRIBUTE_CONFLICT",
            `${linePath}/${field}`,
            `The same product ID has a different ${field} earlier in this delivery.`,
            `${first.path}/${field}`,
          );
        }
      }
      if (first.businessUnit !== null && draft.businessUnit !== null && first.businessUnit !== draft.businessUnit) {
        add(
          "PRODUCT_ATTRIBUTE_CONFLICT",
          `${linePath}/productId`,
          "The same product ID appears on invoices of both business units in this delivery.",
          `${first.path}/productId`,
        );
      }
    });
  }
}

function completeInvoice(draft: InvoiceDraft): FeedInvoice | null {
  const { invoiceNumber, billingDate, customer, sellerId, businessUnit, paymentSchedule, lines } = draft;
  if (
    invoiceNumber === null ||
    billingDate === null ||
    customer === null ||
    sellerId === null ||
    businessUnit === null ||
    paymentSchedule === null ||
    lines === null ||
    lines.some((line) => line === null)
  ) {
    return null;
  }
  return {
    invoiceNumber,
    billingDate,
    customer,
    sellerId,
    businessUnit,
    paymentSchedule,
    lines: lines as FeedLine[],
  };
}

function summarize(invoices: readonly FeedInvoice[]): DeliverySummary | null {
  let salesCents = 0;
  let commission = 0;
  let lineCount = 0;
  let firstBillingDate = invoices[0]!.billingDate;
  let lastBillingDate = firstBillingDate;
  for (const invoice of invoices) {
    if (invoice.billingDate < firstBillingDate) firstBillingDate = invoice.billingDate;
    if (invoice.billingDate > lastBillingDate) lastBillingDate = invoice.billingDate;
    for (const line of invoice.lines) {
      salesCents += line.lineAmountCents;
      commission += line.commissionAmountCents;
      lineCount += 1;
      if (!Number.isSafeInteger(salesCents) || !Number.isSafeInteger(commission)) return null;
    }
  }
  return {
    invoiceCount: invoices.length,
    lineCount,
    salesCents,
    commissionCents: commission,
    firstBillingDate,
    lastBillingDate,
  };
}

export function validateDelivery(input: unknown, options: ValidateDeliveryOptions = {}): DeliveryValidation {
  const reference = options.reference ?? DEFAULT_FEED_REFERENCE;
  const problems = new Problems();
  const failed = (): DeliveryValidation => ({ ok: false, errors: problems.errors, truncated: problems.truncated });

  const root: Location = { path: "", invoiceNumber: null };
  const record = readObject(input, root, DELIVERY_FIELDS, problems);
  if (!record) return failed();
  const read = new FieldReader(record, root, problems);
  const deliveryId = read.deliveryId("deliveryId");
  const items = read.array("invoices", DELIVERY_LIMITS.maxInvoices);
  const drafts = (items ?? []).map((item, index) => readInvoice(item, `/invoices/${index}`, problems));
  checkAcrossInvoices(
    drafts.filter((draft): draft is InvoiceDraft => draft !== null),
    reference,
    options,
    problems,
  );

  const invoices = drafts.map((draft) => (draft ? completeInvoice(draft) : null));
  if (problems.errors.length > 0 || problems.truncated || deliveryId === null || items === null) return failed();
  if (invoices.some((invoice) => invoice === null)) throw new Error("Unreported invalid invoice");
  const complete = invoices as FeedInvoice[];
  const summary = summarize(complete);
  if (!summary) {
    problems.add({
      code: "TOTAL_OUT_OF_RANGE",
      path: "/invoices",
      invoiceNumber: null,
      message: "The delivery's total is too large to represent exactly in cents.",
    });
    return failed();
  }
  return { ok: true, delivery: { deliveryId, invoices: complete }, summary };
}

/** Serializes a typed delivery back to the wire format, with fields in contract order. */
export function toDeliveryPayload(delivery: FeedDelivery): DeliveryPayload {
  return {
    deliveryId: delivery.deliveryId,
    invoices: delivery.invoices.map((invoice) => ({
      invoiceNumber: invoice.invoiceNumber,
      billingDate: invoice.billingDate,
      customer: {
        id: invoice.customer.id,
        name: invoice.customer.name,
        segment: invoice.customer.segment,
        city: invoice.customer.city,
        state: invoice.customer.state,
      },
      sellerId: invoice.sellerId,
      businessUnit: BUSINESS_UNIT_LABELS[invoice.businessUnit],
      paymentSchedule: PAYMENT_SCHEDULE_LABELS[invoice.paymentSchedule],
      lines: invoice.lines.map((line) => ({
        productId: line.productId,
        productName: line.productName,
        productCategory: line.productCategory,
        packageQuantity: line.packageQuantity,
        unitPriceCents: line.unitPriceCents,
        lineAmountCents: line.lineAmountCents,
        commissionAmountCents: line.commissionAmountCents,
      })),
    })),
  };
}
