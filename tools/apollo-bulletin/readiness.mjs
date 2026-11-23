export function readinessStatus({ browserRequired = false, browserStarted = false, persistenceRequired = false, persistenceAvailable = false, ownerActorConfigured = false, hostlessCronRequired = false, hostlessCronConfigured = false } = {}) {
  const ready =
    (!browserRequired || browserStarted) &&
    (!persistenceRequired || persistenceAvailable) &&
    ownerActorConfigured &&
    (!hostlessCronRequired || hostlessCronConfigured);
  return { ready, statusCode: ready ? 200 : 503 };
}
