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

test("normalizes a valid non-default wall-clock time and timezone", () => {
  const schedule = normalizeSchedule({ type:"weekly", weekdays:[1], time:"17:45", timeZone:"America/Los_Angeles" });
  assert.equal(schedule.time, "17:45");
  assert.equal(schedule.timeZone, "America/Los_Angeles");
});
test("falls back only for malformed wall-clock time", () => {
  const schedule = normalizeSchedule({ type:"weekly", weekdays:[1], time:"25:99" });
  assert.equal(schedule.time, "09:00");
});

test("one-time datetime-local input is interpreted in its configured timezone", () => {
  const schedule = normalizeSchedule({ type:"once", runAt:"2026-03-08T02:30", timeZone:"America/Chicago" }, Date.UTC(2026,2,7,12));
  assert.equal(new Date(schedule.runAt).toISOString(), "2026-03-08T08:00:00.000Z");
  assert.equal(schedule.timeZone, "America/Chicago");
  assert.match(scheduleLabel(schedule), /America\/Chicago/);
});
test("one-time ISO timestamps with offsets remain absolute instants", () => {
  const schedule = normalizeSchedule({ type:"once", runAt:"2026-03-08T02:30:00-06:00", timeZone:"America/Chicago" }, Date.UTC(2026,2,7,12));
  assert.equal(new Date(schedule.runAt).toISOString(), "2026-03-08T08:30:00.000Z");
});
test("one-time schedules reject invalid calendar dates", () => {
  assert.throws(() => normalizeSchedule({ type:"once", runAt:"2026-02-30T09:00", timeZone:"America/Chicago" }, Date.UTC(2026,1,1)), /date is invalid/);
});

test("one-time local wall-clock schedules reject out-of-range hours, minutes and seconds", () => {
  const invalid = ["2026-03-08T24:00", "2026-03-08T09:60", "2026-03-08T09:30:60"];
  for (const runAt of invalid) {
    assert.throws(() => normalizeSchedule({ type:"once", runAt, timeZone:"America/Chicago" }, Date.UTC(2026,2,7,12)), /time is invalid/);
  }
});
test("one-time offset timestamps reject invalid dates and timezone offsets", () => {
  const invalid = ["2026-02-30T09:30:00-06:00", "2026-03-08T09:30:00+99:00"];
  for (const runAt of invalid) {
    assert.throws(() => normalizeSchedule({ type:"once", runAt, timeZone:"America/Chicago" }, Date.UTC(2026,2,7,12)));
  }
});
