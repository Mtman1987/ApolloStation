import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const speechOutbound=process.env.SPMT_SPEECH_OUTBOUND_ENABLED==="1";
const speechPolicy=speechOutbound?await import('../apps/stellar-core/dist/speech-provider.js'):undefined;
const privateFlowOpenAi=process.env.SPMT_PRIVATE_FLOW_OPENAI_ENABLED==="1"||process.env.SPMT_STELLAR_OPENAI_ENABLED==="1";
const hearMeOutBridge = process.env.HEARMEOUT_CONTROLLED_BRIDGE === "1" && process.env.HEARMEOUT_VOICE_BRIDGE_ORIGIN === "https://hmo-dj-worker.fly.dev";
const hearMeOutPreparedMedia = process.env.HEARMEOUT_PREPARED_MEDIA_ENABLED === '1' && process.env.HEARMEOUT_VOICE_BRIDGE_ORIGIN === 'https://hmo-dj-worker.fly.dev';
const preparedMediaUrl = hearMeOutPreparedMedia
  ? (await import('../apps/hearmeout/dist/prepared-media.js')).preparedHearMeOutUrl : () => false;
const browserCacheUrl=hearMeOutPreparedMedia?(await import('../apps/hearmeout/dist/prepared-media.js')).hearMeOutBrowserCacheUrl:()=>false;
const movieProvider=process.env.HEARMEOUT_MOVIE_PROVIDER_ORIGIN==='https://hearmeout-main.fly.dev';
const hearMeOutLoungeDonor=process.env.HEARMEOUT_SINGLE_BROADCAST==="1"&&process.env.HEARMEOUT_VOICE_BRIDGE_AUTHORIZATION&&process.env.HEARMEOUT_VOICE_BRIDGE_ORIGIN==="https://hmo-dj-worker.fly.dev";
const movieProviderUrl=movieProvider?(await import('../apps/hearmeout/dist/movie-provider.js')).hearMeOutMovieProviderUrl:()=>false;
const avatarAiOutbound=process.env.SPMT_AVATAR_AI_OUTBOUND_MODE==="enabled";
// A controlled HearMeOut release is allowed to execute normal room actions in
// Green. The guard below still prevents arbitrary network egress, so Twitch and
// Discord message delivery remains blocked while the bounded voice bridge,
// prepared media, local AI and browser room features can be exercised for real.
const controlledHearMeOutActive=hearMeOutBridge;
// Only HMO's provisioned broadcast process can open its DNS-pinned public
// media sockets. The Sprite DNS policy still limits the reachable domains.
const publicMediaAddress = process.env.HEARMEOUT_CONTROLLED_MEDIA === "1"
  ? (await import("../apps/hearmeout/dist/broadcast-egress.js")).isPublicBroadcastAddress
  : () => false;
const marker = Symbol.for("apollostation.offline-network-guard");
const liveReadUrl = configuredLiveReadUrl(process.env.SPMT_LIVE_READ_ORIGIN);

if (!globalThis[marker]) {
  globalThis[marker] = true;
  process.env.SPMT_OUTBOUND_MODE = controlledHearMeOutActive ? "active" : "disabled";
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
  if (["GET", "HEAD"].includes(String(value.method ?? "GET").toUpperCase()) && mediaSocket(value.hostname ?? value.host, value.port ?? 80)) return;
  if (isLiveReadHost(value.hostname ?? value.host) && String(value.method ?? "GET").toUpperCase() === "GET") return;
  assertLoopbackHost(value.hostname ?? value.host ?? "localhost", label);
}

function assertSocketTarget(args, label) {
  const first = args[0];
  if (typeof first === "object" && first !== null) {
    if (first.path) return;
    if (mediaSocket(first.host ?? first.hostname, first.port)) return;
    if (isLiveReadHost(first.host ?? first.hostname ?? first.servername) && Number(first.port ?? 443) === 443) return;
    if ((hearMeOutBridge || hearMeOutPreparedMedia) && String(first.host ?? first.hostname ?? first.servername) === "hmo-dj-worker.fly.dev" && Number(first.port ?? 443) === 443) return;
    if(speechPolicy?.isStellarSpeechHost(first.host??first.hostname??first.servername)&&Number(first.port??443)===443)return;
    if(privateFlowOpenAi&&String(first.host??first.hostname??first.servername)==="api.openai.com"&&Number(first.port??443)===443)return;
    if(avatarAiOutbound&&isAvatarAiHost(first.host??first.hostname??first.servername)&&Number(first.port??443)===443)return;
    if((movieProvider||hearMeOutLoungeDonor)&&String(first.host??first.hostname??first.servername)==='hearmeout-main.fly.dev'&&Number(first.port??443)===443)return;
    assertLoopbackHost(first.host ?? first.hostname ?? "localhost", label);
    return;
  }
  const host = typeof args[1] === "string" ? args[1] : "localhost";
  if (mediaSocket(host, first)) return;
  if (isLiveReadHost(host) && Number(first ?? 443) === 443) return;
  if ((hearMeOutBridge || hearMeOutPreparedMedia) && host === "hmo-dj-worker.fly.dev" && Number(first ?? 443) === 443) return;
  if(speechPolicy?.isStellarSpeechHost(host)&&Number(first??443)===443)return;
  if(privateFlowOpenAi&&host==="api.openai.com"&&Number(first??443)===443)return;
  if(avatarAiOutbound&&isAvatarAiHost(host)&&Number(first??443)===443)return;
  if((movieProvider||hearMeOutLoungeDonor)&&host==='hearmeout-main.fly.dev'&&Number(first??443)===443)return;
  assertLoopbackHost(host, label);
}

