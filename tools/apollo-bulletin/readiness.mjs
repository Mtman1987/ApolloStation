export function readinessStatus({ browserRequired = false, browserStarted = false, persistenceRequired = false, persistenceAvailable = false } = {}) {
  const ready = (!browserRequired || browserStarted) && (!persistenceRequired || persistenceAvailable);
  return { ready, statusCode: ready ? 200 : 503 };
}
