export function mergeNebulaRuntimeConfig(saved, discovered) {
  if (!saved || saved.schemaVersion !== 1 || !Array.isArray(saved.tenants)) {
    throw new Error("NEBULA_ARCADE_RUNTIME_CONFIG_JSON must be a version 1 tenant configuration.");
  }
  if (!discovered || discovered.schemaVersion !== 1 || !Array.isArray(discovered.tenants)) {
    throw new Error("Discovered Chat Gateway connections are not a version 1 tenant configuration.");
  }
  const tenants = new Map(saved.tenants.map((tenant) => [tenant.tenantId, {
    ...tenant,
    channels: Array.isArray(tenant.channels) ? [...tenant.channels] : [],
  }]));
  for (const incoming of discovered.tenants) {
    if (!incoming || typeof incoming.tenantId !== "string" || !Array.isArray(incoming.channels)) continue;
    let tenant = tenants.get(incoming.tenantId);
    if (!tenant) {
      tenant = { ...incoming, channels: [] };
      tenants.set(incoming.tenantId, tenant);
    }
    const keys = new Set(tenant.channels.map((channel) =>
      [channel.provider, channel.connectionId, channel.channelId].join("\\0")));
    for (const channel of incoming.channels) {
      const key = [channel.provider, channel.connectionId, channel.channelId].join("\\0");
      if (!keys.has(key)) {
        tenant.channels.push(channel);
        keys.add(key);
      }
    }
  }
  return {
    schemaVersion: 1,
    revision: "hostless-chat-gateway-connection-registry-v3",
    tenants: [...tenants.values()],
  };
}
