import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";

export async function isolatedSupervisorArguments(argv, seed = process.pid) {
  const result = [...argv], existing = new Set(argv), reservations = [];
  // The old PID-derived 40000-59999 ports overlapped Linux's automatic
  // client/test socket allocations. Keep these listeners outside that range
  // and check availability while reserving the whole fixture's port set.
  const ephemeral = process.platform === "linux"
    ? (await readFile("/proc/sys/net/ipv4/ip_local_port_range", "utf8")).trim().split(/\s+/).map(Number)
    : [32768, 65535];
  const flags = [
    "--hearmeout-web-port",
    "--dsh-web-port",
    "--streamweaver-web-port",
    "--mountainview-web-port",
    "--companion-web-port",
  ];
  let cursor = (seed % 4000) * 5;
  try {
    for (const flag of flags.filter(flag => !existing.has(flag))) {
      let assigned = false;
      for (let attempt = 0; attempt < 20000; attempt++) {
        const port = 10000 + (cursor++ % 20000);
        if (port >= ephemeral[0] && port <= ephemeral[1]) continue;
        if (existing.has(String(port))) continue;
        const server = createServer();
        try {
          await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(port, "127.0.0.1", resolve);
          });
        } catch (error) {
          if (error.code === "EADDRINUSE" || error.code === "EACCES") continue;
          throw error;
        }
        reservations.push(server);
        result.push(flag, String(port));
        assigned = true;
        break;
      }
      if (!assigned) throw new Error("No isolated supervisor test port is available outside the ephemeral range");
    }
    return result;
  } finally {
    await Promise.all(reservations.map(server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
  }
}

const entry = process.argv[1] ? basename(process.argv[1]) : "";
if (entry === "run-supervised-sandbox.mjs") {
  process.argv = await isolatedSupervisorArguments(process.argv);
}
