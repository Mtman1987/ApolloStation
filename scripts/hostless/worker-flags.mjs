export function optionalWorkerEnabled(flag, credential) {
  return flag === "1" && typeof credential === "string" && credential.trim().length > 0;
}
