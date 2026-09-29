# Project 1 release review: v1.0.0

## Verdict (2026-09-29)

**Confirmed: the v1.0.0 release matches its record, and its downloaded file is the approved build.** All five audit items pass, with no blocking findings. There are six non-blocking observations, listed below. Claude performed this audit, not an independent reviewer: Codex was unavailable, and the maintainer asked Claude to audit its own release work. Treat it as a self-check that was repeated by other means, not as an independent approval.

Scope: the release record in [setup verification](../setup-verification.md#release-v100-2026-09-29), tag `v1.0.0`, [release v1.0.0](https://github.com/ChamaOMister/biomix-use-cases/releases/tag/v1.0.0), tag CI run [36619459658](https://github.com/ChamaOMister/biomix-use-cases/actions/runs/36619459658), and the status text at `main` = `c087b3f`. This Codespace was in sync with `origin/main` before the audit started (`git fetch --tags`, then `git status -sb` showed `main...origin/main`, and `HEAD` = `origin/main` = `c087b3f`). The audit was read-only. Nothing was committed, pushed, tagged or edited on GitHub, and the development database was read only inside read-only transactions that were rolled back. This file is the only change to the repository, and it is uncommitted. Probes, downloads, logs and screenshots are in `/tmp/p1-release-audit/`.

| # | Item | Result |
| --- | --- | --- |
| 1 | Tag and tree | **Pass.** `v1.0.0` is an annotated tag (object `aa6c549`) pointing to `af486a5b4a2af0a7c7f71c7e124e47a7005a5a81`. It is the only tag on GitHub, and v1.0.0 is the only release, including drafts. Compared with `0c3d1a0`, the tree of `af486a5` changes only 8 Markdown files |
| 2 | Tag CI | **Pass.** Run 36619459658 ran on a push of `v1.0.0` at `af486a5`, attempt 1, and succeeded. Both `check` and `release-snapshot` succeeded at that SHA |
| 3 | Asset identity | **Pass.** Downloading through the README link without authentication gave SHA-256 `b7409bd341c147087f4d2b535d3eb3ba4a36b9fcf613a5eb1d868f4c23c5514f`, 942,242 bytes. The run's artifact and a local build from the tagged tree are byte-identical to it (`cmp`) |
| 4 | Downloaded file offline | **Pass.** 786 browser assertions, 0 failures. Totals and all four breakdown tables equal read-only SQL in 11 views at 4 widths. The product filter suppresses collections. The page width equals the viewport in all 44 view/width combinations. The only requests were for the file itself (the positive control below aside), with zero CSP violations, page errors or console messages |
| 5 | Status documents | **Pass, with wording observations.** The five documents agree on status. The waivers are preserved, and the follow-ups appear in README, CLAUDE.md and milestones. See O1 and O2 |

## Evidence

### 1. Tag, releases and tree

```sh
git fetch --tags origin && git status -sb && git rev-parse HEAD origin/main
git cat-file -p v1.0.0                      # object af486a5…, type commit, tag v1.0.0
git rev-parse 'v1.0.0^{commit}'             # af486a5b4a2af0a7c7f71c7e124e47a7005a5a81
git ls-remote --tags origin                 # refs/tags/v1.0.0 (aa6c549) and ^{} → af486a5 only
git diff --stat 0c3d1a0 af486a5             # 8 files, all *.md
git diff --name-only 0c3d1a0 af486a5 | grep -vE '^(docs/.*\.md|README\.md|CLAUDE\.md)$'   # no output
git merge-base --is-ancestor 0c3d1a0 af486a5                                               # exit 0
git rev-parse af486a5^{tree} 3709abe^{tree} # both 49f3eb2…: the merge introduced no content of its own
curl -sS https://api.github.com/repos/ChamaOMister/biomix-use-cases/tags                   # [v1.0.0 → af486a5]
curl -sS https://api.github.com/repos/ChamaOMister/biomix-use-cases/git/matching-refs/tags # refs/tags/v1.0.0 only
curl -sS https://api.github.com/repos/ChamaOMister/biomix-use-cases/releases?per_page=100  # 1 release
```

The release list was fetched a second time with the Codespace's GitHub token, because unauthenticated listings omit drafts. It still showed only `v1.0.0`, not a draft. Release details: not a prerelease, published 2026-09-29T19:29:35Z by `github-actions[bot]`, and `releases/latest` resolves to it. The only asset is `biomix-report-snapshot.html`, 942,242 bytes, digest `sha256:b7409bd3…c5514f`, uploaded by `github-actions[bot]`. The release notes label the data as synthetic.

The 8 files that differ from `0c3d1a0` are `CLAUDE.md`, `README.md`, `docs/architecture-002-clean-data-platform.md`, `docs/collections.md`, `docs/milestones.md`, `docs/report-snapshot.md`, `docs/reviews/milestone-4-6-review.md` and `docs/setup-verification.md`. `af486a5` is a merge of `0e00e97` (the previous `main`) and `3709abe` (the branch head). `c087b3f` (PR #2) is also a merge, and its diff from `af486a5` changes only 6 Markdown files. Push CI run 36620351260 for `c087b3f` on `main` succeeded. Both merges were authored under the maintainer's public alias with the GitHub no-reply address and committed by GitHub.

### 2. Tag CI run 36619459658

```sh
curl -sS https://api.github.com/repos/ChamaOMister/biomix-use-cases/actions/runs/36619459658
curl -sS https://api.github.com/repos/ChamaOMister/biomix-use-cases/actions/runs/36619459658/jobs
curl -sS https://api.github.com/repos/ChamaOMister/biomix-use-cases/actions/runs/36619459658/artifacts
curl -sS -L -H "Authorization: Bearer $GITHUB_TOKEN" …/actions/jobs/<job id>/logs   # both jobs, HTTP 200
```

- Run: workflow "Foundation checks" (`.github/workflows/ci.yml`), event `push`, ref `v1.0.0`, head `af486a5…`, attempt 1, conclusion **success**. It is the only run for that ref.
- `check`: **success** at `af486a5`. All steps succeeded: checkout, setup-node, `npm ci`, `npm run db:migrate` ("2 applied"), `npm run check` and `npm run snapshot:build` ("seed 2026 … (0.90 MiB)"), then the artifact upload. The hosted log shows `node: v24.21.0`, **Test Files 20 passed (20)** and **Tests 477 passed (477)**, so no tests were skipped.
- `release-snapshot`: **success** at `af486a5`. It downloaded artifact 11056863102 and logged "SHA256 digest of downloaded artifact is 1fc53833…baefd56e", equal to the expected digest. It then created the release at `/releases/tag/v1.0.0`.
- Artifact `report-snapshot` 11056863102: 209,630 bytes, digest `sha256:1fc53833cf11723fab5c73735432a7ed8ed348db72b95bd54045db19baefd56e`, not expired (expires 2026-10-29).

These figures match the release record.

### 3. Asset identity

```sh
# The link, read from README.md at c087b3f (the tagged README has the same link):
#   https://github.com/ChamaOMister/biomix-use-cases/releases/latest/download/biomix-report-snapshot.html
env -u GITHUB_TOKEN -u GH_TOKEN curl --fail -sS -L --netrc-file /dev/null -o published.html "$URL"
#   HTTP 200 after 2 redirects (to release-assets.githubusercontent.com), 942,242 bytes
sha256sum published.html                    # b7409bd341c147087f4d2b535d3eb3ba4a36b9fcf613a5eb1d868f4c23c5514f

curl -sS -L -H "Authorization: Bearer $GITHUB_TOKEN" -o artifact.zip \
  https://api.github.com/repos/ChamaOMister/biomix-use-cases/actions/artifacts/11056863102/zip
sha256sum artifact.zip                      # 1fc53833…baefd56e (= GitHub's artifact digest)
unzip artifact.zip                          # one entry: biomix-report-snapshot.html
sha256sum biomix-report-snapshot.html       # b7409bd3…c5514f
cmp published.html artifact/biomix-report-snapshot.html   # identical

git archive af486a5 | tar -x -C /tmp/p1-release-audit/tree
cd /tmp/p1-release-audit/tree && npm ci && npm run snapshot:build -- --out /tmp/p1-release-audit/local.html
sha256sum /tmp/p1-release-audit/local.html  # b7409bd3…c5514f
cmp local.html published.html               # identical
```

The local build used a clean `npm ci` of the tagged lockfile in an exported copy of the tree, not the working checkout, on Node v24.21.0 and npm 11.19.0. npm reported only the known install-script approval notice for `unrs-resolver`. In the same exported tree, `env -u DATABASE_URL -u CI npm run check` exited **0**: lint, typecheck, 406 passed and 71 skipped of 477 tests in 20 files (the Postgres tests were skipped, with the expected warning, so that the development database was not touched), and the production build.

### 4. The downloaded file, offline

Expected figures come from `/tmp/p1-release-audit/probe/expected.mjs`. It runs one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction against the development database (`transaction_read_only` = `on`) and ends with `ROLLBACK`. The database held 45 applied deliveries and 1 rejected, 6,468 invoices, 19,361 lines and 12,757 installments. Lines and installments each summed to R$ 87.963.059,70.

The browser probe is `/tmp/p1-release-audit/probe/browser.mjs`. It was written for this audit and runs Playwright 1.63.0 with `chrome-headless-shell`. Only the browser binaries and runtime libraries came from the earlier review's throwaway folder:

```sh
B=/tmp/milestone-4-6-browser
LD_LIBRARY_PATH=$B/runtime/usr/lib/x86_64-linux-gnu FONTCONFIG_FILE=$B/fonts.conf \
  PLAYWRIGHT_BROWSERS_PATH=$B/browsers node /tmp/p1-release-audit/probe/browser.mjs   # exit 0
```

The probe opened `file:///tmp/p1-release-audit/published.html`, the downloaded file, in offline contexts at 390, 768, 1280 and 1440 px. It drove the filter form as a user would: select and fill the fields, press **Apply filters**, and press **Clear filters** between views. For each view it compared the four sales totals, the three collections totals and every row of the four breakdown tables (billing month, business unit, due month, payment schedule) with SQL. The views were chosen to differ from those in the release record, apart from the two anchors:

| View | Invoiced sales | Invoices | Lines | Commission | Scheduled / installments / invoices |
| --- | --- | --- | --- | --- | --- |
| unfiltered | R$ 87.963.059,70 | 6,468 | 19,361 | R$ 4.398.178,70 | R$ 87.963.059,70 / 12,757 / 6,468 |
| Agro, 2025 | R$ 15.584.715,50 | 1,059 | 3,128 | R$ 779.239,89 | R$ 15.584.715,50 / 2,059 / 1,059 |
| Home & Garden, 2023 | R$ 7.600.038,20 | 685 | 2,090 | R$ 380.006,86 | R$ 7.600.038,20 / 1,356 / 685 |
| seller S03 | R$ 19.739.253,20 | 1,536 | 4,607 | R$ 986.968,28 | R$ 19.739.253,20 / 3,386 / 1,536 |
| seller S01, Home & Garden, 2024-07-01 to 2024-12-31 | R$ 2.668.539,00 | 217 | 632 | R$ 133.427,58 | R$ 2.668.539,00 / 428 / 217 |
| customer C0178 (the Home & Garden customer with the most invoices) | R$ 2.855.651,70 | 73 | 318 | R$ 142.783,08 | R$ 2.855.651,70 / 209 / 73 |
| 2024-11-15 to 2025-02-10 (crosses a year) | R$ 4.182.809,00 | 302 | 891 | R$ 209.141,49 | R$ 4.182.809,00 / 573 / 302 |
| from 2026-09-01 (the pending delivery's month) | R$ 2.237.277,40 | 145 | 424 | R$ 111.864,49 | R$ 2.237.277,40 / 276 / 145 |
| seller S03 with Home & Garden (no match) | R$ 0,00 | 0 | 0 | R$ 0,00 | R$ 0,00 / 0 / 0 |
| product P107 (the Home & Garden product with the most lines) | R$ 4.028.679,30 | 888 | 894 | R$ 201.434,64 | not shown |
| product P107, 2025 | R$ 1.306.184,20 | 252 | 253 | R$ 65.309,21 | not shown |

- **Totals and breakdowns:** equal to SQL to the cent and to the count in all 11 views at all 4 widths. So were the pre-rendered page before any interaction and the page after **Clear filters**. In every whole-invoice view, the whole-invoice note was shown and both reconciliation checks passed. The empty view showed zero totals and "Nothing matches." tables, with both checks passing.
- **Product-filter suppression:** with P107, alone or with 2025, the sales section showed the line-scope note, and its single check passed. The collections section showed only the "Scheduled collections belong to whole invoices…" notice: no totals, no tables and no check.
- **Other filters:** choosing a business unit without pressing Apply recomputed the report, so the change listener works. A reversed period (2025-12-31 to 2025-01-01) showed "The period start is after its end." and no collections totals. **Clear filters** emptied every field and restored the unfiltered figures.
- **JavaScript disabled:** the pre-rendered unfiltered totals and breakdowns equal SQL.
- **Requests, CSP and errors:** every context requested only the file itself. There were zero `securitypolicyviolation` events, page errors and console messages of any type. The policy in the file is `default-src 'none'; script-src 'sha256-…'; style-src 'sha256-…'; base-uri 'none'; form-action 'none'`. **Positive control:** in a separate context, an `<img>` pointing to `https://example.invalid/probe.png` was injected. Playwright logged the request attempt, and the page reported it as an `img-src` violation. That context was offline too.
- **Layout:** in all 44 view/width combinations, the document's scroll width equalled the viewport, and no element outside a table wrapper extended past it. At 390 px the table wrappers end at 355 px, and wide tables scroll inside them. Full-page screenshots at 390 px were inspected: unfiltered, Agro 2025, P107, plus unfiltered in dark mode. The due-month labels wrap onto two lines ("2025-" / "01"), which is the known follow-up. At that width, the due-month and payment-schedule amounts are reached by scrolling inside the table. Nothing else overflowed.

### 5. Status documents

Read at `c087b3f`: `README.md`, `CLAUDE.md`, `docs/milestones.md`, `docs/report-snapshot.md`, `docs/setup-verification.md`.

- **Status:** all five agree. Project 1 is complete and released as v1.0.0 on 2026-09-29. Milestones 1–6 are review-approved, 4–6 on 2026-09-29 with R1–R3 closed. The downloaded snapshot was verified. Project 2 belongs in a separate repository. The v1.0.0 facts in `report-snapshot.md` (from `af486a5`, SHA-256 `b7409bd3…`, 942,242 bytes, identical to the artifact and a rebuild) match what this audit found. None of the documents contradicts another.
- **Waivers:** preserved as waived and not performed in `setup-verification.md` (fresh Codespace section, approval section and release section), README (known limits), `milestones.md` and `CLAUDE.md`. `report-snapshot.md` does not cover the Codespace, so it has no reason to mention them.
- **Follow-ups:** both are listed in README (known limits), `CLAUDE.md` and `milestones.md`, with equivalent wording. `setup-verification.md` links to the milestones list and names the due-month wrap as a known follow-up. `report-snapshot.md` mentions neither (O2).

## Non-blocking observations

- **O1, stale wording.** README line 91 still says Projects 2 and 3 "are deferred until Project 1 is complete". That condition is now met. The sentence doesn't contradict anything, but it reads as if Project 1 were still open. The other documents say "Project 2 starts in a separate repository".
- **O2, follow-up not where it applies.** The due-month wrap is a snapshot defect, but `report-snapshot.md` doesn't mention it. A one-line "Known issue" there would keep the two lists aligned.
- **O3, release target.** The release shows `target_commitish: main`, the `gh release create` default, although the tag points to `af486a5`. Because the tag already existed (`--verify-tag`), this is harmless: the asset and source archives come from the tag. On the release page, though, the "main" label no longer means `af486a5`, since `main` has moved to `c087b3f`.
- **O4, re-runs replace the asset.** If a release already exists, the job runs `gh release upload … --clobber`, and GitHub release immutability is off (`immutable: false`). Re-running the tag workflow would therefore replace the published file. Deterministic builds should make the bytes identical, but the recorded digest is the only check. Consider enabling immutable releases or dropping `--clobber` before the next version.
- **O5, already recorded.** `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4` and `actions/download-artifact@v4` target Node 20, which is deprecated, and ran forced on Node 24.
- **O6, a font limit of the test environment, not a defect of the file.** The check marks (`✓`, U+2713) rendered as missing-glyph boxes in the screenshots. The throwaway browser runtime has only Liberation fonts, which lack that character. The DOM text is correct, and ordinary desktop and mobile systems have a fallback font for it. It was not checked on such a system.

Also for the maintainer's information: the branches `milestones-3-6` and `project-1-release-evidence` are still on GitHub. Deleting them is the maintainer's decision.

## Limits

- This is a self-audit by the same assistant that made the release, not an independent review.
- Only headless Chromium on this Codespace was used: no other browser, no second machine or network, and no real phone. Offline means Playwright's offline contexts.
- GitHub data came from read-only REST requests. Tags, releases, runs and the asset download were fetched without authentication. Draft releases, the job logs and the artifact zip need a token, so those requests used the Codespace's GitHub token, read-only. Deleted tags or releases, and the state before the tag was created, cannot be seen afterwards. "No other tag or release" is established only for the present.
- The Postgres behavior tests were not re-run locally, so that the development database would not be touched. The 477-test count comes from the hosted log. The local check on the tagged tree ran with those tests skipped.
- The snapshot's embedded data was compared with the database through the rendered page, not by decoding its JSON directly.
- The maintainer's waived browser steps through a Codespace's forwarded address remain waived and were not performed.
