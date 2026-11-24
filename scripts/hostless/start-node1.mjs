#!/usr/bin/env node
// Pin this deployment snapshot to its assigned Hostless node.
process.env.APOLLO_NODE_ROLE = "node1";
await import("./start-node.mjs");
