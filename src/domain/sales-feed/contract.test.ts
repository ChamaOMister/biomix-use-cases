import { describe, expect, it } from "vitest";
import {
  commissionCents,
  DELIVERY_LIMITS,
  peekDeliveryId,
  toDeliveryPayload,
  validateDelivery,
  type DeliveryError,
  type DeliveryValidation,
  type InvoicePayload,
} from "./contract";
import { buildFeedReference } from "./reference-data";

const DELIVERY_ID = "8b0c4c1e-4c7a-4f43-9d8e-2a3f0e6b9a11";

function line(overrides: Record<string, unknown> = {}) {
  return {
    productId: "P007",
    productName: "Fictional Foliar 1 L",
    productCategory: "Foliar fertilizer",
    packageQuantity: 12,
    unitPriceCents: 8990,
    lineAmountCents: 107880,
    commissionAmountCents: 5394,
    ...overrides,
  };
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    invoiceNumber: "000123",
    billingDate: "2025-06-12",
    customer: { id: "C0042", name: "Fictional Agro Ltda", segment: "agricultural reseller", city: "Viçosa", state: "MG" },
    sellerId: "S04",
    businessUnit: "Agro",
    paymentSchedule: "3 installments (30, 60 and 90 days)",
    lines: [line()],
    ...overrides,
  };
}

function homeGardenInvoice(overrides: Record<string, unknown> = {}) {
  return invoice({
    invoiceNumber: "000124",
    customer: { id: "C0100", name: "Fictional Garden", segment: "garden store", city: "São Paulo", state: "SP" },
    sellerId: "S01",
    businessUnit: "Home & Garden",
    paymentSchedule: "Upfront",
    lines: [
      line({
        productId: "P101",
        productName: "Fictional Plant Food",
        productCategory: "Garden fertilizer",
        packageQuantity: 3,
        unitPriceCents: 2490,
        lineAmountCents: 7470,
        commissionAmountCents: 374,
      }),
    ],
    ...overrides,
  });
}

function delivery(invoices: unknown[]) {
  return { deliveryId: DELIVERY_ID, invoices };
}

function errorsOf(result: DeliveryValidation): DeliveryError[] {
  if (result.ok) throw new Error("expected a rejected delivery");
  return result.errors;
}

function codesAt(result: DeliveryValidation): string[] {
  return errorsOf(result).map((error) => `${error.code} ${error.path}`);
}

