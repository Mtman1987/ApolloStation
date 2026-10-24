# Standalone Meshy avatar build

This deliberately does **not** depend on a running ApolloStation, StreamWeaver,
Fly.io, Sprite, or tenant database. It reuses the Meshy image-to-3D request
settings already covered by `tests/streamweaver-avatar-pipeline.test.mjs`.

## One-time setup

1. Add a repository Actions secret named `MESHY_API_KEY` in
   **Settings → Secrets and variables → Actions**. Never put the key in source,
   workflow inputs, or chat.
2. Commit the intended source PNG/JPEG to the repository. Use a repository path
   as the workflow input; do not commit private or unrelated user data.
3. From **Actions → Meshy Avatar Build → Run workflow**, select the branch
   containing this workflow and enter that image path.

The workflow requests one textured, PBR, 4K GLB and publishes it as a GitHub
Actions artifact for 14 days. It does not deploy anything or change live apps.
The workflow is manually triggered, serialized to avoid duplicate concurrent
paid jobs, and stops if the source, secret, response, URL host, or GLB header
fails validation.

## Important scope

This produces the 3D model only. It does **not** claim to produce a rigged
avatar or the requested idle/talking MP4s. Those require a separate validated
rigging/animation/render stage. Do not launch duplicate Meshy jobs to try to
obtain those outputs; check the existing task first if a run times out.

The workflow currently needs the image to exist in the selected Git branch.
Library attachments are not automatically available to GitHub Actions.
