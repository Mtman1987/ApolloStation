export interface StreamWeaverChatterV1 {
  providerUserId?: string;
  userLogin: string;
  displayName?: string;
}

/** Exact donor subsequence similarity used by the frozen Athena Bic voice action. */
export function streamWeaverUsernameSimilarity(first: string, second: string): number {
  const left = normalize(first);
  const right = normalize(second);
  const longer = left.length > right.length ? left : right;
  const shorter = left.length > right.length ? right : left;
  if (longer.length === 0) return 1;
  if (shorter.length === 0) return 0;
  let matched = 0;
  for (let index = 0; index < longer.length && matched < shorter.length; index += 1) {
    if (shorter[matched] === longer[index]) matched += 1;
  }
  return matched / shorter.length;
}

export function findBestStreamWeaverUsernameMatch(partialName: string, chatters: readonly StreamWeaverChatterV1[], threshold = 0.6): StreamWeaverChatterV1 | undefined {
  const search = normalize(partialName).replace(/^@/, "");
  if (!search || chatters.length === 0) return undefined;
  const safe = chatters.map(sanitizeChatter).filter((value): value is StreamWeaverChatterV1 => Boolean(value));

  const exact = safe.find((chatter) => normalize(chatter.userLogin) === search || normalize(chatter.displayName ?? "") === search);
  if (exact) return exact;
  const starts = safe.find((chatter) => normalize(chatter.userLogin).startsWith(search) || normalize(chatter.displayName ?? "").startsWith(search));
  if (starts) return starts;
  const contains = safe.find((chatter) => normalize(chatter.userLogin).includes(search) || normalize(chatter.displayName ?? "").includes(search));
  if (contains) return contains;

  let best: StreamWeaverChatterV1 | undefined;
  let bestScore = 0;
  for (const chatter of safe) {
    const score = Math.max(
      streamWeaverUsernameSimilarity(search, chatter.userLogin),
      streamWeaverUsernameSimilarity(search, chatter.displayName ?? ""),
    );
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      best = chatter;
    }
  }
  return best;
}

function sanitizeChatter(value: StreamWeaverChatterV1): StreamWeaverChatterV1 | undefined {
  const userLogin = safeName(value.userLogin);
  if (!userLogin) return undefined;
  const displayName = safeDisplay(value.displayName ?? value.userLogin);
  return {
    ...(value.providerUserId ? { providerUserId: safeId(value.providerUserId) } : {}),
    userLogin,
    ...(displayName ? { displayName } : {}),
  };
}
function normalize(value: unknown): string { return String(value ?? "").trim().toLowerCase(); }
function safeName(value: unknown): string { return String(value ?? "").trim().replace(/^@/, "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80); }
function safeDisplay(value: unknown): string { return String(value ?? "").trim().replace(/[\r\n\u0000-\u001f]/g, " ").slice(0, 120); }
function safeId(value: unknown): string { return String(value ?? "").trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 180); }
