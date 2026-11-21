const SEND_LABELS = new Set([
  "send",
  "send message",
  "send prompt"
]);
const SEND_TEST_IDS = new Set(["send-button", "send-message-button"]);
const STOP_LABELS = new Set(["stop", "stop generating", "stop response", "stop streaming"]);

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isVisible(element) {
  if (!element || element.hidden) return false;
  for (let node = element; node; node = node.parentElement) {
    if (node.getAttribute?.("aria-hidden") === "true") return false;
    const style = getComputedStyle(node);
    if (style.display === "none"
        || style.visibility === "hidden"
        || style.visibility === "collapse"
        || Number(style.opacity) === 0) return false;
  }
  return typeof element.getClientRects === "function" && element.getClientRects().length > 0;
}

function buttonValues(button) {
  return {
    aria: normalize(button.getAttribute("aria-label")),
    testId: normalize(button.getAttribute("data-testid")),
    text: normalize(button.textContent)
  };
}

function isStopButton(button) {
  const values = buttonValues(button);
  return [values.aria, values.testId, values.text].some(value =>
    STOP_LABELS.has(value)
    || value.startsWith("stop generating")
    || value.startsWith("stop response")
    || value.startsWith("stop streaming")
    || value === "stop-button"
  );
}

function isSendButton(button) {
  const values = buttonValues(button);
  return SEND_LABELS.has(values.aria)
    || SEND_LABELS.has(values.text)
    || SEND_TEST_IDS.has(values.testId);
}

function composer() {
  return [...document.querySelectorAll('[contenteditable="true"][role="textbox"], textarea')]
    .find(element => isVisible(element)
      && !element.disabled
      && element.getAttribute("aria-disabled") !== "true") || null;
}

function sendButton() {
  return [...document.querySelectorAll("button")].find(button =>
    isVisible(button)
    && isSendButton(button)
    && !button.disabled
    && button.getAttribute("aria-disabled") !== "true"
  ) || null;
}

function snapshot() {
  const buttons = [...document.querySelectorAll("button")];
  const stopControlVisible = buttons.some(button => isVisible(button) && isStopButton(button));
  const sendControlVisible = Boolean(sendButton());
  const activeComposer = composer();
  const busyText = [...document.querySelectorAll('[aria-busy="true"]')].some(isVisible);
  const busy = stopControlVisible || busyText
    ? true
    : (sendControlVisible && activeComposer ? false : null);
  const assistants = [...document.querySelectorAll('[data-message-author-role="assistant"]')]
    .filter(isVisible);
  const lastAssistant = assistants.at(-1);
  return {
    url: location.href,
    busy,
    stopControlVisible,
    sendControlVisible,
    composerReady: Boolean(activeComposer),
    assistantText: lastAssistant ? (lastAssistant.innerText ?? lastAssistant.textContent ?? "") : "",
    pageVisible: document.visibilityState === "visible"
  };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === "APOLLO_SNAPSHOT") {
    respond(snapshot());
    return;
  }
  if (message?.type !== "APOLLO_SUBMIT") return;

  const initial = snapshot();
  if (message.targetUrl !== location.href
      || initial.pageVisible !== true
      || initial.busy !== false
      || !initial.composerReady
      || !initial.sendControlVisible) {
    respond({ clicked: false, reason: "guard-failed" });
    return;
  }

  const input = composer();
  const button = sendButton();
  if (!input || !button || typeof message.prompt !== "string" || !message.prompt.trim()) {
    respond({ clicked: false, reason: "missing-controls" });
    return;
  }

  if (input.tagName === "TEXTAREA") {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) {
      respond({ clicked: false, reason: "textarea-setter-unavailable" });
      return;
    }
    setter.call(input, message.prompt);
  } else {
    input.focus();
    input.textContent = message.prompt;
  }
  input.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: message.prompt
  }));
  input.dispatchEvent(new Event("change", { bubbles: true }));

  const afterFill = snapshot();
  const currentInput = composer();
  const currentButton = sendButton();
  const currentValue = currentInput?.tagName === "TEXTAREA"
    ? currentInput.value
    : currentInput?.textContent;
  if (message.targetUrl !== location.href
      || afterFill.url !== message.targetUrl
      || afterFill.pageVisible !== true
      || afterFill.busy !== false
      || !afterFill.composerReady
      || !afterFill.sendControlVisible
      || currentValue !== message.prompt
      || !currentButton) {
    respond({ clicked: false, reason: "guard-failed-after-fill" });
    return;
  }

  currentButton.click();
  respond({ clicked: true, note: "Click issued; delivery is not independently confirmed" });
});
