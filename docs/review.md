# Review and QA handoff

The maintainer coordinates implementation and independent review. Start a review with the current milestone and a diff/commit plus changed files available in this workspace. A screenshot alone is not enough to assess arithmetic or data integrity.

Claude's milestone summary:

```text
Milestone:
Implemented behavior:
Files changed:
Decisions/defaults and reasons:
Checks run (exact command + outcome):
Manual reconciliation/demo evidence:
Checks not run and why:
Known limitations/risks:
Questions requiring a business decision (if any):
Next proposed milestone:
```

QA evidence required as features arrive:

| Area | Evidence |
| --- | --- |
| Import | Correct sheet/header handling, row-level actionable issues, no silent discarded sales |
| Grain | Two lines in one invoice count once; repeated same-product lines retain identity |
| Money | Brazilian decimal parsing, exact cents, reconciled line/invoice totals, overflow/precision rejection |
| Dates | Contradictory components rejected, valid leap days, invalid dates, Excel date systems, timezone-independent calendar behavior |
| Invoice identity | Conflict detection; documented uniqueness scope and reimport behavior |
| Units | Packages, mass, and volume remain distinct; no unsupported liquid kg totals |
| Schedules | All terms, invoice-level aggregation, exact cent reconciliation, cross-month/year due dates |
| Reporting | Filters and totals reconcile; selected product lines do not silently distort invoice schedules |
| Data handling | No original identities/secrets in tracked files, logs, or exported demos |
| Reproducibility | Clean npm ci + required checks; successful fresh Codespace; browser success/failure flow |

Later-project QA: as-of cutoff everywhere, equivalent cumulative periods, insufficient history, evidence/provenance, evaluation answer-key isolation, bounded tool calls, costs/latency where available, explicit approval/rejection, retries without duplicate tasks, and tool failure handling. Synthetic results must be labeled synthetic.

Reviews should distinguish confirmed defects, suggested improvements, and unresolved business choices. Approval is not evidence that an unrun test passed. Keep review feedback small enough for Claude to address in one change.
