import {
  isHostlessDeploymentFailure,
  isHostlessDeploymentSuccessful,
  normalizeHostlessDeploymentStatus,
} from "./deployment-status.mjs";

export class HostlessDeploymentPollError extends Error {
  constructor(message, status = "unknown") {
    super(message);
    this.name = "HostlessDeploymentPollError";
    this.status = status;
  }
}

const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Read the exact Hostless deployment through the authenticated API.
 * The CLI can lose its long-poll connection while a deployment continues;
 * this bounded poll lets the release verify the deployment independently.
 */
export async function waitForHostlessDeployment(options) {
  const {
    fetchImpl = fetch,
    api,
    token,
    app,
    deploymentId,
    timeoutMs = 20 * 60 * 1000,
    intervalMs = 10_000,
    now = Date.now,
    sleep = defaultSleep,
    onStatus = () => {},
  } = options ?? {};

  if (typeof api !== "string" || !api.trim()
    || typeof token !== "string" || !token
    || typeof app !== "string" || !app
    || typeof deploymentId !== "string" || !deploymentId) {
    throw new TypeError("Hostless deployment polling requires api, token, app, and deploymentId.");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new TypeError("Hostless deployment polling timeout and interval must be non-negative numbers.");
  }

  const endpoint = `${api.replace(/\\/+$/, "")}/apps/${encodeURIComponent(app)}/deployments/${encodeURIComponent(deploymentId)}`;
  const deadline = now() + timeoutMs;
  let lastStatus = "unknown";
  let lastError = "";
  let firstPoll = true;
  let polls = 0;

  while (firstPoll || now() < deadline) {
    firstPoll = false;
    polls += 1;
    try {
      const remaining = Math.max(1, deadline - now());
      const response = await fetchImpl(endpoint, {
        headers: { Authorization: token, Accept: "application/json" },
        signal: AbortSignal.timeout(Math.min(20_000, remaining)),
      });

      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          lastError = `HTTP ${response.status}`;
        } else {
          throw new HostlessDeploymentPollError(
            `Hostless deployment status request returned HTTP ${response.status}.`,
            lastStatus,
          );
        }
      } else {
        const body = await response.text();
        let payload;
        try {
          payload = body ? JSON.parse(body) : {};
        } catch {
          payload = undefined;
          lastError = "Hostless deployment status response was not JSON";
        }

        if (payload) {
          const deployment = payload.deployment ?? payload.data?.deployment ?? payload.data ?? payload;
          const status = normalizeHostlessDeploymentStatus(
            deployment.status ?? payload.status ?? deployment.state ?? payload.state ?? "unknown",
          );
          if (status !== lastStatus) {
            lastStatus = status;
            onStatus(status);
          }
          if (isHostlessDeploymentFailure(status)) {
            throw new HostlessDeploymentPollError(
              `Hostless deployment ended as ${status}.`,
              status,
            );
          }
          if (isHostlessDeploymentSuccessful(status)) {
            return { deployment, status, polls };
          }
          lastError = "";
        }
      }
    } catch (error) {
      if (error instanceof HostlessDeploymentPollError) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    }

    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
  }

  const detail = lastError ? `; last API error: ${lastError.slice(0, 160)}` : "";
  throw new HostlessDeploymentPollError(
    `Timed out waiting for Hostless deployment after ${timeoutMs}ms (last status: ${lastStatus})${detail}.`,
    lastStatus,
  );
}
