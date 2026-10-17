"use client";
// Applies each change at once by navigating to the filtered URL; every filter combines with the
// others (AND). Without JavaScript it is a plain GET form with an Apply button.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { BUSINESS_UNIT_LABELS } from "@/domain/sales-feed/contract";
import type { BusinessUnit } from "@/domain/sales-import/types";
import { optionLabels, stateLabel } from "@/domain/sales-report/display";
import { FILTER_KEYS, filtersHref, type FilterKey, type FilterValues } from "./report-filters";

export interface FilterBarOptions {
  customers: { id: string; label: string }[];
  products: { id: string; label: string }[];
  sellers: { id: string; label: string }[];
  states: string[];
  businessUnits: BusinessUnit[];
  firstDate: string | null;
  lastDate: string | null;
}

function isDateInput(target: EventTarget): target is HTMLInputElement {
  return target instanceof HTMLInputElement && target.type === "date";
}

/** Remount it with a `key` per URL so the fields show the URL's values again. */
export function FilterBar({ filters, options }: { filters: FilterValues; options: FilterBarOptions }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = FILTER_KEYS.filter((key) => filters[key]).length;

  function apply(form: HTMLFormElement) {
    const data = new FormData(form);
    const values = Object.fromEntries(FILTER_KEYS.map((key) => [key, String(data.get(key) ?? "")])) as FilterValues;
    startTransition(() => router.push(filtersHref(values), { scroll: false }));
  }

  // Names, never IDs, unless two choices share a name.
  const customerLabels = optionLabels(options.customers);
  const productLabels = optionLabels(options.products);
  const sellerLabels = optionLabels(options.sellers);
  const name = (labels: Map<string, string>, id: string) => labels.get(id) ?? id;
  // One removable chip per active filter, always by name.
  const chips: [FilterKey, string, string][] = [];
  if (filters.customerId) chips.push(["customerId", "Customer", name(customerLabels, filters.customerId)]);
  if (filters.productId) chips.push(["productId", "Product", name(productLabels, filters.productId)]);
  if (filters.sellerId) chips.push(["sellerId", "Seller", name(sellerLabels, filters.sellerId)]);
  if (filters.state) chips.push(["state", "State", stateLabel(filters.state)]);
  if (filters.businessUnit) chips.push(["businessUnit", "Unit", BUSINESS_UNIT_LABELS[filters.businessUnit as BusinessUnit] ?? filters.businessUnit]);
  if (filters.from) chips.push(["from", "From", filters.from]);
  if (filters.to) chips.push(["to", "To", filters.to]);

  const dateBounds = { min: options.firstDate ?? undefined, max: options.lastDate ?? undefined };
  return (
    <form
      className="filter-bar"
      method="get"
      action="/"
      aria-label="Report filters"
      aria-busy={pending}
      // Dates apply when the field is left or Enter is pressed, not on every keystroke: typing a
      // year digit by digit passes through valid dates such as 0002-03-01, and each navigation
      // remounts the form, which would throw the half-typed date away.
      onChange={(event) => {
        if (!isDateInput(event.target)) apply(event.currentTarget);
      }}
      onBlur={(event) => {
        const target = event.target;
        if (isDateInput(target) && target.value !== (filters[target.name as FilterKey] ?? "")) apply(event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && isDateInput(event.target)) {
          event.preventDefault();
          apply(event.currentTarget);
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        apply(event.currentTarget);
      }}
    >
      <div className="filter wide">
        <label htmlFor="f-customer">Customer</label>
        <select id="f-customer" name="customerId" defaultValue={filters.customerId ?? ""}>
          <option value="">All customers</option>
          {options.customers.map((customer) => <option key={customer.id} value={customer.id}>{name(customerLabels, customer.id)}</option>)}
        </select>
      </div>
      <div className="filter wide">
        <label htmlFor="f-product">Product</label>
        <select id="f-product" name="productId" defaultValue={filters.productId ?? ""}>
          <option value="">All products</option>
          {options.products.map((product) => <option key={product.id} value={product.id}>{name(productLabels, product.id)}</option>)}
        </select>
      </div>
      <div className="filter">
        <label htmlFor="f-seller">Seller</label>
        <select id="f-seller" name="sellerId" defaultValue={filters.sellerId ?? ""}>
          <option value="">All sellers</option>
          {options.sellers.map((seller) => <option key={seller.id} value={seller.id}>{name(sellerLabels, seller.id)}</option>)}
        </select>
      </div>
      <div className="filter">
        <label htmlFor="f-state">State</label>
        <select id="f-state" name="state" defaultValue={filters.state ?? ""}>
          <option value="">All states</option>
          {options.states.map((state) => <option key={state} value={state}>{stateLabel(state)}</option>)}
        </select>
      </div>
      <div className="filter unit">
        <label htmlFor="f-unit">Business unit</label>
        <select id="f-unit" name="businessUnit" defaultValue={filters.businessUnit ?? ""}>
          <option value="">All units</option>
          {options.businessUnits.map((unit) => <option key={unit} value={unit}>{BUSINESS_UNIT_LABELS[unit]}</option>)}
        </select>
      </div>
      <div className="filter date">
        <label htmlFor="f-from">From</label>
        <input id="f-from" type="date" name="from" defaultValue={filters.from ?? ""} {...dateBounds} />
      </div>
      <div className="filter date">
        <label htmlFor="f-to">To</label>
        <input id="f-to" type="date" name="to" defaultValue={filters.to ?? ""} {...dateBounds} />
      </div>
      <div className="filter-footer">
        <span className="filter-status" aria-live="polite">
          {pending ? "Updating…" : active === 0 ? "No filters: showing all sales" : `${active} ${active === 1 ? "filter" : "filters"} combined`}
        </span>
        {chips.length > 0 ? (
          <ul className="chips" aria-label="Active filters">
            {chips.map(([key, label, value]) => (
              <li key={key}>
                <span>{label}:</span> {value}
                <Link href={filtersHref({ ...filters, [key]: undefined })} scroll={false} aria-label={`Remove filter ${label}: ${value}`}>×</Link>
              </li>
            ))}
          </ul>
        ) : null}
        <noscript><button type="submit">Apply</button></noscript>
        {active > 0 ? <Link className="clear" href="/" scroll={false}>Clear all</Link> : null}
      </div>
    </form>
  );
}
