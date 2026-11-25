# Capability map and routing

This map is a discovery aid, not a promise that every integration is connected in every session. Always inspect the live tool catalog and schemas.

| Work | First route | Evidence required |
| --- | --- | --- |
| Prior decisions / resume | Conversation context, personal context, project checkpoint | Retrieved decision and current state |
| Repository work | GitHub integration and canonical repo | Diff, commit SHA, read-back |
| GitHub repository administration | Connected GitHub integration first; owner-approved `SPMT_GITHUB_ADMIN_TOKEN` via Actions when required | API result and read-back; never expose token |
| Tests / packaging | Existing repo scripts and GitHub Actions | Run, job, artifact, checksum |
| Apollo owner operations | Authenticated Apollo owner API | Exact response and operation ID |
| Hostless runtime | Existing Node 1/2 control and app APIs | Node/app, SHA, health, behavior |
| Persistence | Existing DB adapter and ownership docs | Read/write/restart/backup proof |
| Research | Web search and primary sources | Current cited evidence |
| Creative assets | Connected image/video/3D tools and existing pipeline | Render/export and file verification |
| Long-running work | Existing Bulletin/task/checkpoint system | Read-back checkpoint and next action |

## Discovery rules

- Search tools by capability and operation synonyms.
- Read complete schemas before calls.
- Distinguish direct tool access from an app's internal credentials.
- Distinguish `GITHUB_TOKEN`, GitHub App credentials, and `SPMT_GITHUB_ADMIN_TOKEN`; do not assume one authority is available to another connector.
- Prefer existing implementations over parallel systems.
- If a first route fails, diagnose and pivot.