describe("validateDelivery: accepted deliveries", () => {
  it("accepts a clean delivery and returns typed invoices with a summary", () => {
    const result = validateDelivery(
      delivery([
        invoice({
          lines: [
            line(),
            // The same product twice on one invoice is a valid, separate line.
            line({ packageQuantity: 1, lineAmountCents: 8990, commissionAmountCents: 450 }),
          ],
        }),
        homeGardenInvoice({ billingDate: "2025-06-02" }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.delivery.invoices.map((item) => [item.invoiceNumber, item.businessUnit, item.paymentSchedule])).toEqual([
      ["000123", "AGRO", "INSTALLMENTS_30_60_90"],
      ["000124", "HOME_GARDEN", "UPFRONT"],
    ]);
    expect(result.summary).toEqual({
      invoiceCount: 2,
      lineCount: 3,
      salesCents: 107880 + 8990 + 7470,
      commissionCents: 5394 + 450 + 374,
      firstBillingDate: "2025-06-02",
      lastBillingDate: "2025-06-12",
    });
  });

  it("keeps invoice numbers and IDs as strings with their leading zeroes", () => {
    const result = validateDelivery(delivery([invoice({ invoiceNumber: "000001" })]));
    expect(result.ok && result.delivery.invoices[0]?.invoiceNumber).toBe("000001");
  });

  it("accepts every contract payment schedule label", () => {
    for (const label of ["Upfront", "30 Days", "3 installments (30, 60 and 90 days)", "4 installments (Upfront, 30, 60 and 90 days)"]) {
      expect(validateDelivery(delivery([invoice({ paymentSchedule: label })])).ok).toBe(true);
    }
  });

  it("round-trips through toDeliveryPayload", () => {
    const payload = delivery([invoice(), homeGardenInvoice()]);
    const result = validateDelivery(payload);
    expect(result.ok && toDeliveryPayload(result.delivery)).toEqual(payload);
  });

  it("uses the reference data it is given", () => {
    const reference = buildFeedReference([
      {
        sellerId: "X1",
        name: "Fictional Seller",
        businessUnit: "AGRO",
        territory: "Fictional",
        cities: [{ city: "Fictional Town", state: "ZZ" }],
      },
    ]);
    const payload = delivery([
      invoice({ sellerId: "X1", customer: { ...invoice().customer, city: "Fictional Town", state: "ZZ" } }),
    ]);
    expect(validateDelivery(payload, { reference }).ok).toBe(true);
    expect(codesAt(validateDelivery(payload))).toEqual(["SELLER_UNKNOWN /invoices/0/sellerId"]);
  });
});

describe("validateDelivery: structure", () => {
  it("rejects a payload that is not a JSON object", () => {
    for (const payload of [null, [], "delivery", 42]) {
      expect(codesAt(validateDelivery(payload))).toEqual(["TYPE_INVALID "]);
    }
  });

  it("reports missing and null fields at every level with their paths", () => {
    const { customer, ...withoutCustomer } = invoice();
    void customer;
    const result = validateDelivery({
      deliveryId: null,
      invoices: [
        withoutCustomer,
        invoice({ invoiceNumber: "000199", customer: { id: "C1", name: "Fictional", segment: "farmer", city: "Viçosa" } }),
        invoice({ invoiceNumber: "000200", lines: [{ ...line(), unitPriceCents: null }] }),
      ],
    });
    expect(codesAt(result)).toEqual([
      "FIELD_REQUIRED /deliveryId",
      "FIELD_REQUIRED /invoices/0/customer",
      "FIELD_REQUIRED /invoices/1/customer/state",
      "FIELD_REQUIRED /invoices/2/lines/0/unitPriceCents",
    ]);
    expect(errorsOf(result)[3]?.invoiceNumber).toBe("000200");
  });

  it("rejects unknown fields, including inherited-looking names", () => {
    const payload = JSON.parse(
      JSON.stringify(delivery([{ ...invoice(), sellerID: "S04", lines: [{ ...line(), weight: "1 L" }] }])).replace(
        '"deliveryId"',
        '"__proto__":{"polluted":true},"constructor":1,"deliveryId"',
      ),
    );
    expect(codesAt(validateDelivery(payload))).toEqual([
      "FIELD_UNKNOWN /__proto__",
      "FIELD_UNKNOWN /constructor",
      "FIELD_UNKNOWN /invoices/0/sellerID",
      "FIELD_UNKNOWN /invoices/0/lines/0/weight",
    ]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects wrong JSON types without guessing", () => {
    const result = validateDelivery(
      delivery([invoice({ invoiceNumber: 123, lines: [line({ packageQuantity: "12", unitPriceCents: "89,90" })] })]),
    );
    expect(codesAt(result)).toEqual([
      "TYPE_INVALID /invoices/0/invoiceNumber",
      "TYPE_INVALID /invoices/0/lines/0/packageQuantity",
      "TYPE_INVALID /invoices/0/lines/0/unitPriceCents",
    ]);
  });

  it("requires a lowercase canonical UUID as deliveryId", () => {
    for (const deliveryId of ["delivery-1", DELIVERY_ID.toUpperCase(), `${DELIVERY_ID}0`, 7]) {
      expect(codesAt(validateDelivery({ deliveryId, invoices: [invoice()] }))).toEqual(["DELIVERY_ID_INVALID /deliveryId"]);
    }
  });

  it("requires at least one invoice and one line per invoice", () => {
    expect(codesAt(validateDelivery(delivery([])))).toEqual(["LIST_EMPTY /invoices"]);
    expect(codesAt(validateDelivery(delivery([invoice({ lines: [] })])))).toEqual(["LIST_EMPTY /invoices/0/lines"]);
  });

  it("rejects oversized lists without reading their items", () => {
    const invoices = Array.from({ length: DELIVERY_LIMITS.maxInvoices + 1 }, () => ({ bad: true }));
    expect(codesAt(validateDelivery(delivery(invoices)))).toEqual(["LIST_TOO_LONG /invoices"]);
    const lines = Array.from({ length: DELIVERY_LIMITS.maxLinesPerInvoice + 1 }, () => ({ bad: true }));
    expect(codesAt(validateDelivery(delivery([invoice({ lines })])))).toEqual(["LIST_TOO_LONG /invoices/0/lines"]);
  });
});

describe("validateDelivery: field values", () => {
  it("requires clean text: non-empty, trimmed, no control characters, NFC, bounded", () => {
    const bad = ["", " C0042", "C0042 ", "C00\n42", "Viçosa", "x".repeat(DELIVERY_LIMITS.maxIdLength + 1)];
    for (const id of bad) {
      const result = validateDelivery(delivery([invoice({ customer: { ...invoice().customer, id } })]));
      expect(codesAt(result)).toEqual(["TEXT_INVALID /invoices/0/customer/id"]);
    }
    const longName = "x".repeat(DELIVERY_LIMITS.maxTextLength + 1);
    expect(codesAt(validateDelivery(delivery([invoice({ lines: [line({ productName: longName })] })])))).toEqual([
      "TEXT_INVALID /invoices/0/lines/0/productName",
    ]);
  });

  it("rejects unpaired surrogates in IDs and text instead of replacing them", () => {
    // Postgres would store each as U+FFFD, so "REVIEW-\ud800" and "REVIEW-\ud801" would collide.
    for (const text of ["REVIEW-\ud800", "REVIEW-\ud801", "REVIEW-\udc00", "\ud83d", "\udf31 x", "x\udf31\ud83d"]) {
      const payload = delivery([
        invoice({
          invoiceNumber: text,
          customer: { ...invoice().customer, id: text, name: text },
          lines: [line({ productId: text, productName: text })],
        }),
      ]);
      const errors = errorsOf(validateDelivery(payload));
      expect(errors.map((error) => `${error.code} ${error.path}`)).toEqual([
        "TEXT_INVALID /invoices/0/invoiceNumber",
        "TEXT_INVALID /invoices/0/customer/id",
        "TEXT_INVALID /invoices/0/customer/name",
        "TEXT_INVALID /invoices/0/lines/0/productId",
        "TEXT_INVALID /invoices/0/lines/0/productName",
      ]);
      // An unusable invoice number is not echoed back as the error's invoice.
      expect(errors.every((error) => error.invoiceNumber === null)).toBe(true);
    }
    // Every text field shares the rule.
    for (const [path, payload] of [
      ["/invoices/0/sellerId", invoice({ sellerId: "S0\ud800" })],
      ["/invoices/0/customer/segment", invoice({ customer: { ...invoice().customer, segment: "farmer\udfff" } })],
      ["/invoices/0/customer/city", invoice({ customer: { ...invoice().customer, city: "Viçosa\ud800" } })],
      ["/invoices/0/customer/state", invoice({ customer: { ...invoice().customer, state: "M\udc00" } })],
      ["/invoices/0/lines/0/productCategory", invoice({ lines: [line({ productCategory: "\ud800Foliar" })] })],
    ] as const) {
      expect(codesAt(validateDelivery(delivery([payload])))).toEqual([`TEXT_INVALID ${path}`]);
    }
  });

  it("rejects the whole delivery when one invoice has an unpaired surrogate", () => {
    const result = validateDelivery(delivery([invoice(), homeGardenInvoice({ invoiceNumber: "REVIEW-\ud800" })]));
    expect(codesAt(result)).toEqual(["TEXT_INVALID /invoices/1/invoiceNumber"]);
  });

  it("keeps valid supplementary characters, which are surrogate pairs in JavaScript", () => {
    const seedling = "Fictional Seedling \u{1F331}";
    const result = validateDelivery(
      delivery([
        invoice({
          invoiceNumber: "NF-\u{1D7D8}",
          customer: { ...invoice().customer, name: seedling },
          lines: [line({ productName: seedling })],
        }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.delivery.invoices[0]?.invoiceNumber).toBe("NF-\u{1D7D8}");
    expect(result.delivery.invoices[0]?.customer.name).toBe(seedling);
    // A well-formed but decomposed name is still refused: NFC is checked as before.
    const decomposed = "Viçosa";
    expect(codesAt(validateDelivery(delivery([invoice({ customer: { ...invoice().customer, name: decomposed } })])))).toEqual([
      "TEXT_INVALID /invoices/0/customer/name",
    ]);
  });

  it("accepts only real ISO calendar dates", () => {
    expect(validateDelivery(delivery([invoice({ billingDate: "2024-02-29" })])).ok).toBe(true);
    for (const billingDate of ["2025-02-29", "2025-13-01", "12/06/2025", "2025-6-12", "2025-06-12T00:00:00Z", 45820]) {
      expect(codesAt(validateDelivery(delivery([invoice({ billingDate })])))).toEqual(["DATE_INVALID /invoices/0/billingDate"]);
    }
  });

  it("rejects a billing date whose installments would fall due after 9999-12-31", () => {
    const upfront = "4 installments (Upfront, 30, 60 and 90 days)";
    expect(validateDelivery(delivery([invoice({ billingDate: "9999-12-31", paymentSchedule: "Upfront" })])).ok).toBe(true);
    expect(validateDelivery(delivery([invoice({ billingDate: "9999-10-02", paymentSchedule: upfront })])).ok).toBe(true);
    for (const [billingDate, paymentSchedule] of [
      ["9999-10-03", upfront],
      ["9999-12-31", "30 Days"],
    ]) {
      expect(codesAt(validateDelivery(delivery([invoice({ billingDate, paymentSchedule })])))).toEqual([
        "DATE_INVALID /invoices/0/billingDate",
      ]);
    }
  });

  it("matches business units and payment schedules exactly", () => {
    for (const businessUnit of ["agro", "AGRO", "Home and Garden", "constructor"]) {
      expect(codesAt(validateDelivery(delivery([invoice({ businessUnit })])))).toEqual([
        "BUSINESS_UNIT_UNKNOWN /invoices/0/businessUnit",
      ]);
    }
    for (const paymentSchedule of ["30 days", "3 Installments (30, 60 and 90 days)", "toString"]) {
      expect(codesAt(validateDelivery(delivery([invoice({ paymentSchedule })])))).toEqual([
        "PAYMENT_SCHEDULE_UNKNOWN /invoices/0/paymentSchedule",
      ]);
    }
  });

  it("requires whole positive package quantities", () => {
    for (const packageQuantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(codesAt(validateDelivery(delivery([invoice({ lines: [line({ packageQuantity })] })])))).toContain(
        "QUANTITY_INVALID /invoices/0/lines/0/packageQuantity",
      );
    }
  });

  it("requires whole cents: positive prices and amounts, non-negative commission", () => {
    const cases: [string, number][] = [
      ["unitPriceCents", 0],
      ["unitPriceCents", 899.5],
      ["lineAmountCents", -107880],
      ["commissionAmountCents", -1],
      ["commissionAmountCents", 2 ** 53],
    ];
    for (const [field, value] of cases) {
      expect(codesAt(validateDelivery(delivery([invoice({ lines: [line({ [field]: value })] })])))).toContain(
        `MONEY_INVALID /invoices/0/lines/0/${field}`,
      );
    }
  });

  it("requires line amount = packages × unit price exactly", () => {
    // One cent off; 5% of 107,881 still rounds to the stated commission, so only the amount fails.
    expect(codesAt(validateDelivery(delivery([invoice({ lines: [line({ lineAmountCents: 107881 })] })])))).toEqual([
      "LINE_AMOUNT_MISMATCH /invoices/0/lines/0/lineAmountCents",
    ]);
    // The product exceeds 2^53, so it cannot be compared exactly and is rejected.
    const huge = line({
      packageQuantity: 2 ** 27,
      unitPriceCents: 2 ** 27,
      lineAmountCents: 2 ** 53 - 1,
      commissionAmountCents: commissionCents(2 ** 53 - 1),
    });
    expect(codesAt(validateDelivery(delivery([invoice({ lines: [huge] })])))).toEqual([
      "LINE_AMOUNT_MISMATCH /invoices/0/lines/0/lineAmountCents",
    ]);
  });

  it("requires commission = 5% of the line amount, rounded half-up", () => {
    expect([10, 9, 30, 29, 107880, 7470].map(commissionCents)).toEqual([1, 0, 2, 1, 5394, 374]);
    const oneCentLine = (commissionAmountCents: number) =>
      line({ packageQuantity: 1, unitPriceCents: 10, lineAmountCents: 10, commissionAmountCents });
    expect(validateDelivery(delivery([invoice({ lines: [oneCentLine(1)] })])).ok).toBe(true);
    expect(codesAt(validateDelivery(delivery([invoice({ lines: [oneCentLine(0)] })])))).toEqual([
      "COMMISSION_MISMATCH /invoices/0/lines/0/commissionAmountCents",
    ]);
  });
});

describe("validateDelivery: sellers, territories and consistency", () => {
  it("requires a known seller whose business unit matches the invoice", () => {
    expect(codesAt(validateDelivery(delivery([invoice({ sellerId: "S99" })])))).toEqual(["SELLER_UNKNOWN /invoices/0/sellerId"]);
    expect(codesAt(validateDelivery(delivery([invoice({ businessUnit: "Home & Garden" })])))).toEqual([
      "BUSINESS_UNIT_SELLER_MISMATCH /invoices/0/businessUnit",
    ]);
  });

  it("rejects a customer city outside the seller's territory", () => {
    const outside = [
      { city: "Guaxupé", state: "MG" }, // another Agro seller's territory
      { city: "Viçosa", state: "SP" }, // right name, wrong state
      { city: "Vicosa", state: "MG" }, // not the listed spelling
      { city: "São Paulo", state: "SP" }, // a Home & Garden territory
    ];
    for (const place of outside) {
      const result = validateDelivery(delivery([invoice({ customer: { ...invoice().customer, ...place } })]));
      expect(codesAt(result)).toEqual(["CITY_OUTSIDE_TERRITORY /invoices/0/customer/city"]);
    }
  });

  it("keeps a stored customer with its owning seller", () => {
    const payload = delivery([invoice()]);
    expect(validateDelivery(payload, { customerOwner: (id) => (id === "C0042" ? "S04" : undefined) }).ok).toBe(true);
    expect(validateDelivery(payload, { customerOwner: () => undefined }).ok).toBe(true);
    expect(codesAt(validateDelivery(payload, { customerOwner: () => "S05" }))).toEqual([
      "CUSTOMER_SELLER_MISMATCH /invoices/0/sellerId",
    ]);
  });

  it("keeps a stored product in its business unit", () => {
    const payload = delivery([invoice({ lines: [line(), line()] })]);
    expect(validateDelivery(payload, { productBusinessUnit: () => "AGRO" }).ok).toBe(true);
    expect(validateDelivery(payload, { productBusinessUnit: () => undefined }).ok).toBe(true);
    expect(codesAt(validateDelivery(payload, { productBusinessUnit: () => "HOME_GARDEN" }))).toEqual([
      "PRODUCT_ATTRIBUTE_CONFLICT /invoices/0/lines/0/productId",
      "PRODUCT_ATTRIBUTE_CONFLICT /invoices/0/lines/1/productId",
    ]);
  });

  it("reads a valid deliveryId even when the rest of the payload is invalid", () => {
    expect(peekDeliveryId({ deliveryId: DELIVERY_ID, invoices: "nope" })).toBe(DELIVERY_ID);
    expect(peekDeliveryId({ deliveryId: DELIVERY_ID.toUpperCase() })).toBeNull();
    expect(peekDeliveryId({ deliveryId: 42 })).toBeNull();
    expect(peekDeliveryId([DELIVERY_ID])).toBeNull();
    expect(peekDeliveryId(null)).toBeNull();
  });

  it("rejects one customer with two sellers or two descriptions in the same delivery", () => {
    const other = { ...invoice().customer, city: "Guaxupé" };
    const result = validateDelivery(
      delivery([
        invoice(),
        invoice({ invoiceNumber: "000125", sellerId: "S05", customer: other }),
        invoice({ invoiceNumber: "000126", customer: { ...invoice().customer, segment: "farmer" } }),
      ]),
    );
    expect(errorsOf(result).map(({ code, path, relatedPath }) => [code, path, relatedPath])).toEqual([
      ["CUSTOMER_ATTRIBUTE_CONFLICT", "/invoices/1/customer/city", "/invoices/0/customer/city"],
      ["CUSTOMER_SELLER_MISMATCH", "/invoices/1/sellerId", "/invoices/0/sellerId"],
      ["CUSTOMER_ATTRIBUTE_CONFLICT", "/invoices/2/customer/segment", "/invoices/0/customer/segment"],
    ]);
  });

  it("rejects one product with two descriptions or two business units in the same delivery", () => {
    const result = validateDelivery(
      delivery([
        invoice(),
        invoice({ invoiceNumber: "000125", lines: [line({ productCategory: "Biostimulant" })] }),
        homeGardenInvoice({ lines: [line()] }),
      ]),
    );
    expect(errorsOf(result).map(({ code, path, relatedPath }) => [code, path, relatedPath])).toEqual([
      ["PRODUCT_ATTRIBUTE_CONFLICT", "/invoices/1/lines/0/productCategory", "/invoices/0/lines/0/productCategory"],
      ["PRODUCT_ATTRIBUTE_CONFLICT", "/invoices/2/lines/0/productId", "/invoices/0/lines/0/productId"],
    ]);
  });

  it("rejects an invoice number sent twice in one delivery", () => {
    const result = validateDelivery(delivery([invoice(), homeGardenInvoice(), invoice()]));
    expect(errorsOf(result)).toEqual([
      expect.objectContaining({
        code: "INVOICE_DUPLICATE",
        path: "/invoices/2/invoiceNumber",
        invoiceNumber: "000123",
        relatedPath: "/invoices/0/invoiceNumber",
      }),
    ]);
  });
});

describe("validateDelivery: whole-delivery rejection and reporting", () => {
  it("rejects the whole delivery and reports every located error in one pass", () => {
    const result = validateDelivery(
      delivery([
        invoice(),
        invoice({ invoiceNumber: "000777", billingDate: "2025-02-30", lines: [line(), line({ lineAmountCents: 1 })] }),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(errorsOf(result).map(({ code, path, invoiceNumber }) => [code, path, invoiceNumber])).toEqual([
      ["DATE_INVALID", "/invoices/1/billingDate", "000777"],
      ["LINE_AMOUNT_MISMATCH", "/invoices/1/lines/1/lineAmountCents", "000777"],
      ["COMMISSION_MISMATCH", "/invoices/1/lines/1/commissionAmountCents", "000777"],
    ]);
  });

  it("caps the returned errors and says the list was truncated", () => {
    const invoices = Array.from({ length: 150 }, (_, index) =>
      invoice({ invoiceNumber: String(index).padStart(6, "0"), billingDate: "bad", businessUnit: "bad" }),
    );
    const result = validateDelivery(delivery(invoices));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(DELIVERY_LIMITS.maxErrors);
    expect(result.truncated).toBe(true);
  });

  it("never quotes payload values in messages", () => {
    const secret = "Sentinel Customer 7Q";
    const payload = delivery([
      invoice({ customer: { id: secret, name: secret, segment: secret, city: secret, state: secret }, sellerId: secret }),
      invoice({ customer: { id: secret, name: `${secret} `, segment: secret, city: secret, state: secret } }),
    ]);
    const errors = errorsOf(validateDelivery(payload));
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) expect(error.message).not.toContain("Sentinel");
  });

  it("rejects totals that cannot be represented exactly", () => {
    const big = 2 ** 52;
    const bigLine = line({ packageQuantity: 1, unitPriceCents: big, lineAmountCents: big, commissionAmountCents: commissionCents(big) });
    const invoices: InvoicePayload[] = [0, 1].map((index) =>
      invoice({ invoiceNumber: `00000${index}`, lines: [bigLine, bigLine] }) as InvoicePayload,
    );
    expect(codesAt(validateDelivery(delivery(invoices)))).toEqual(["TOTAL_OUT_OF_RANGE /invoices"]);
  });
});
