import assert from "node:assert/strict";
import test from "node:test";
import { STREAMWEAVER_DONOR_COMMANDS, STREAMWEAVER_DONOR_DEFINITION_COUNT, canonicalDonorCommandTrigger } from "../apps/streamweaver/dist/index.js";

const REQUIRED = [
  "!accept","!addpoints","!addtoall","!bic","!bitsleader","!bleader","!boop","!brb","!cleader","!clip","!coinflip","!commands","!cuddle","!dance","!discord","!fistbump","!followage","!followed","!followers","!gamble","!givepoints","!headpat","!highfive","!hover","!hug","!hydrate","!instagram","!leader","!love","!lurk","!merch","!no","!pleader","!points","!raidmessage","!resetallpoints","!roll","!setgame","!setpoints","!settitle","!settoall","!show","!so","!sr","!stats","!stealpoints","!stretch","!t","!tickle","!tiktok","!time","!twitter","!unlurk","!uptime","!watchtime","!webpage","!welcomemode","!wleader","!yes","!youtube","!yup","(?i).*@?bird.*","(?i).*@?stickers.*","(?i).*@?uuddlrlrab.*","(?i).*@?{{bot_name}}.*","pack",
];

test("all 70 frozen StreamWeaver donor command definitions are represented", () => {
  assert.equal(STREAMWEAVER_DONOR_COMMANDS.length, STREAMWEAVER_DONOR_DEFINITION_COUNT);
  assert.equal(STREAMWEAVER_DONOR_DEFINITION_COUNT, 70);
  const triggers = STREAMWEAVER_DONOR_COMMANDS.map((entry) => entry.trigger.toLowerCase());
  for (const trigger of REQUIRED) assert.ok(triggers.includes(trigger), `missing donor trigger ${trigger}`);
  assert.equal(triggers.filter((trigger) => trigger === "!commands").length, 2);
  assert.equal(triggers.filter((trigger) => trigger === "!lurk").length, 2);
  assert.equal(triggers.filter((trigger) => trigger === "(?i).*@?{{bot_name}}.*").length, 3);
});

test("the donor typo alias !gambel resolves to !gamble without becoming a fake extra definition", () => {
  assert.equal(canonicalDonorCommandTrigger("!gambel"), "!gamble");
  assert.equal(STREAMWEAVER_DONOR_COMMANDS.some((entry) => entry.trigger === "!gambel"), false);
});
