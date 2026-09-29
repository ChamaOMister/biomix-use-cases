-- Scheduled collections (architecture decision 002, milestone 5).
-- The contractual installments of each stored invoice: what its payment schedule says is due and
-- when. They are not actual payments. The feed ingestion computes them in TypeScript
-- (src/domain/collections/schedule.ts) and replaces them together with the invoice's lines.

CREATE TABLE scheduled_installments (
  invoice_number     text NOT NULL REFERENCES invoices,
  -- 1-based, in due-date order.
  installment_number integer NOT NULL CHECK (installment_number BETWEEN 1 AND 4),
  due_date           date NOT NULL,
  -- Zero only when the invoice total has fewer cents than installments.
  amount_cents       bigint NOT NULL CHECK (amount_cents >= 0),
  PRIMARY KEY (invoice_number, installment_number)
);

CREATE INDEX scheduled_installments_due_date_idx ON scheduled_installments (due_date);
