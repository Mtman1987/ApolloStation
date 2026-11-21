import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSchedule, nextScheduledAt, scheduleLabel } from "./schedule.mjs";

test("weekly schedule uses the configured timezone, not the host timezone", () => {
  const schedule = normalizeSchedule({ type:"weekly", weekdays:[1], time:"09:00", timeZone:"America/Chicago" });
  const next = nextScheduledAt(schedule, Date.UTC(2026,2,1,12,0));
  assert.equal(new Date(next).toISOString(), "2026-03-02T15:00:00.000Z");
  assert.match(scheduleLabel(schedule), /America\/Chicago/);
});
test("weekly schedule applies daylight-saving offset after the spring transition", () => {
  const schedule = normalizeSchedule({ type:"weekly", weekdays:[0], time:"09:00", timeZone:"America/Chicago" });
  const next = nextScheduledAt(schedule, Date.UTC(2026,2,7,12,0));
  assert.equal(new Date(next).toISOString(), "2026-03-08T14:00:00.000Z");
});
test("monthly day 31 skips months without that day", () => {
  const schedule = normalizeSchedule({ type:"monthly", day:31, time:"09:00", timeZone:"America/Chicago" });
  const next = nextScheduledAt(schedule, Date.UTC(2026,1,1,12,0));
  assert.equal(new Date(next).toISOString(), "2026-03-31T14:00:00.000Z");
});
test("rejects invalid IANA timezone", () => {
  assert.throws(() => normalizeSchedule({ type:"weekly", weekdays:[1], time:"09:00", timeZone:"Mars/Olympus" }), /valid IANA timezone/);
});
