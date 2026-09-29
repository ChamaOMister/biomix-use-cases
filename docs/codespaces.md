# GitHub Codespaces workflow

GitHub Codespaces is the primary development and demo environment for this public FDE portfolio. Start with the [README setup steps](../README.md#run-in-github-codespaces-primary-environment). The repository must be published before GitHub can create a Codespace from it.

## What runs where

| Component | Location |
| --- | --- |
| Node.js, npm, Next.js, XLSX parsing, tests and builds | GitHub Codespace Linux container |
| Postgres 17 (stored feed data) | Second dev-container service, data in a Docker volume |
| Editor | VS Code in your browser, connected to the Codespace |
| Upload picker, accepted XLSX report state and its calculations | Your browser |
| Stored-data report calculations | SQL in Postgres, rendered by the Next.js server |
| Source and installed dependencies | Codespace filesystem |

Selecting an XLSX file in the app sends its bytes to the cloud server for validation. The application does not persist uploads; accepted lines stay in the browser tab and disappear on reload. Use reviewed fictional data for portfolio demos. A file selected through the browser does not need to be copied into the repository first. No demo workbook is bundled yet.

Codespaces cannot access paths on your Mac. Work from the repository root in the Codespace terminal. Files manually copied into `data/private/` are cloud files even though Git ignores them; ignore rules do not anonymize data or prevent uploads.

## Start, check and resume

The devcontainer installs the pinned Node version, starts Postgres and, on creation/rebuild, runs `npm ci`, `npm run setup:env` and `npm run db:migrate`. Workspace setup waits for those steps to finish. See [the database guide](database.md) for loading the synthetic feed. Start the server in the Codespace terminal:

```sh
npm run dev
```

Open port **3000** from the Ports panel. The app binds to `0.0.0.0` inside the container, and GitHub supplies the browser-facing HTTPS address. `next.config.ts` allows the development origin for this Codespace using GitHub's environment variables; no hostname needs to be entered manually.

GitHub forwards ports privately by default. Verify **Port Visibility → Private** in the Ports panel, especially when reusing a Codespace. A public repository does not require a public preview port. See [GitHub's port forwarding documentation](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace).

To check the project, stop the dev server with Ctrl+C and run:

```sh
npm run check
```

This runs lint, type checking, behavior tests and a production build. Restart `npm run dev` afterward. GitHub Actions runs the same check on pushes and pull requests.

When resuming a stopped Codespace, run `npm run dev` again if the server is no longer running. After a dependency/lockfile change, stop the server and run `npm ci`. After a devcontainer change, use **Codespaces: Rebuild Container** from the command palette. Commit and push work you want to retain before deleting a Codespace, and stop the Codespace when finished using it.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Browser cannot open `localhost:3000` | Use the forwarded address from the Codespace Ports panel |
| Preview is unavailable | Confirm `npm run dev` is running and port 3000 is forwarded |
| Next.js chooses port 3001 | Stop the extra server and restart on 3000; forwarding and development-origin configuration target port 3000 |
| Setup fails during `npm ci` | Inspect the creation log and resolve the installation error before starting the app |
| Development-origin warning | Use this Codespace's forwarded address and rebuild if configuration changed; keep the origin allowlist scoped to the Codespace |
| The XLSX report vanishes after reload | Expected: uploaded workbooks are not stored; select the workbook again |
| Report says the database is not configured or unreachable | Rebuild the container (Codespaces created before milestone 4 have no Postgres), then run `npm run db:migrate` |
| Report says no deliveries have been applied | Run `npm run generate:data`, then `npm run feed:send -- data/generated/feed/deliveries` |
| `feed:send` reports `FEED_NOT_CONFIGURED` or `UNAUTHORIZED` | Run `npm run setup:env` and restart `npm run dev` so the server reads `.env.local` |
| `feed:send` reports `409 DELIVERY_ID_REUSED` | The files were regenerated with different content under the same delivery IDs; run `npm run db:reset -- --yes` and send again |

## Fresh-Codespace verification

A fresh Codespace was checked on 2026-09-29. The terminal checks passed, and the maintainer waived the browser, hot-reload and stop/resume steps. See [setup verification](setup-verification.md#fresh-codespace-2026-09-29). To repeat the verification, run these in a newly created Codespace and record results in [setup-verification.md](setup-verification.md):

- Confirm `node --version` is `v24.21.0` and dependency installation completed.
- Confirm Postgres is running and migrated (`npm run db:migrate` reports the migration as already applied).
- Run `npm run check` and record the result; the database tests must run, not skip.
- Generate the feed, send the deliveries with `npm run feed:send`, and check the report in the browser.
- Run `npm run dev`, open the forwarded HTTPS preview, and verify port 3000 is private.
- Complete [manual browser QA](manual-qa.md) with reviewed fictional workbooks, including upload success, validation failure, filters and reset.
- Edit a visible UI label temporarily, verify hot reload through the forwarded URL, then revert the edit.
- Stop/resume the Codespace, restart the dev server and verify the preview again.

Configuration review and checks on a developer machine do not establish that a fresh cloud container works. Record hosted results only after performing them.
