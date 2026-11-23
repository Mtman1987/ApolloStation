export function resolveNode1StellarChatConfig(nodeCredential, sharedCredential) {
  const credential = [nodeCredential, sharedCredential]
    .find(value => typeof value === "string" && value.trim())?.trim() || "";
  return { enabled: credential ? "1" : "0", credential };
}
