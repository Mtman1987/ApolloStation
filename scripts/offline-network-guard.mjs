import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const marker = Symbol.for("apollostation.offline-network-guard");

if (!globalThis[marker]) {
  globalThis[marker] = true;
  process.env.SPMT_OUTBOUND_MODE = "disabled";
  installFetchGuard();
  installRequestGuard(http, "http");
  installRequestGuard(https, "https");
  installSocketGuard(net, "connect", "tcp");
  installSocketGuard(net, "createConnection", "tcp");
  installSocketGuard(tls, "connect", "tls");
}

function installFetchGuard() {
  if (typeof globalThis.fetch !== "function") return;
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const value = typeof input === "string" || input instanceof URL ? input : input?.url;
    assertLoopbackUrl(value, "fetch");
    return original(input, init);
  };
}

function installRequestGuard(module, label) {
  for (const name of ["request", "get"]) {
    const original = module[name];
    module[name] = function guardedRequest(...args) {
      assertRequestTarget(args[0], label);
      return original.apply(this, args);
    };
  }
}

function installSocketGuard(module, name, label) {
  const original = module[name];
  module[name] = function guardedSocket(...args) {
    assertSocketTarget(args, label);
    return original.apply(this, args);
  };
}

function assertRequestTarget(value, label) {
  if (typeof value === "string" || value instanceof URL) {
    assertLoopbackUrl(value, label);
    return;
  }
  if (!value || value.socketPath) return;
  assertLoopbackHost(value.hostname ?? value.host ?? "localhost", label);
}

function assertSocketTarget(args, label) {
  const first = args[0];
  if (typeof first === "object" && first !== null) {
    if (first.path) return;
    assertLoopbackHost(first.host ?? first.hostname ?? "localhost", label);
    return;
  }
  const host = typeof args[1] === "string" ? args[1] : "localhost";
  assertLoopbackHost(host, label);
}

function assertLoopbackUrl(value, label) {
  if (!value) return;
  const url = value instanceof URL ? value : new URL(String(value), "http://localhost");
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return;
  assertLoopbackHost(url.hostname, label);
}

function assertLoopbackHost(value, label) {
  const rawHost = String(value).toLowerCase();
  const host = rawHost.startsWith("[")
    ? rawHost.slice(1, rawHost.indexOf("]"))
    : /:\d+$/.test(rawHost) && !rawHost.includes("::")
      ? rawHost.replace(/:\d+$/, "")
      : rawHost;
  const allowed = host === "localhost"
    || host.endsWith(".localhost")
    || host === "0.0.0.0"
    || host === "::1"
    || host === "::ffff:127.0.0.1"
    || /^127(?:\.\d{1,3}){3}$/.test(host);
  if (!allowed) throw new Error(`OFFLINE_NETWORK_BLOCKED: ${label} attempted to reach ${value}`);
}