function assertAllowedUrl(value, method, label) {
  if (!value) return;
  const url = value instanceof URL ? value : new URL(String(value), "http://localhost");
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return;
  if (liveReadUrl && url.origin === liveReadUrl.origin && String(method).toUpperCase() === "GET") return;
  if (String(method).toUpperCase() === 'GET' && movieProviderUrl(url)) return;
  if (hearMeOutLoungeDonor && url.origin === "https://hearmeout-main.fly.dev" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/api/internal/lounge/media" && ["GET","POST"].includes(String(method).toUpperCase())) return;
  if (browserCacheUrl(url,'https://hmo-dj-worker.fly.dev') && (String(method).toUpperCase()==='GET'&&!/\/(audio|video|prepare)$/.test(url.pathname)||String(method).toUpperCase()==='POST'&&/\/(audio|video|prepare)$/.test(url.pathname))) return;
  if (String(method).toUpperCase() === 'GET' && preparedMediaUrl(url, 'https://hmo-dj-worker.fly.dev')) return;
  if (hearMeOutBridge && isAllowedSpotlightWorkerUrl(url, String(method).toUpperCase())) return;
  if (hearMeOutBridge && url.origin === "https://hmo-dj-worker.fly.dev" && !url.username && !url.password && ["GET", "POST"].includes(String(method).toUpperCase()) && /^\/voice-bridge(?:\/(?:gate|audio-profile|receive-gain))?$/.test(url.pathname)) return;
  if (hearMeOutBridge && url.origin === "https://hmo-dj-worker.fly.dev" && !url.username && !url.password && String(method).toUpperCase() === 'POST' && /^\/persona(?:\/speak)?$/.test(url.pathname)) return;
  if(speechPolicy?.isStellarSpeechUrl(url,String(method).toUpperCase()))return;
  if(privateFlowOpenAi&&url.origin==="https://api.openai.com"&&url.pathname==="/v1/responses"&&String(method).toUpperCase()==="POST")return;
  if(avatarAiOutbound&&isAllowedAvatarAiUrl(url,String(method).toUpperCase()))return;
  assertLoopbackHost(url.hostname, label);
}

function isAllowedSpotlightWorkerUrl(url,method){
  if(url.origin!=="https://hmo-dj-worker.fly.dev"||url.username||url.password||url.search||url.hash)return false;
  if(method==="GET"&&url.pathname==="/spotlight/status")return true;
  if(method==="POST"&&(url.pathname==="/spotlight/start"||url.pathname==="/spotlight/consent"))return true;
  return method==="GET"&&url.pathname==="/spotlight/live.mp4";
}

function isAllowedAvatarAiUrl(url,method){
  if(url.protocol!=="https:"||url.username||url.password)return false;
  if(url.hostname==="api.meshy.ai")return (method==="POST"&&url.pathname==="/openapi/v1/image-to-3d")||(method==="GET"&&/^\/openapi\/v1\/image-to-3d\/[A-Za-z0-9-]{8,128}$/.test(url.pathname));
  if(url.hostname==="assets.meshy.ai")return method==="GET";
  if(url.hostname==="api.keentools.io")return (method==="POST"&&url.pathname==="/v1/avatar/init")||(method==="POST"&&/^\/v1\/avatar\/[A-Za-z0-9_-]{4,160}\/process$/.test(url.pathname))||(method==="GET"&&/^\/v1\/avatar\/[A-Za-z0-9_-]{4,160}\/(?:get-status|get-3d-model)$/.test(url.pathname));
  return isSignedS3Url(url)&&(method==="GET"||method==="PUT");
}
function isSignedS3Url(url){return isS3Host(url.hostname)&&url.searchParams.get("X-Amz-Algorithm")==="AWS4-HMAC-SHA256"&&url.searchParams.has("X-Amz-Credential")&&url.searchParams.has("X-Amz-Signature");}
function isAvatarAiHost(value){const host=String(value??"").toLowerCase();return host==="api.meshy.ai"||host==="assets.meshy.ai"||host==="api.keentools.io"||isS3Host(host);}
function isS3Host(value){return /^(?:[a-z0-9.-]+\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(String(value??"").toLowerCase());}

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
function mediaSocket(host, port) { return [80, 443].includes(Number(port)) && publicMediaAddress(String(host ?? "")); }
