# Private Athena and Stella Fly runtime

This deploys the pinned v3.1 package to the existing `spmt-agents` app. It has
one OpenAI Responses runner for both personas. The package is private and must
be supplied from its separately stored, hash-pinned archive. Never commit the
archive, its extracted corpus, or credentials to this public repository.

The deployment sends the private archive to Fly's remote builder and embeds
the installed package in the app's private image. Do this only with the owner's
specific approval to place that package on Fly. The bootstrap checks the
SHA-256 recorded in `scripts/agents/package-lock.json` and runs the package's
offline checks before build. The Dockerfile checks it again during build.

Install `OPENAI_API_KEY` and `AGENT_SERVICE_TOKEN` as Fly app secrets. Then:

```bash
FLYCTL_BIN=/absolute/path/to/flyctl ./deploy/agents/deploy.sh \
  /absolute/path/Athena_Stella_Agent_Package_v3.zip
```

No public IP or Fly HTTP service is configured. A private IPv6 listener accepts
`GET /health` and `POST /v1/respond` on port 8080 from the Fly private network.
The latter requires `Authorization: Bearer <AGENT_SERVICE_TOKEN>` and a JSON
object containing `persona` (`athena` or `stella`), `message`, and optional
`context` and `history`. Only an authenticated host should supply trusted
owner, tenant, or user context. Calls have no tool transport; the canonical
tool registry is not exposed until the host's authenticated SPMT transport is
connected. A healthy Machine alone does not mean ChatGPT or StreamWeaver is
integrated.

`OPENAI_CHAT_MODEL` defaults to `gpt-4.1-mini`. These are inference agents
using the package instructions and filtered knowledge. The training inputs
remain candidate data; no fine-tuning job is launched by this service.
