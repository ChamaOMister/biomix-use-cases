# Milestone 3 review — approved

## Current verdict — R1 verified by Codex, 2026-09-29

**R1 is closed. Milestone 3 is approved; Milestone 4 may start when the maintainer requests it.** No new blocking finding was identified in this focused correction review. The original correction request below is historical and superseded by this verdict.

The generator now draws the two reduced accounts' current-period lines against 40% of each account's actual previous-period sales, then adjusts package quantities. Both comparison periods have purchase history. These invoices remain locked through splits, corrections and unit-year calibration. The answer-key description uses the measured invoiced-sales change and the same comparison dates. The extracted quantity-adjustment helper preserves the previous calibration arithmetic.

The new regressions cover seeds 2026, 8 and 28, recompute both periods from replayed invoices, check the intended ratio and measured description, exclude split/correction interference, and retain the unit-year revenue targets.

Independent verification:

- `npm run check > /tmp/milestone3-r1-review-check.log 2>&1` — exit 0: ESLint, route type generation, TypeScript, **324 tests in 13 files**, and production build passed.
- `node /tmp/milestone3-replay-probe.mjs` — exit 0: independently replayed seeds **2026, 8, 28, 0 and 4294967295** using a map keyed by invoice number. All deliveries passed contract validation with stored-customer ownership. BigInt checks reconciled line amounts, half-up 5% commission and unit-year summary totals. Every unit-year remained within 1% of target; every reduced account was within 0.02 of the 0.4 sales ratio. Answer-key totals, percentages and descriptions matched independently recomputed figures. Each seed retained seven invoice replacements.

| Seed | Agro sales change | Home & Garden sales change |
| --- | --- | --- |
| 2026 | −59.96% | −60.00% |
| 8 | −60.01% | −60.01% |
| 28 | −59.97% | −60.03% |
| 0 | −60.01% | −60.03% |
| 4294967295 | −60.00% | −60.01% |

The review changed only this review record and milestone status text in README, CLAUDE and decision 002. No implementation, tests or generated output were added to the repository by this follow-up. Probes stayed in `/tmp` and generated data stayed in memory.

Claude's mutation experiment and full 42-seed sweep were reported, not independently repeated. Fresh installation, hosted CI, a fresh Codespace, cross-Node-version determinism and geographic-source verification remain unverified here. Browser QA was not repeated because this correction adds no browser flow. Endpoint, database and installment behavior remain future milestones.

## Original review — historical; R1 resolved above

Codex reviewed the uncommitted Milestone 3 implementation on 2026-09-29, including the new files under `src/domain/sales-feed/`, `src/synthetic-data/`, `scripts/` and `docs/api/` and the tracked documentation/configuration changes.

**One confirmed P2 finding needs correction before approval.** The required checks pass, and the default seed satisfies the checked contract and target rules. An allowed alternative seed produces a planted reduced-purchases scenario whose actual sales increased. Resolve R1 and return for a focused review before starting Milestone 4.

## R1 — P2: guarantee the reduction described by the evaluation answer key

Location: [`generate.ts:357`](../../src/synthetic-data/generate.ts#L357), with the unconditional answer-key label at [`generate.ts:724`](../../src/synthetic-data/generate.ts#L724). Existing reduction assertion: [`generate.test.ts:196`](../../src/synthetic-data/generate.test.ts#L196).

`plantScenarios()` multiplies each selected customer's 2026 order weight by 0.4. Order counts and dates were drawn independently for each year, and `orderTargets()` subsequently normalizes weights against each unit-year's revenue target. This does not guarantee a reduction in that customer's realized purchases over the equivalent comparison periods. Nevertheless, `buildAnswerKey()` always emits `kind: "reduced-purchases"` and describes the account as buying about 40% of its usual volume.

Independent replay of the generated deliveries, including all corrections, reproduces:

| Seed | Customer | Unit | Jan 1–Sep 25, 2025 sales | Jan 1–Sep 25, 2026 sales | Change |
| --- | --- | --- | --- | --- | --- |
| 8 | C0233 | Home & Garden | R$ 231,215.50 | R$ 230,358.20 | −0.37% |
| 28 | C0086 | Home & Garden | R$ 200,646.80 | R$ 221,754.40 | **+10.52%** |

The answer key's numeric totals correctly match the deliveries; its scenario classification and description are the defect. This would supply an incorrect expected answer to a later evaluation. The existing test requires a decline exceeding 25%, but applies that scenario assertion only to the default seed. The other-seed test checks targets and contract acceptance without checking planted scenarios.

Minimal reproduction from the repository root (Node 24):

```sh
node --input-type=module -e '
import { generateSyntheticFeed } from "./src/synthetic-data/generate.ts";
const feed = generateSyntheticFeed({ seed: 28 });
console.log(feed.answerKey.scenarios.filter(s => s.kind === "reduced-purchases"));
'
```

**Required correction:** make the planted reduction hold in the realized data over equivalent periods, while retaining the annual targets, exact line arithmetic and deterministic output. Derive the description from the supported metric. Add regressions for seeds 8 and 28 as well as the default seed, independently recomputing the scenario amounts from replayed invoices. Assert the intended reduction for both units after corrections and calibration.

## Verification and limits

- `npm run check > /tmp/milestone3-review-check.log 2>&1` — exit 0: ESLint, route type generation, TypeScript, **313 tests in 13 files**, and production build passed.
- `node /tmp/milestone3-review-probes.mjs` — exit 0: temporary in-memory probes explored seeds 0–39, 2026 and 4294967295. Several seeds missed the existing reduction threshold; seed 28 produced the increase above. Separate UUID/date probes correctly rejected trailing line terminators.
- `node /tmp/milestone3-replay-probe.mjs` — exit 0: independently replayed seeds 2026, 8 and 28 with a map keyed by invoice number. Every delivery passed validation with stored-customer ownership. BigInt checks independently reconciled line amounts, half-up 5% commission and all unit-year summary totals. Each run had seven replacements. The reduced-purchase figures above were recomputed from the replayed invoices, matching the answer key.
- Inspected OpenAPI fields, labels, limits, planned response semantics, reference-data validation, correction handling, monthly/pending delivery separation, and answer-key separation from feed files. No additional blocking defect was identified in those checks.
- No production implementation, existing tests or dependencies were changed. Review probes were kept in `/tmp`; generated datasets were held in memory. This review document is the only repository addition made by the review.
- Not run: fresh dependency installation, hosted CI, a fresh Codespace, cross-version determinism, independent verification of geographic sources, or browser QA. Milestone 3 adds no browser flow. Endpoint, database and installment behavior remain future milestones.

## Correction handoff

```text
Read docs/reviews/milestone-3-review.md and correct R1. Ensure both planted
reduced-purchases accounts actually show the intended reduction over equivalent
periods after replay, including for seeds 8 and 28. Keep deterministic generation,
annual targets, territory rules, corrections and answer-key isolation intact.
Add focused regressions, run npm run check, and report exact results using
docs/review.md. Return for review before starting Milestone 4.
```
