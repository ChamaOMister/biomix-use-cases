-- Clean sales feed storage (architecture decision 002, milestone 4).
-- Money is integer BRL cents (bigint). Dates are calendar dates without time or zone.
-- Business units and payment schedules use the application's codes, not the feed's labels.
-- The contract validator is the primary check; the constraints below keep the stored data
-- consistent even if a bug slipped past it.

CREATE TABLE sellers (
  seller_id     text PRIMARY KEY,
  name          text NOT NULL,
  business_unit text NOT NULL CHECK (business_unit IN ('AGRO', 'HOME_GARDEN')),
  territory     text NOT NULL,
  UNIQUE (seller_id, business_unit)
);

-- At most one seller per city and business unit. Synced from src/domain/sales-feed/reference-data.ts.
CREATE TABLE territory_cities (
  business_unit text NOT NULL,
  state         text NOT NULL,
  city          text NOT NULL,
  seller_id     text NOT NULL,
  PRIMARY KEY (business_unit, state, city),
  UNIQUE (seller_id, state, city),
  FOREIGN KEY (seller_id, business_unit) REFERENCES sellers (seller_id, business_unit)
);

-- One row per received delivery ID, applied or rejected, so a resend returns the original result.
-- Rejected deliveries change nothing else.
CREATE TABLE feed_deliveries (
  delivery_id        uuid PRIMARY KEY,
  -- SHA-256 of the parsed payload re-serialized as JSON; detects a reused delivery ID.
  payload_sha256     text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  received_at        timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL CHECK (status IN ('applied', 'rejected')),
  invoice_count      integer,
  invoices_added     integer,
  invoices_replaced  integer,
  line_count         integer,
  sales_cents        bigint,
  commission_cents   bigint,
  first_billing_date date,
  last_billing_date  date,
  -- Rejected only: the located errors as returned (json keeps their key order) and truncation.
  errors             json,
  errors_truncated   boolean,
  CHECK (
    (status = 'applied'
      AND invoice_count IS NOT NULL AND invoices_added IS NOT NULL AND invoices_replaced IS NOT NULL
      AND invoice_count = invoices_added + invoices_replaced
      AND line_count IS NOT NULL AND sales_cents IS NOT NULL AND commission_cents IS NOT NULL
      AND first_billing_date IS NOT NULL AND last_billing_date IS NOT NULL
      AND errors IS NULL AND errors_truncated IS NULL)
    OR
    (status = 'rejected' AND errors IS NOT NULL AND errors_truncated IS NOT NULL)
  )
);

-- Upserted from deliveries. The owning seller never changes through the feed.
CREATE TABLE customers (
  customer_id      text PRIMARY KEY,
  name             text NOT NULL,
  segment          text NOT NULL,
  city             text NOT NULL,
  state            text NOT NULL,
  seller_id        text NOT NULL REFERENCES sellers,
  last_delivery_id uuid NOT NULL REFERENCES feed_deliveries,
  UNIQUE (customer_id, seller_id),
  -- The customer's city is inside the owning seller's territory.
  FOREIGN KEY (seller_id, state, city) REFERENCES territory_cities (seller_id, state, city)
);

-- Upserted from deliveries. A product belongs to one business unit.
CREATE TABLE products (
  product_id       text PRIMARY KEY,
  name             text NOT NULL,
  category         text NOT NULL,
  business_unit    text NOT NULL CHECK (business_unit IN ('AGRO', 'HOME_GARDEN')),
  last_delivery_id uuid NOT NULL REFERENCES feed_deliveries,
  UNIQUE (product_id, business_unit)
);

-- The invoice is the record: identified by its number across all deliveries, replaced whole.
CREATE TABLE invoices (
  invoice_number   text PRIMARY KEY,
  billing_date     date NOT NULL,
  customer_id      text NOT NULL,
  seller_id        text NOT NULL,
  business_unit    text NOT NULL,
  payment_schedule text NOT NULL
    CHECK (payment_schedule IN ('UPFRONT', 'NET_30', 'INSTALLMENTS_30_60_90', 'INSTALLMENTS_0_30_60_90')),
  last_delivery_id uuid NOT NULL REFERENCES feed_deliveries,
  UNIQUE (invoice_number, business_unit),
  -- The invoice's seller is the customer's owner, and its unit is the seller's.
  FOREIGN KEY (customer_id, seller_id) REFERENCES customers (customer_id, seller_id),
  FOREIGN KEY (seller_id, business_unit) REFERENCES sellers (seller_id, business_unit)
);

CREATE INDEX invoices_billing_date_idx ON invoices (billing_date);
CREATE INDEX invoices_customer_idx ON invoices (customer_id);
CREATE INDEX invoices_seller_idx ON invoices (seller_id);

-- One invoice product line. line_number is the line's 1-based position in the delivered invoice,
-- so repeated lines of the same product keep their identity. business_unit repeats the invoice's
-- unit only so the foreign keys can require the product to belong to that unit.
CREATE TABLE invoice_lines (
  invoice_number          text NOT NULL,
  line_number             integer NOT NULL CHECK (line_number >= 1),
  business_unit           text NOT NULL,
  product_id              text NOT NULL,
  package_quantity        bigint NOT NULL CHECK (package_quantity >= 1),
  unit_price_cents        bigint NOT NULL CHECK (unit_price_cents > 0),
  line_amount_cents       bigint NOT NULL CHECK (line_amount_cents > 0),
  commission_amount_cents bigint NOT NULL CHECK (commission_amount_cents >= 0),
  PRIMARY KEY (invoice_number, line_number),
  CHECK (line_amount_cents = package_quantity * unit_price_cents),
  FOREIGN KEY (invoice_number, business_unit) REFERENCES invoices (invoice_number, business_unit),
  FOREIGN KEY (product_id, business_unit) REFERENCES products (product_id, business_unit)
);

CREATE INDEX invoice_lines_product_idx ON invoice_lines (product_id);
