/**
 * Sign-in gate and splash for Apollo apps. The ecosystem is visible but inert
 * behind a small centred card until the browser session is confirmed. The same
 * markup and CSS can be reused as the loading splash for other Apollo apps.
 *
 * Modes (set on #auth-view via data-mode):
 *   checking - reading the SPMT donor cookie / Apollo session, card pulses
 *   signin   - card shows the SPMT token and Apollo login forms
 *   working  - signed in, refreshing; forms hidden
 */
export const SPLASH_GATE_CSS = `
main.auth-view{position:fixed;inset:0;z-index:500;display:block;min-height:100vh;max-width:none;margin:0;padding:0;overflow:hidden;background:#050815;grid-template-columns:none}
main.auth-view[hidden]{display:none}
.auth-backdrop{position:absolute;inset:0;overflow:hidden;padding:110px 28px 40px;filter:blur(5px) saturate(.85);opacity:.5;pointer-events:none;user-select:none}
.auth-backdrop .auth-intro{max-width:1000px;margin:0 auto;pointer-events:none}
.auth-scrim{position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,#05081552 0,#050815d9 62%,#050815f2 100%)}
.gate-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(370px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;display:grid;gap:12px;padding:22px 22px 20px;border:1px solid #ffffff1f;border-radius:18px;background:linear-gradient(145deg,#0a0b12f8,#05060bf8);box-shadow:0 24px 70px #000c;color:#eef5ff}
.gate-logo{justify-self:center;width:58px;height:auto;margin:0 0 2px}
.gate-card .spmt-auth-status{margin:0;text-align:center;font-size:13px;line-height:1.45;color:#c9d4ea}
.gate-card .spmt-auth-status[data-kind="error"]{color:#ffb4c2}
.gate-card .spmt-auth-status[data-kind="ready"]{color:#bff7d9}
.gate-card .spmt-auth-status[hidden]{display:none}
main.auth-view[data-mode="checking"] .gate-logo{animation:gate-pulse 1.3s ease-in-out infinite}
main.auth-view[data-mode="checking"] .gate-forms,main.auth-view[data-mode="working"] .gate-forms{display:none}
@keyframes gate-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.93)}}
.gate-tabs{display:flex;gap:6px;padding:4px;border:1px solid #ffffff17;border-radius:12px;background:#ffffff08}
.gate-tabs button{flex:1;appearance:none;border:0;border-radius:9px;background:transparent;color:#aab6cf;padding:9px 8px;font:inherit;font-size:13px;font-weight:750;cursor:pointer}
.gate-tabs button[aria-selected="true"]{background:#fbbf2422;color:#fde68a;box-shadow:inset 0 0 0 1px #fbbf2466}
.gate-forms{display:grid;gap:10px}
.gate-forms form{display:grid;gap:9px}
.gate-forms form[hidden]{display:none}
.gate-forms label{display:grid;gap:6px;color:#b9c7e2;font-size:12px;font-weight:700}
.gate-forms input,.gate-forms textarea{width:100%;padding:10px 11px;border:1px solid #ffffff20;border-radius:10px;background:#030409;color:#fff;font:inherit;font-size:13px;outline:none}
.gate-forms textarea{font-family:"SFMono-Regular",Consolas,monospace;font-size:11px;resize:vertical;min-height:110px}
.gate-forms input:focus,.gate-forms textarea:focus{border-color:#fbbf24;box-shadow:0 0 0 3px #fbbf2422}
.gate-forms .spmt-auth-help{margin:0;font-size:11px;line-height:1.45;color:#8e9bb8}
.gate-forms button[type="submit"]{appearance:none;border:0;border-radius:11px;padding:11px;font:inherit;font-weight:800;color:#1b1005;background:linear-gradient(135deg,#fbbf24,#f97316);cursor:pointer}
.gate-forms button[type="submit"]:disabled{opacity:.6;cursor:progress}
@media(max-width:560px){.gate-card{padding:18px 16px}.auth-backdrop{padding-top:70px}}
`;
