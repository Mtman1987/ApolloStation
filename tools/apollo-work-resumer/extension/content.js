const SEND_LABEL = /^(send message|send prompt|send|send-message|send-button)$/;

function buttonMatchesSend(button) {
  return [button.getAttribute("aria-label"), button.getAttribute("data-testid"), button.textContent]
    .some(value => SEND_LABEL.test(String(value || "").trim().toLowerCase()));
}

function buttonLabel(button) {
  return [button.getAttribute("aria-label"), button.getAttribute("data-testid"), button.textContent]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isVisible(element) {
  if (!element || typeof element.getClientRects !== "function" || element.getClientRects().length === 0) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
}

function isEnabled(button) {
  return !button.disabled && button.getAttribute("aria-disabled") !== "true";
}

function findSendButton({ requireEnabled = false } = {}) {
  return [...document.querySelectorAll("button")].find(button =>
    buttonMatchesSend(button) &&
    isVisible(button) &&
    (!requireEnabled || isEnabled(button))
  ) || null;
}

function composerElement() {
  return document.querySelector('[contenteditable="true"][role="textbox"],textarea');
}

function composerValue(element) {
  if (!element) return "";
  return element.tagName === "TEXTAREA" ? element.value : (element.innerText ?? element.textContent ?? "");
}

function snapshot() {
  const url = location.href;
  const buttons = [...document.querySelectorAll("button")];
  const stopControlVisible = buttons.some(button => /stop generating|stop response|stop streaming/.test(buttonLabel(button)));
  const busyText = document.querySelector('[aria-busy="true"]') !== null;
  const composer = composerElement();
  const value = composerValue(composer);
  const sendPresent = findSendButton() !== null;
  const sendEnabled = findSendButton({ requireEnabled: true }) !== null;
  const lastAssistant = document.querySelectorAll('[data-message-author-role="assistant"]');

  return {
    url,
    busy: stopControlVisible || busyText,
    stopControlVisible,
    sendControlPresent: sendPresent,
    sendControlVisible: sendEnabled,
    composerReady: Boolean(composer && !composer.disabled && composer.getAttribute("aria-disabled") !== "true"),
    composerEmpty: Boolean(composer) && value.length === 0,
    composerText: value,
    assistantText: lastAssistant.length ? lastAssistant[lastAssistant.length - 1].innerText : "",
  };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === "APOLLO_SNAPSHOT") {
    respond(snapshot());
    return;
  }
  if (message?.type !== "APOLLO_SUBMIT") return;

  const before = snapshot();
  if (message.targetUrl !== location.href || before.busy !== false ||
      !before.composerReady || !before.composerEmpty || !before.sendControlPresent) {
    respond({ clicked: false, reason: "preflight-guard-failed" });
    return;
  }

  const composer = composerElement();
  if (!composer || typeof message.prompt !== "string" || !message.prompt.trim()) {
    respond({ clicked: false, reason: "missing-controls-or-prompt" });
    return;
  }

  if (composer.tagName === "TEXTAREA") {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) {
      respond({ clicked: false, reason: "textarea-setter-unavailable" });
      return;
    }
    setter.call(composer, message.prompt);
  } else {
    composer.focus();
    composer.textContent = message.prompt;
  }
  composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: message.prompt }));
  composer.dispatchEvent(new Event("change", { bubbles: true }));

  const after = snapshot();
  const sendButton = findSendButton({ requireEnabled: true });
  if (after.url !== message.targetUrl || after.busy !== false || !after.composerReady ||
      after.composerText !== message.prompt || !sendButton) {
    respond({ clicked: false, reason: "post-fill-guard-failed" });
    return;
  }

  sendButton.click();
  respond({ clicked: true, note: "Click issued; delivery is not independently confirmed" });
});
