/** Keeps `docs/api/sales-feed.openapi.json` in step with the implemented contract. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { API_KEY_HEADER, DELIVERY_MAX_BODY_BYTES, FEED_ERROR_CODES } from "../../server/sales-feed/delivery-handler";
import {
  BUSINESS_UNIT_LABELS,
  CUSTOMER_FIELDS,
  DELIVERY_ERROR_CODES,
  DELIVERY_FIELDS,
  DELIVERY_LIMITS,
  INVOICE_FIELDS,
  LINE_FIELDS,
  PAYMENT_SCHEDULE_LABELS,
  validateDelivery,
} from "./contract";

interface Schema {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
  enum?: string[];
  maxItems?: number;
  minItems?: number;
  maxLength?: number;
  $ref?: string;
}

const spec = JSON.parse(readFileSync(path.join(process.cwd(), "docs/api/sales-feed.openapi.json"), "utf8"));
const schemas: Record<string, Schema> = spec.components.schemas;
const operation = spec.paths["/api/sales-feed/deliveries"].post;
const example = operation.requestBody.content["application/json"].examples.oneInvoice.value;

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("OpenAPI description of the delivery contract", () => {
  it("describes the endpoint with OpenAPI 3.1", () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(operation.requestBody.content["application/json"].schema.$ref).toBe("#/components/schemas/Delivery");
    expect(Object.keys(operation.responses).sort()).toEqual(["200", "400", "401", "409", "413", "415", "422", "500", "503"]);
  });

  it("lists the endpoint's own error codes and API key header", () => {
    expect(schemas.FeedError!.properties!.code!.enum).toEqual([...FEED_ERROR_CODES]);
    expect(spec.components.securitySchemes.developmentApiKey.name.toLowerCase()).toBe(API_KEY_HEADER);
    const limitMiB = DELIVERY_MAX_BODY_BYTES / (1024 * 1024);
    expect(operation.responses["413"].description).toContain(`${limitMiB} MiB`);
  });

  it("has an example that the validator accepts", () => {
    expect(validateDelivery(example)).toMatchObject({ ok: true });
  });

  it.each([
    ["Delivery", DELIVERY_FIELDS],
    ["Invoice", INVOICE_FIELDS],
    ["Customer", CUSTOMER_FIELDS],
    ["Line", LINE_FIELDS],
  ] as const)("lists exactly the %s fields the validator requires, and no others", (name, fields) => {
    const schema = schemas[name]!;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual([...fields]);
    expect(Object.keys(schema.properties!)).toEqual([...fields]);
  });

  it("uses the validator's labels, limits and error codes", () => {
    const invoice = schemas.Invoice!.properties!;
    expect(invoice.businessUnit!.enum).toEqual(Object.values(BUSINESS_UNIT_LABELS));
    expect(invoice.paymentSchedule!.enum).toEqual(Object.values(PAYMENT_SCHEDULE_LABELS));
    expect(schemas.Delivery!.properties!.invoices!.maxItems).toBe(DELIVERY_LIMITS.maxInvoices);
    expect(invoice.lines!.maxItems).toBe(DELIVERY_LIMITS.maxLinesPerInvoice);
    expect(schemas.Identifier!.maxLength).toBe(DELIVERY_LIMITS.maxIdLength);
    expect(schemas.Text!.maxLength).toBe(DELIVERY_LIMITS.maxTextLength);
    expect(schemas.DeliveryRejected!.properties!.errors!.maxItems).toBe(DELIVERY_LIMITS.maxErrors);
    expect(schemas.DeliveryError!.properties!.code!.enum).toEqual([...DELIVERY_ERROR_CODES]);
  });

  it("marks as required exactly what the validator rejects when missing", () => {
    const cases: [string, (payload: typeof example) => Record<string, unknown>, readonly string[]][] = [
      ["", (payload) => payload, DELIVERY_FIELDS],
      ["/invoices/0", (payload) => payload.invoices[0], INVOICE_FIELDS],
      ["/invoices/0/customer", (payload) => payload.invoices[0].customer, CUSTOMER_FIELDS],
      ["/invoices/0/lines/0", (payload) => payload.invoices[0].lines[0], LINE_FIELDS],
    ];
    for (const [base, target, fields] of cases) {
      for (const field of fields) {
        const payload = clone(example);
        delete target(payload)[field];
        const result = validateDelivery(payload);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.errors.map((error) => `${error.code} ${error.path}`)).toContain(`FIELD_REQUIRED ${base}/${field}`);
      }
    }
  });
});
