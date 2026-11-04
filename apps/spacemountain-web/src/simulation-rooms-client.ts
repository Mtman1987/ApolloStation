import { SpmtClient } from "@spmt/sdk";
import { SimulationRoomsUi } from "@spmt/spacemountain/simulation-rooms";

const root = document.getElementById("simulation-rooms-root")!;
const client = new SpmtClient({ baseUrl: window.location.origin, appId: "spacemountain" });
try {
  const session = await client.getSession();
  const tenantId = Array.isArray(session.tenantIds) ? String(session.tenantIds[0] ?? "") : "";
  if (!tenantId) throw new Error("Sign in to Apollo to open your Simulation Rooms.");
  const scopes = Array.isArray(session.scopes) ? session.scopes.map(String) : [];
  const rooms = new SimulationRoomsUi(root, client, tenantId, { canDelete: scopes.includes("workspace:write") || scopes.includes("workspace:*") || scopes.includes("*") });
  rooms.open(new URLSearchParams(window.location.search).get("roomId") ?? undefined);
  rooms.setVisible(true);
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== window.location.origin || event.data?.protocol !== "spmt.workspace" || event.data.version !== 1) return;
    if (event.data.type === "simulation.visibility" && typeof event.data.visible === "boolean") rooms.setVisible(event.data.visible);
  });
  window.addEventListener("pagehide", () => rooms.destroy(), { once: true });
} catch (error) {
  root.textContent = error instanceof Error ? error.message : "Simulation Rooms are unavailable. Sign in to Apollo and try again.";
}
