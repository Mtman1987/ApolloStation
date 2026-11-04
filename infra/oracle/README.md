# ApolloStation — Oracle Cloud foundation

This is the initial, deliberately small OCI foundation for the permanent Apollo host. It provisions one Ubuntu ARM flexible compute instance, a VCN, public subnet, internet gateway, route table and network security group. SSH is restricted to `admin_cidr`; only HTTP/HTTPS are public.

## Before applying

1. Create the Oracle Cloud account and choose the home region.
2. Create a compartment dedicated to Apollo.
3. Create an API signing key and OCI CLI profile; keep the private key outside this repository.
4. Select a currently available Ubuntu ARM64 image OCID in that region.
5. Create an SSH key and set `admin_cidr` to your own fixed public IP.
6. Copy `terraform.tfvars.example` to `terraform.tfvars`, fill values locally, and review `terraform plan`.

Do not apply this until account, billing limits, region, quotas and the instance shape are confirmed. OCI Always Free capacity is not guaranteed. The default A1 shape values are starting values, not a promise of capacity or cost.

## Apply

From this directory, with Terraform and OCI credentials configured:

```sh
terraform init
terraform fmt -check
terraform validate
terraform plan
# Apply only after reviewing the plan and estimated cost:
terraform apply
```

The resulting public IP is an origin target only. Do not point production DNS at it until Apollo services, persistent volumes, backups, TLS, secrets, monitoring and rollback are configured.

## State and secrets

- Keep Terraform state private and backed up; move it to an OCI Object Storage backend after the account exists.
- Never commit `terraform.tfvars`, state files, API private keys, bot tokens, provider credentials, OAuth secrets or database exports.
- Use OCI Vault for runtime secrets; inject them at deployment time, never into images or Git.
- Use encrypted block volumes/Object Storage for durable databases and media. Back up before every migration.

## Local speech worker topology

The no-cost Kokoro TTS implementation lives in `workers/free-tts/`. Its Dockerfile
downloads the pinned ONNX model and voice pack during image build, verifies both
SHA-256 digests, and performs a real startup inference before the health endpoint
reports ready. The Compose fragment exposes port 8080 only to its private Compose
network; it does not publish a host port.

When the final Oracle Compose stack is assembled, include the `kokoro-tts`
service on the internal application network and run the compiled Stellar speech
worker with `STELLAR_KOKORO_TTS_URL=http://kokoro-tts:8080`,
`SPMT_ORIGIN`, and the existing `STELLAR_WORKER_CREDENTIAL`. That worker reports
`executionTarget=self-hosted` and only the TTS synthesis capability. It is not a
Sprite worker. Paid transcription remains a separate opt-in capability and is
not required for local Kokoro synthesis.

## Scope boundary

This foundation does not yet deploy the application stack. The service topology and per-app container entrypoints must be reconciled against the actual Apollo package scripts and worker requirements before we add a production Compose manifest. Do not expose database, Redis, worker or internal API ports publicly.
