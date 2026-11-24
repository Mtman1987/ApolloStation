export function readinessStatus({ browserRequired = false, browserStarted = false, persistenceRequired = false, persistenceAvailable = false } = {}) {
  const ready = (!browserRequired || browserStarted) && (!persistenceRequired || persistenceAvailable);
  return { ready, statusCode: ready ? 200 : 503 };
}

export function isReadinessResponseReady(path, payload) {
  if (!payload || typeof payload !== "object") return false;
  if (path === "/health/ready") return payload.ready === true || payload.state === "ready";
  return payload.ready === true;
}
