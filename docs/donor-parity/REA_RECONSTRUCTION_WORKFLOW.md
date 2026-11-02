# REA-assisted Apollo reconstruction workflow

REA (Reverse Engineer Anything) is an optional, evidence-producing investigation tool. It is not a source-code recovery guarantee and it does not establish feature parity by itself.

- Project: https://github.com/sgunin/ReverseEngineerAnything
- Documentation: https://rea.tools/
- License: MIT (verify the current upstream release before adopting it in a product workflow)

## What this first integration does

- Provides `npm run parity:rea -- <target-path>` to run REA's JavaScript application analysis against an explicitly supplied local file or directory.
- Provides a manual GitHub Actions proof-of-concept for the Apollo app trees: HearMeOut, StreamWeaver, Nebula Arcade, and Discord StreamHub.
- Uploads the machine-readable REA report as a workflow artifact. It does not commit generated reports, modify donor repositories, or change parity statuses.
- Uses Node.js 24 because current REA releases require Node 22.19+, 24.11+, or 26+.

This first pass is deliberately static. It inventories JavaScript application structure and relationships; it does not run the app or make authenticated API calls. The workflow analyzes the selected Apollo tree, not a donor checkout. Donor analysis requires an authorized donor source checkout or a legitimately obtained application artifact, supplied to the local CLI.

## Run locally

Install REA using its documented setup and review the changes it proposes for your coding agent:

```sh
npx -y rea-agents@latest setup
npx -y rea-agents@latest doctor
```

Then analyze a local target:

```sh
npm run parity:rea -- apps/hearmeout
# Or point it at an authorized extracted JS/Electron application or bundle:
npm run parity:rea -- /absolute/path/to/authorized-target
```

The command prints JSON to stdout and diagnostics to stderr. Save the report outside the source tree if desired:

```sh
npm run parity:rea -- apps/hearmeout > /tmp/hearmeout-rea-report.json
```

## Investigation loop for each donor capability

1. Start with the exact capability and acceptance criteria in the Apollo parity ledger.
2. Inspect the donor's authorized source or distributable artifact. Record the repository/ref or artifact hash and the exact target path.
3. Use REA to map modules, imports, routes, IPC boundaries, and other available static evidence. Treat inferred relationships as hypotheses until confirmed.
4. For API behavior, separately observe an authorized test account/session and capture representative requests, responses, status codes, pagination, retries, and WebSocket messages. Prefer browser DevTools/CDP or an approved proxy capture. REA's static JavaScript analysis is not an API traffic recorder.
5. Redact cookies, bearer tokens, API keys, signed URLs, personal data, and tenant identifiers before evidence is stored or shared. Never commit raw authenticated HAR files or production credentials.
6. Convert the observed contract into an Apollo-owned interface, implementation, and deterministic fixtures. Do not copy donor secrets, private keys, credentials, or proprietary implementation code.
7. Add positive and negative tests at the real Apollo boundary, including authorization, tenant isolation, retries, reconnects, and replay behavior where relevant.
8. Update the capability ledger only after evidence supports the status. Static source presence and a successful REA run are not proof of runtime parity.

## Safety and evidence rules

- Donor repositories remain read-only.
- Only inspect software and accounts you are authorized to examine.
- Do not bypass authentication, access controls, DRM, or rate limits.
- Do not run unknown donor binaries or scripts as part of static analysis.
- Treat REA output as untrusted analysis data; review it before using it to change Apollo.
- Preserve provenance: target identity, version/ref, analysis date, REA version, findings, limitations, and links to Apollo tests.
- Keep `unknown`, `partial`, and `ported-unverified` distinct. No automatic promotion to `verified`.

## Current limitations

REA's capabilities vary by release and analysis provider. Static JavaScript analysis is the supported first lane here. Website/API capture, native binary decompilation, and runtime tracing may require separate REA providers, host prerequisites, or dedicated observation tools. Confirm upstream support before designing an automated CI lane around those capabilities.

The manual workflow is intentionally opt-in: no scheduled analysis, no secret access, no automatic donor checkout, no application execution, and no automatic code generation or merge.
