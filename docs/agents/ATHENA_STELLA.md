# Athena and Stella: canonical OpenAI package and runner

The agreed product is **OpenAI API agents with ChatGPT as their front door**.
Athena is the personal companion sister; Stella is the operational sister.
Both use the same package loader, tool registry and Responses runner.

## Current committed handoff

`scripts/agents/package-lock.json` identifies the recovered v3.1 package by its
original archive name and SHA-256. Earlier v1/v2 archives are historical inputs,
not additional runtimes or additional training uploads. The bootstrap installs
one verified version and records it in `current.json`.

ApolloStation is a public repository. The commercial training corpus and
owner-audience knowledge remain in the existing saved archive; the bootstrap
installs that archive locally rather than publishing those files in Git.
No new archive, training version, persona or external platform is required.

From the repository root, with Python 3.10 or later:

```bash
npm run agents:install -- /absolute/path/Athena_Stella_Agent_Package_v3.zip
npm run agents:inspect
npm run agents:test
```

On Windows, `py -3 scripts/agents/bootstrap.py C:\path\Athena_Stella_Agent_Package_v3.zip`
is equivalent. Supply `--root` to install on an existing persistent volume.
The default installation is `.local/agents/athena-stella/v3.1-repaired/`.
Existing modified installations are preserved; choose a separate root to compare.

The bootstrap checks the exact archive hash and reruns its 37 offline utility
tests, schema validation and 35 keyword retrieval checks before installation.

## OpenAI access and conversation

Use the existing `OPENAI_API_KEY` from the host environment; no extra API key,
JWT issuer or new authentication system is introduced. Model configuration is
explicit through `OPENAI_CHAT_MODEL` or `--model`.

```bash
npm run agents:check-openai -- --model YOUR_OPENAI_MODEL_ID
npm run agents:chat -- --model YOUR_OPENAI_MODEL_ID --persona athena --message "Hello Athena"
npm run agents:chat -- --model YOUR_OPENAI_MODEL_ID --persona stella --message "Hello Stella"
```

`check-openai` makes read-only model and fine-tuning-job-list requests. List
access does not prove eligibility to create a fine-tuning job. It never starts
training. `chat` performs paid inference when run with a valid account key.

Both sisters load their actual v3.1 instructions and bounded relevant knowledge.
The reference retrieval filter is enforced before knowledge enters the request.
CLI conversations receive community knowledge only. The existing authenticated
host may pass owner context for a private destination. Responses report the
persona, package version, model, retrieved document IDs, usage and tool receipts.

## Existing runner and tool integration

Import `SisterRunner` from `scripts/agents/openai_runner.py` in the existing host.
`run(persona, message, context, history, allowed_tools, transport)` accepts:

- `context`: the host's authenticated tenant/user and destination, not fields
  trusted directly from a public browser or ChatGPT tool request;
- `history`: scoped user/assistant conversation turns supplied by the host;
- `allowed_tools`: aliases selected from the canonical admitted registry;
- `transport`: the host's existing authenticated SPMT MCP request function.

The same registry supplies schemas and maps aliases such as `spmt_xp_balance`
to the actual `spmt.xp.balance` tool. The runner checks arguments with the
package's existing bridge, sends each call through the supplied transport,
checks the linked JSON-RPC result, and returns the result to OpenAI. It preserves
reasoning output across tool rounds and does not automatically replay a tool
whose delivery/result is uncertain. No tools are advertised when none are wired.

The CLI does not expose a public server. Existing apps keep ownership of their
sessions, conversation storage, tools, overlays and UI. ChatGPT's doorway still
needs to be connected to that authenticated host; installing these scripts does
not create or configure a custom GPT.

Tool-loop implementation follows the [OpenAI function-calling guide](https://developers.openai.com/api/docs/guides/function-calling).

## Training inputs and remaining work

Inside the installed package use only `training/athena_train.jsonl` and
`training/stella_train.jsonl` as the complete candidate training inputs, and the
matching validation files. Each sister has 92 training rows, 14 validation rows
and 26 challenge cases. Do not append `sft/` or `tool_sft/` again: those components
are already merged. Evaluation answers and rejected examples are not RAG inputs.

This commit installs a runnable, shared OpenAI baseline and preserves the agreed
handoff in source control. It does not claim to have trained either model,
configured the ChatGPT doorway, connected the production host, consolidated
unidentified local applications, or completed a customer release. The existing
overlay picker is not replaced by a second UI.

Next execution steps: use the actual OpenAI account to verify access, connect
the host transport and ChatGPT doorway, run the 52 challenge cases, then measure
eligible OpenAI fine-tuning candidates against that baseline. Record model/job
IDs and measured results before presenting the agents as trained products.
