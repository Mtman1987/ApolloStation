#!/usr/bin/env node
/**
 * Commit-trigger for the canonical ApolloStation Hostless two-node release.
 * Retest marker: retry after checking the GitHub Actions account restriction.
 *
 * This file is intentionally side-effect free. Updating or committing it to
 * main matches the hostless-three-node-deploy.yml push path filter and starts
 * that workflow's full validation -> Node 1 -> Node 2 -> domain sequence.
 * It never deploys directly and never reads or prints deployment credentials.
 */
if (process.env.GITHUB_REF && process.env.GITHUB_REF !== "refs/heads/main") {
  throw new Error("Apollo Hostless release trigger is main-only.");
}
console.log("Apollo Hostless release trigger marker; deploy through GitHub Actions.");
