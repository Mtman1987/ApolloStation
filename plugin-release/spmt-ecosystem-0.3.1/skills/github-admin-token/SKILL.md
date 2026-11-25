---
name: github-admin-token
description: Safe use of the owner-approved GitHub fine-grained administrator token stored in GitHub Actions repository secrets.
---
# Owner-approved GitHub administration token

## Credential record

- Secret name: `SPMT_GITHUB_ADMIN_TOKEN`
- Repositories: `Mtman1987/ApolloStation` and `Mtman1987/spmt-live`
- Owner confirmed on 2026-11-25 that the fine-grained PAT was saved in both repositories' GitHub Actions secrets.
- The owner configured the token as never-expiring and granted 39 read/write permissions. Treat it as broad, high-impact authority.
- The token value is never stored in this plugin, chat, source code, workflow logs, artifacts, or Hostless runtime secrets.

## Authority boundaries

- This is a separate owner-approved GitHub PAT. It is not the automatic workflow-scoped `GITHUB_TOKEN`, a GitHub App installation token, a Hostless node token, or an Apollo session credential.
- Use it only for explicit owner-authorized GitHub repository administration and automation tasks within the token's granted scope.
- Prefer the connected GitHub integration when it already supports the exact operation. Use the PAT through a workflow only when the owner-approved repository secret is the documented and necessary path.
- Never assume the PAT is available to the ChatGPT GitHub connector or any other integration just because it exists as an Actions secret.
- Never print, retrieve, echo, decode, persist, copy into artifacts, or otherwise expose the token value. Never enable shell tracing around credential-bearing commands.
- Do not add the token to Hostless app environments or ordinary app runtime configuration.
- Do not create replacement tokens or duplicate secrets. Reuse this exact secret name.

## Workflow usage

When a workflow needs the PAT:
1. Confirm the workflow is in one of the two approved repositories and the task is owner-authorized.
2. Reference it only as `${{ secrets.SPMT_GITHUB_ADMIN_TOKEN }}` in the workflow's secret context.
3. Pass it to the required client through a masked environment variable; do not interpolate it into shell source or command-line arguments.
4. Keep permissions/job scope minimal, avoid `set -x`, and do not print request headers or environment dumps.
5. Use the minimum API operation needed; do not use the PAT to bypass required validation, branch protection, review, or deployment gates.
6. Verify the resulting repository setting or workflow effect by reading it back without exposing credential material.

## Lifecycle and least privilege

The owner chose a never-expiring token with broad permissions for recovery. Treat this as an elevated temporary operating posture, not a reason to expand usage. After the recovery work, recommend narrowing permissions or rotating/revoking the token if no longer required. Never change the token's settings or revoke it without explicit owner approval.
