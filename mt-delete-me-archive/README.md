# Quarantined legacy material

This directory is a temporary holding area for files identified during the ApolloStation repository hygiene project as historical, superseded, duplicated, or no longer operationally authoritative.

## Rules

- Nothing is moved here solely because it is old or dated.
- Before moving a file, check code, package scripts, workflows, documentation links, and tests for references.
- Preserve original relative paths beneath this directory so material can be traced back and exported to the SPMT storage repository.
- Do not place secrets, credentials, private keys, live database files, or generated user data here.
- Keep a manifest for every batch: original path, archived path, reason, date, and reference-check result.
- Archive first; permanent deletion is a separate owner-approved action after the storage-repository copy is verified.

## Current status

The directory is established as the quarantine destination. No source files have been moved yet. The first inventory found 1,665 tracked files, including 407 Markdown/text files. Active application contracts, current runbooks, required licenses, developer instructions, and build/runtime documentation are not archive candidates.

See the repository cleanup pull request for the audited batches and verification evidence.
