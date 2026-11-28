export function readinessStatus({ browserRequired = false, browserStarted = false, browserSessionReady = browserStarted, persistenceRequired = false, persistenceAvailable = false, cronRequired = false, cronAuthConfigured = false, cronExecutionConfirmed = false, dispatcherLeaseRequired = false, dispatcherLeaseAvailable = false, taskControlPersistenceRequired = false, taskControlPersistenceReady = false } = {}) {
  const ready = (!browserRequired || browserSessionReady) && (!persistenceRequired || persistenceAvailable) && (!cronRequired || (cronAuthConfigured && cronExecutionConfirmed)) && (!dispatcherLeaseRequired || dispatcherLeaseAvailable) && (!taskControlPersistenceRequired || taskControlPersistenceReady);
  return { ready, statusCode: ready ? 200 : 503 };
}

export function isReadinessResponseReady(path, payload) {
  if (!payload || typeof payload !== "object") return false;
  if (path === "/health/ready") {
    if (typeof payload.ready === "boolean") return payload.ready;
    if (payload.live !== true || !["ready", "degraded"].includes(payload.state)) return false;
    return payload.storage?.ready !== false;
  }
  return payload.ready === true;
}
