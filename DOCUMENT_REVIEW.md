# Documentation Review and Removal Defense

This review classifies source material; it does not delete source files.

## Proposed canonical set

After debate, the maintained blueprint should remain small:

- `CURRENT_STATE.md` — dated, verified reality only;
- `BLUEPRINT.md` — approved target architecture;
- `DECISIONS.md` — accepted decisions and open disputes;
- `APP_CONTRACTS.md` — mandatory integration rules;
- `OPERATIONS.md` — build, migration, cutover, rollback, and cost gates.

Product/user documentation belongs with the product that serves it. Historical evidence belongs in a tagged archive or release artifact, not mixed into the canonical architecture.

## Major classifications

| Source/group | Proposed action | Defense | Cost/risk of action | Cost/risk of keeping current |
|---|---|---|---|---|
| SpaceMountain `docs/` plus `public/docs/` mirrors | Keep one source tree; generate/copy public output during build | Removes 66 same-path duplicates and prevents drift | Build pipeline must be proven before old runtime copies disappear | Every edit can diverge or be applied to the wrong copy |
| SpaceMountain `spec/` plus `public/spec/` mirrors | Keep one source tree; generate published output | Removes 13 duplicate spec paths | Same deployment dependency risk | Conflicting contracts and needless repository weight |
| `PRODUCTION_ROADMAP.md` | Extract verified current facts and approved decisions; archive the original snapshot | It mixes history, observations, plans, incidents, tickets, and claims across more than ten gates | Some useful context is harder to browse; preserve raw evidence | It cannot reliably answer “what is true now?” and encourages implementation from stale paragraphs |
| Root TODO/roadmap/checklist files | Merge unresolved owner-approved items into one backlog after blueprint approval; archive or remove originals | One work queue prevents whack-a-mole planning | A careless merge can drop a valid obligation | Competing priorities and duplicate definitions of done |
| `production-manifest.json` | Rebuild from live capture; keep old file as dated evidence | It explicitly says it is documentation-only and contains captured state | Requires access to live Fly/GitHub/database metadata | Stale machine/database claims look authoritative |
| `SPMT_PRODUCTION_INVENTORY.md` | Extract verified ownership, health, restore, and workspace facts; rewrite | Contains valuable evidence but also legacy secret rotation and single-SQLite assumptions | Requires careful provenance | Old operational details become accidental architecture |
| `auth-migrations.json` | Keep as temporary migration ledger until every legacy path has zero observed use, then archive | It is the best concrete map of current auth debt | Removing too early could strand callers | Treating it as permanent normalizes legacy keys forever |
| `DATA_OWNERSHIP.md` | Replace with the explicit one-fact/one-authority table | Current “apps own app-specific state” is too broad for cross-app cards, points, themes, images, and counters | Central boundary needs debate | Ambiguity recreates competing databases |
| `IDENTITY.md`, `SECURITY_MODEL.md`, `OAUTH_FLOW.md` | Merge their valid rules into approved auth contracts; verify implementation separately | The core model is sound and worth preserving | Claims of tested behavior must not survive without new proof | Three overlapping sources can drift |
| `EVENT_BUS.md`, event catalogs/payloads, integration patterns | Keep contract content, version it, and separate implemented from proposed events | Decoupling is correct; current docs do not prove runtime delivery semantics | Requires schema registry/testing discipline | Apps hard-code one another or assume imaginary events |
| `APP_LIFECYCLE.md` | Rewrite from product install lifecycle into runtime state/lease contract plus user lifecycle | Current eight-word lifecycle is insufficient for Fly behavior | More operational detail to maintain | Cold starts, drains, workers, and unavailable states remain undefined |
| `OBSERVABILITY.md` | Rewrite as measurable SLO, cost, tracing, and retention requirements | Current aspirational list lacks thresholds and evidence | Monitoring itself costs money | Empty logs and green health endpoints continue to hide failures |
| Firebase/Firestore references | Remove from canonical/current docs; retain only in immutable historical evidence if needed | Owner confirms Firebase has been gone for a year; compatibility language sends work in the wrong direction | Historical migrations may lose context unless archived | Engineers may restore dead dependencies or back up nonexistent stores |
| `COSMO_COMMLINK_INTEGRATION_PLAN.md` | Archive as historical research; extract only owner-approved product behavior | It embeds Firebase migration assumptions and old repo/typecheck history | Valuable UX ideas need deliberate extraction | Old technical assumptions cloud current architecture |
| `GATE_0_BACKUP_RESTORE.md` | Re-capture live stores; remove Firebase clauses and stale volume claims | Backup documents must describe actual authorities | Requires new restore drills | False recovery confidence is worse than no claim |
| Marketing, pitch, social, and website-copy documents | Move out of the architecture repository or keep only in product/brand docs | They are not runtime contracts | Splitting docs creates another location | Product promises can be mistaken for implemented capability |
| Release notes, launch plans, old checklists | Preserve in tagged release/archive evidence; exclude from canonical tree | Historical proof has value without governing new work | Archive search is less immediate | Canonical docs remain bloated and contradictory |

## Explicit removals from the new architecture

| Remove | Why | What replaces it |
|---|---|---|
| Firebase/Firestore runtime, migration, backup, and compatibility paths | Retired and misleading | chosen canonical database/object storage and verified import sources |
| Universal SPMT API/system key | Excess privilege, unclear actor, hard rotation | scoped service identity and short-lived token |
| Provider token used as internal auth | Provider compromise becomes internal compromise | direct module call or scoped service token |
| Separate canonical point balances | Guarantees drift | one append-only ledger and rebuildable projections |
| Direct app mounts to the authoritative shared volume | Fly cannot share a volume across apps/Machines | the storage-authority app mounts it and serves SDK/API/CLI/MCP/WSS contracts; apps may keep small clearly classified local volumes |
| Silent local database fallback | Creates hidden split brain | fail readiness and show recoverable degraded state |
| Fake shell mutations/fake AI success | Destroys trust and hides outages | explicit loading, accepted-job, degraded, retry states |
| One isolated Machine per ordinary persona | Expensive and unnecessary for request-level persona state | pooled inference with isolated context; isolate only when justified |
| “Unlimited” AI usage | Unbounded cost risk | high but bounded weighted allowances |
| Documentation claims as proof | Text can be stale | automated contract tests and dated live evidence |

## Items not yet safe to delete anywhere

- current production repositories and their branches;
- live Fly apps, Machines, volumes, secrets, and DNS routes;
- old databases or point ledgers;
- auth compatibility paths with observed callers;
- mirrored public documentation required by the current build;
- historical documents before this evidence snapshot is durably published.

Deletion occurs only after the corresponding replacement, verification, rollback, and retention decision is accepted.
