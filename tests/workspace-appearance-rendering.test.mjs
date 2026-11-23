import assert from "node:assert/strict";
import test from "node:test";
import { applyWorkspaceAppearance, PRODUCT_UI_CSS, relayWorkspaceAppearance } from "../packages/ui/dist/index.js";
import { AuthorityService, MemoryAuthorityStore } from "../packages/authority-core/dist/index.js";

function rootStub() {
  const values = new Map();
  return {
    style: { setProperty: (key, value) => values.set(key, String(value)), values, colorScheme: "" },
    dataset: {},
  };
}

test("legacy WorkspaceAppearance fields drive shared live surface tokens and accessibility state", () => {
  const root = rootStub();
  const theme = applyWorkspaceAppearance(root, {
    themeId: "oceanic-blue", accentColor: "#123456", accentSaturation: 82,
    glowIntensity: 64, starDensity: 35, glassOpacity: 48, blurStrength: 12,
    nebulaIntensity: 72, parallaxDepth: 20, borderStrength: 60, borderGlow: false,
    hoverGlow: true, chatTransparency: 25, cornerRadius: "sm", density: "compact",
    sidebarCollapsed: true, sidebarStyle: "floating", sidebarPosition: "right",
    topbarStyle: "transparent", tabStyle: "underline", tabPosition: "bottom",
    showAvatars: false, smoothTransitions: false, pushToTalk: true,
    micButtonStyle: "minimal", voiceWaveStyle: "pulse",
    highContrast: true, colorVisionMode: "deuteranopia", textScale: "lg",
    reduceMotion: true, focusHighlight: false,
    animation: { enabled: true, speed: 125, particles: false, shootingStars: false },
  });
  assert.equal(theme.id, "oceanic-blue");
  assert.equal(root.style.values.get("--spmt-accent"), "#123456");
  assert.equal(root.style.values.get("--spmt-glass-opacity"), "0.48");
  assert.equal(root.style.values.get("--spmt-blur"), "12px");
  assert.equal(root.style.values.get("--spmt-stars"), "0.35");
  assert.equal(root.style.values.get("--spmt-radius"), "0.5rem");
  assert.equal(root.style.values.get("--spmt-motion-scale"), "0");
  assert.equal(root.dataset.spmtSidebarCollapsed, "true");
  assert.equal(root.dataset.spmtColorVision, "deuteranopia");
  assert.equal(root.dataset.spmtVoiceWave, "pulse");
  assert.equal(root.dataset.spmtHighContrast, "true");
  assert.equal(root.dataset.spmtParticles, "false");
});

test("appearance values are bounded and unknown presets safely fall back", () => {
  const root = rootStub();
  const theme = applyWorkspaceAppearance(root, {
    theme: "not-a-theme", glassOpacity: 500, blurStrength: -10, starDensity: "NaN",
    sidebarStyle: "inject-css", colorVisionMode: "unknown",
  });
  assert.equal(theme.id, "solar-flare");
  assert.equal(root.style.values.get("--spmt-glass-opacity"), "1");
  assert.equal(root.style.values.get("--spmt-blur"), "0px");
  assert.equal(root.style.values.get("--spmt-stars"), "0.7");
  assert.equal(root.dataset.spmtSidebar, "docked");
  assert.equal(root.dataset.spmtColorVision, "default");
});

test("shared CSS consumes appearance variables and accessibility flags", () => {
  assert.match(PRODUCT_UI_CSS, /blur\(var\(--spmt-blur/);
  assert.match(PRODUCT_UI_CSS, /data-spmt-reduce-motion/);
  assert.match(PRODUCT_UI_CSS, /data-spmt-high-contrast/);
  assert.match(PRODUCT_UI_CSS, /data-spmt-text-scale/);
  assert.match(PRODUCT_UI_CSS, /data-spmt-sidebar-collapsed/);
});

test("appearance relay requires a concrete origin and emits the versioned compatibility envelope", () => {
  let message;
  let origin;
  const target = { postMessage: (value, targetOrigin) => { message = value; origin = targetOrigin; } };
  relayWorkspaceAppearance(target, "https://app.example", { themeId: "aurora-green" }, 17);
  assert.equal(origin, "https://app.example");
  assert.equal(message.type, "SPACEMOUNTAIN_THEME");
  assert.equal(message.version, 2);
  assert.equal(message.revision, 17);
  assert.equal(message.appearance.themeId, "aurora-green");
  assert.throws(() => relayWorkspaceAppearance(target, "*", {}), /concrete target origin/);
});


test("canonical workspace authority accepts and validates the complete appearance control model", () => {
  const authority = new AuthorityService({ store: new MemoryAuthorityStore() });
  authority.getOrCreateWorkspace("appearance-tenant");
  const appearance = {
    theme: "aurora-green", accent: "#10b981", accentSecondary: "#a3e635",
    accentSaturation: 145, glowIntensity: 70, starDensity: 80, glassOpacity: 65,
    blurStrength: 24, nebulaIntensity: 50, parallaxDepth: 30, borderStrength: 45,
    borderGlow: true, hoverGlow: false, cornerRadius: "md", density: "spacious",
    sidebarCollapsed: false, sidebarStyle: "glass", sidebarPosition: "right",
    topbarStyle: "minimal", tabStyle: "cards", tabPosition: "bottom",
    chatTransparency: 30, showAvatars: true, smoothTransitions: true, pushToTalk: true,
    pushToTalkKey: "V", micButtonStyle: "outline", voiceWaveStyle: "wave",
    accessibility: { highContrast: true, colorVisionMode: "protanopia", textScale: "lg", reduceMotion: false, focusHighlight: true },
    animation: { enabled: true, speed: 85, particles: true, shootingStars: false },
  };
  const saved = authority.updateWorkspace("appearance-tenant", 1, { appearance });
  assert.equal(saved.appearance.accentSaturation, 145);
  assert.equal(saved.appearance.accessibility.colorVisionMode, "protanopia");
  assert.equal(saved.appearance.animation.enabled, true);
  assert.throws(() => authority.updateWorkspace("appearance-tenant", 2, { appearance: { ...appearance, accentSaturation: 151 } }), /accentSaturation/);
  assert.throws(() => authority.updateWorkspace("appearance-tenant", 2, { appearance: { ...appearance, voiceWaveStyle: "invalid" } }), /voice wave style/);
});
