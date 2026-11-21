const COMMAND_MARKER = "APOLLO_CHROME_COMMAND_V1";
const seen = new Set();
let polling = false;

function parseComment(container) {
  const author = container.querySelector("a.author, a[data-hovercard-type='user'], .author");
  const authorName = (author?.textContent || "").trim();
  const authorHref = author?.getAttribute("href") || "";
  if (authorName !== "github-actions[bot]" && !authorHref.endsWith("/github-actions[bot]")) return null;
  const body = container.querySelector(".comment-body, [data-testid='comment-body'], .markdown-body");
  const content = body?.innerText || body?.textContent || "";
  if (!content.includes(COMMAND_MARKER)) return null;
  const jsonBlock = content.match(/\{[\s\S]*\}/);
  if (!jsonBlock) return null;
  try {
    const command = JSON.parse(jsonBlock[0]);
    if (!command || typeof command.id !== "string" || typeof command.prompt !== "string" ||
        typeof command.conversationUrl !== "string") return null;
    return command;
  } catch { return null; }
}

async function poll() {
  if (polling || !location.pathname.startsWith("/Mtman1987/ApolloStation/pull/553")) return;
  polling = true;
  try {
    const response = await fetch(location.href, { credentials: "include", cache: "no-store" });
    if (!response.ok) return;
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const comments = doc.querySelectorAll(
      ".js-comment-container, [id^='issuecomment-'], [data-testid='issue-comment'], .timeline-comment"
    );
    for (const container of comments) {
      const command = parseComment(container);
      if (!command || seen.has(command.id)) continue;
      seen.add(command.id);
      chrome.runtime.sendMessage({ type: "APOLLO_GITHUB_COMMAND", command }).catch(() => {});
    }
  } catch {
    // GitHub can be temporarily unavailable or require sign-in; retry next interval.
  } finally {
    polling = false;
  }
}
void poll();
setInterval(() => void poll(), 8000);
