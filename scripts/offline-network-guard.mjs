import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const marker = Symbol.for("apollostation.offline-network-guard");
const liveReadUrl = configuredLiveReadUrl(process.env.SPMT_LIVE_READ_ORIGIN);

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
    assertAllowedUrl(value, String(init?.method ?? (typeof input === "object" && input && "method" in input ? input.method : "GET")), "fetch");
    return original(input, init);
  };
}

function installRequestGuard(module, label) {
  for (const name of ["request", "get"]) {
    const original = module[name];
    module[name] = function guardedRequest(...args) {
      assertRequestTarget(args[0], args[1], label);
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

function assertRequestTarget(value, options, label) {
  if (typeof value === "string" || value instanceof URL) {
    assertAllowedUrl(value, typeof options === "object" ? String(options?.method ?? "GET") : "GET", label);
    return;
  }
  if (!value || value.socketPath) return;
  if (isLiveReadHost(value.hostname ?? value.host) && String(value.method ?? "GET").toUpperCase() === "GET") return;
  assertLoopbackHost(value.hostname ?? value.host ?? "localhost", label);
}

function assertSocketTarget(args, label) {
  const first = args[0];
  if (typeof first === "object" && first !== null) {
    if (first.path) return;
    if (isLiveReadHost(first.host ?? first.hostname ?? first.servername) && Number(first.port ?? 443) === 443) return;
    assertLoopbackHost(first.host ?? first.hostname ?? "localhost", label);
    return;
  }
  const host = typeof args[1] === "string" ? args[1] : "localhost";
  if (isLiveReadHost(host) && Number(first ?? 443) === 443) return;
  assertLoopbackHost(host, label);
}

function assertAllowedUrl(value, method, label) {
  if (!value) return;
  const url = value instanceof URL ? value : new URL(String(value), "http://localhost");
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return;
  if (liveReadUrl && url.origin === liveReadUrl.origin && String(method).toUpperCase() === "GET") return;
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

function configuredLiveReadUrl(value) {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("SPMT_LIVE_READ_ORIGIN must be a credential-free HTTPS origin");
  return url;
}

function isLiveReadHost(value) { return Boolean(liveReadUrl && String(value ?? "").toLowerCase() === liveReadUrl.hostname.toLowerCase()); }
