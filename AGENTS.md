# ApolloStation release workflow

Run validation locally before merging or pushing changes to main. Use Node 24,
`npm ci --ignore-scripts`, FFmpeg, and Playwright Chromium
(`npx playwright install --with-deps chromium` for initial setup).

Run `npm run validate:local`. This runs the full serialized contract suite and
all six browser/media checks formerly run by Green shared contracts in GitHub.
Fix failures before merging. Do not claim validation passed if a required check
could not run. User instructions can narrow the validation for an urgent repair.

GitHub Actions deploys main directly. Do not reintroduce automatic test jobs or
make deployment depend on another workflow completing. Keep deployment build,
rollback, and live build/health verification.

There is no local Qwen model for this deployment. Do not provision or launch
Qwen or wait for it. Stella uses the existing OpenAI integration when its private
credential is configured; AI availability must not block the rest of Apollo.
