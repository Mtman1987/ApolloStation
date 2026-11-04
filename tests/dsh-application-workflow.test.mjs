import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { SqliteDshApplicationStore } from "../apps/discord-stream-hub/dist/applications.js";
import { DSH_ACCEPTANCE_SCHEDULE, DSH_APPLICATION_DEFINITIONS, buildDshApplicationDecisionMessage } from "../apps/discord-stream-hub/dist/application-flow.js";

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "dsh-app-flow-"));
  const store = new SqliteDshApplicationStore(path.join(dir, "dsh.sqlite"));
  const application = store.submit({
    tenantId: "tenant-one",
    guildId: "123456789012345678",
    interactionId: "223456789012345678",
    type: "mod",
    applicantDiscordId: "323456789012345678",
    applicantUsername: "Candidate",
    answers: { experience: "Experienced community moderator", availability: "Central evenings and weekends", judgment: "Gather evidence and de-escalate carefully", safety: "Use least privilege and protect private data", motivation: "Help the SPMT community grow safely" },
  }, "2026-09-06T09:00:00.000Z").application;
  return { dir, store, application, close() { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("DSH stores blind advisory votes and same-vote toggles off", () => {
  const f = fixture();
  try {
    let result = f.store.vote("tenant-one", f.application.id, { userId: "crew-user", username: "Crew One" }, "approve", "2026-09-06T09:01:00.000Z");
    assert.equal(result.action, "voted");
    assert.equal(result.application.votes.length, 1);
    assert.equal(result.application.votes[0].vote, "approve");
    result = f.store.vote("tenant-one", f.application.id, { userId: "crew-user", username: "Crew One" }, "approve", "2026-09-06T09:02:00.000Z");
    assert.equal(result.action, "removed");
    assert.equal(result.application.votes.length, 0);
    result = f.store.vote("tenant-one", f.application.id, { userId: "crew-user", username: "Crew One" }, "reject", "2026-09-06T09:03:00.000Z");
    assert.equal(result.application.votes[0].vote, "reject");
  } finally { f.close(); }
});

test("approved DSH applications require exact applicant identity and explicit electronic acceptance", () => {
  const f = fixture();
  try {
    const decided = f.store.decide("tenant-one", f.application.id, "approved", "owner-user", "Welcome aboard", "2026-09-06T09:10:00.000Z");
    assert.equal(decided.status, "approved");
    const offer = f.store.createAgreementOffer("tenant-one", f.application.id, "owner-user", "2026-09-06T09:11:00.000Z");
    assert.ok(offer.rawToken);
    assert.equal(offer.application.agreementOffer.document.hash, DSH_APPLICATION_DEFINITIONS.mod.termsHash);
    assert.equal(offer.application.agreementOffer.acceptanceSchedule.hash, DSH_ACCEPTANCE_SCHEDULE.hash);
    assert.throws(() => f.store.acceptAgreement({ tenantId: "tenant-one", applicationId: f.application.id, token: offer.rawToken, spmtUserId: "candidate-user", discordUserId: "999999999999999999", username: "Candidate", reviewedTerms: true, electronicConsent: true }, "2026-09-06T09:12:00.000Z"), /does not match/i);
    assert.throws(() => f.store.acceptAgreement({ tenantId: "tenant-one", applicationId: f.application.id, token: offer.rawToken, spmtUserId: "candidate-user", discordUserId: "323456789012345678", username: "Candidate", reviewedTerms: false, electronicConsent: true }, "2026-09-06T09:12:00.000Z"), /confirmations/i);
    const accepted = f.store.acceptAgreement({ tenantId: "tenant-one", applicationId: f.application.id, token: offer.rawToken, spmtUserId: "candidate-user", discordUserId: "323456789012345678", username: "Candidate", reviewedTerms: true, electronicConsent: true }, "2026-09-06T09:13:00.000Z");
    assert.equal(accepted.alreadyAccepted, false);
    assert.equal(accepted.acceptance.authenticatedBy, "SPMT session + linked Discord provider");
    assert.equal(accepted.acceptance.document.hash, DSH_APPLICATION_DEFINITIONS.mod.termsHash);
    assert.equal(accepted.acceptance.acceptanceSchedule.hash, DSH_ACCEPTANCE_SCHEDULE.hash);
    assert.deepEqual(accepted.acceptance.confirmations, { reviewedTerms: true, electronicConsent: true });
    const replay = f.store.acceptAgreement({ tenantId: "tenant-one", applicationId: f.application.id, token: offer.rawToken, spmtUserId: "candidate-user", discordUserId: "323456789012345678", username: "Candidate", reviewedTerms: true, electronicConsent: true }, "2026-09-06T09:14:00.000Z");
    assert.equal(replay.alreadyAccepted, true);
    assert.equal(replay.acceptance.acceptanceId, accepted.acceptance.acceptanceId);
  } finally { f.close(); }
});

test("DSH decision templates persist and approved notification points at the acceptance flow", () => {
  const f = fixture();
  try {
    f.store.saveTemplate("tenant-one", "modApproved", "Custom welcome for the new moderator", "2026-09-06T09:20:00.000Z");
    const reopened = f.store.templates("tenant-one");
    assert.equal(reopened.modApproved, "Custom welcome for the new moderator");
    const message = buildDshApplicationDecisionMessage({ type: "mod", decision: "approved", customMessage: reopened.modApproved, agreementUrl: "https://spmt.example/apps/discord-stream-hub/?agreement=abc&token=secret", now: "2026-09-06T09:21:00.000Z" });
    assert.equal(message.embeds[0].description, reopened.modApproved);
    assert.equal(message.components[0].components[0].url, "https://spmt.example/apps/discord-stream-hub/?agreement=abc&token=secret");
    assert.match(message.embeds[0].fields.find(field => field.name === "Final step").value, /Signing in by itself is not acceptance/);
  } finally { f.close(); }
});
