export function readinessStatus({ browserRequired = false, browserStarted = false, persistenceRequired = false, persistenceAvailable = false, ownerActorRequired = false, ownerActorConfigured = false } = {}) {
  const ready = (!browserRequired || browserStarted) && (!persistenceRequired || persistenceAvailable) && (!ownerActorRequired || ownerActorConfigured);
  return { ready, statusCode: ready ? 200 : 503 };
}
