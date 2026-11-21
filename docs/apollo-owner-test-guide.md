# ApolloStation Owner Test Guide

A tired-proof test sequence for the owner. Run one section at a time, record the result, and do not jump ahead when a prerequisite is broken.

## How to use this guide
- Start at **Test 0**. Only continue when its stop condition is clear.
- Test one thing at a time. Capture a screenshot or copy the exact error when something fails.
- **Pass** means the expected result actually appeared in the app—not that a workflow was green.
- **Blocked** means the test cannot be reached because an earlier dependency is broken. Do not mark it failed.
- If you're tired, stop at the current test and leave the next test name in the notes. Don't try to remember the next question.

For every test, record: **Pass / Fail / Blocked**, what you expected, what actually happened, and a screenshot/error if useful.

---

## Test 0 — Is Apollo reachable?
**Ask:** “Can I open Apollo and see the app without an error or blank page?”

- [ ] Load the Apollo URL.
- [ ] Refresh once.
- [ ] Navigate to another page, then return.
- [ ] Confirm the main navigation is present and usable.

**Pass:** Apollo loads consistently and navigation works.  
**If blocked:** Stop. Record the URL, page, and error. Don't test features behind the broken page.

## Test 1 — Owner access and sign-out
**Ask:** “Am I recognized as the owner, and can I sign out and get back in?”

- [ ] Confirm owner session/access.
- [ ] Locate sign-out from the UI.
- [ ] Sign out.
- [ ] Sign in again using the intended recovery/login path.
- [ ] Confirm the session returns to Apollo—not an unrelated overlay or broken page.

**Pass:** Access and sign-out/sign-in are clear and repeatable.  
**Do not** test another person's account or multi-user privacy yet.

## Test 2 — Overlay Bay and Personal Bulletin
**Ask:** “Can I create, save, and reopen my Personal Bulletin overlay?”

- [ ] Open Overlay Bay.
- [ ] Select Personal output.
- [ ] Create/select Personal Bulletin.
- [ ] Confirm Task Queue is present.
- [ ] Add/remove or reposition a component.
- [ ] Save.
- [ ] Navigate away and reopen; confirm saved layout is still there.

**Pass:** The scene and layout persist after leaving/reopening.  
**Blocked:** Save/reopen fails or components are missing.

## Test 3 — Task Queue (manual task)
**Ask:** “Can Apollo store a task and show me its state?”

Use a harmless prompt such as: “This is a test. Return a short receipt with the word APOLLO.”

- [ ] Create a task with a name and prompt.
- [ ] Leave schedule as Manual.
- [ ] Confirm the task appears in the list.
- [ ] Inspect status and task details.
- [ ] Run once only if the selected destination is explicitly the test simulator.

**Pass:** Task creation and task visibility work.  
**Important:** A stored task is not proof it was delivered to an AI.

## Test 4 — Scheduler: short interval proof
**Ask:** “Does the scheduled task wake up, deliver to the simulator, record a receipt, and schedule the next run?”

Use the test simulator destination only. Set a short interval (e.g. 5 seconds, if the UI permits).

- [ ] Create a test task with a clear prompt.
- [ ] Select the simulator/test destination.
- [ ] Set a short interval.
- [ ] Confirm the next run time is visible.
- [ ] Wait for the first run.
- [ ] Confirm a simulated receipt is recorded in activity/task details.
- [ ] Confirm the next run is scheduled.
- [ ] Wait for a second run and confirm the receipt/run count advances.

**Pass:** At least two distinct runs/receipts are recorded and the next run is scheduled.  
**Not proven by this test:** ChatGPT login, real browser dispatch, AI response monitoring, response parsing, or automatic follow-up. Those are not connected yet.

## Test 5 — Pause, resume, and stop safety
**Ask:** “Can I stop a scheduled task and trust that it stays stopped?”

- [ ] Pause the interval task.
- [ ] Confirm it shows paused.
- [ ] Wait past one expected interval.
- [ ] Confirm no new simulator receipt was recorded.
- [ ] Resume it.
- [ ] Confirm the schedule returns.
- [ ] Complete it and confirm it no longer schedules future runs.

**Pass:** Pause prevents delivery, resume restarts scheduling, and completed tasks stop.

## Test 6 — Scheduler types and date boundaries
Only do this after Test 4 passes.

- [ ] Manual: no next run until Run once.
- [ ] Once: future date/time accepted; past date/time rejected.
- [ ] Interval: seconds/minutes/hours/days accepted as intended.
- [ ] Weekly: selected weekdays and time; no unselected day run.
- [ ] Monthly: selected day and time; invalid day rejected.
- [ ] Readable labels and next-run timestamps match the settings.

**Pass:** Displayed schedule matches what the task will do. If timezone is unclear, stop and record it before trusting calendar schedules.

## Test 7 — Activity and history
**Ask:** “Can I see what happened without guessing?”

- [ ] Activity shows create/run/pause/resume/completion events.
- [ ] History shows completed, failed, or uncertain dispatches appropriately.
- [ ] Task status and last event agree.
- [ ] Reload does not erase persisted task state.

**Pass:** The same task state can be understood from its activity/history views.

## Test 8 — Browser separation (Lounge protection)
This test is not part of the simulator proof. Do not authorize real ChatGPT dispatch yet.

**Ask:** “Does a scheduled browser task use its own browser/profile, without taking over Lounge?”

Before any live browser connection is considered:
- [ ] Identify the browser/session used by Lounge.
- [ ] Confirm scheduler browser launches separately with a separate profile/session.
- [ ] Confirm scheduler can display its login page for owner sign-in.
- [ ] Confirm login persistence is scoped to scheduler and does not alter Lounge.
- [ ] Confirm scheduler can be stopped without stopping Lounge.

**Pass:** Isolation is demonstrated. If both features share or hijack the same session, stop.

## Test 9 — Workflow proof (later)
Use a harmless test workflow first.

- [ ] Apollo triggers only the selected workflow.
- [ ] It stores the workflow/run ID and direct run link.
- [ ] Status changes are reflected (queued → in progress → completed/failed).
- [ ] Logs/output can be retrieved.
- [ ] Apollo summarizes output without exposing secrets.

**Pass:** Run link, status, and sanitized logs are visible in Apollo. Do not send tokens, secret values, cookies, or credential files to prompts.

## Test 10 — App smoke tests (one app at a time)
Do not try all apps in one session. Start with owner-only access and a low-risk action.

### SpaceMountain / Overlay Bay
- [ ] Open the app from Apollo navigation.
- [ ] Confirm top-level navigation/home link remains available.
- [ ] Open an overlay, save a small change, reload, and verify it persists.

### Nebula / Chat Tag
- [ ] Open the game hub.
- [ ] Confirm game page loads.
- [ ] Check player/game data displays.
- [ ] Test one harmless game action and verify the expected points/state change.
- [ ] Check one owner/admin control only if clearly labeled.

### StreamWeaver
- [ ] Open StreamWeaver.
- [ ] Confirm player/control page loads.
- [ ] Test a non-live, harmless control.
- [ ] Verify status reflects the action.
- - [ ] Do not start a public live broadcast as a smoke test.

### Discord Stream Hub
- [ ] Open hub and confirm UI loads.
- [ ] Verify configured server/channel status is shown.
- [ ] Test a safe preview or non-public action.
- [ ] Don't assume bot is online just because UI loads.

### Lounge
- [ ] Open Lounge and confirm it loads.
- [ ] Verify its existing browser/session is unchanged.
- [ ] Test only a harmless page/control.
- [ ] Do not use scheduler tests to sign out, overwrite, or reuse Lounge session.

### HearMeOut (lower priority)
- [ ] Open app.
- [ ] Confirm media list/catalog UI.
- [ ] Test playback only with a permitted sample.
- [ ] Verify audio in both directions only when testing voice bridge; record which side cannot hear.

---

## Test report template

**Test:**  
**Date/time:**  
**Status:** Pass / Fail / Blocked  
**Expected:**  
**Actual:**  
**Screenshot/error:**  
**Next test:**  

## When to stop
Stop the session if:
- a page is blank or access unexpectedly changes;
- a task fires more than once unexpectedly;
- a live/public action begins unexpectedly;
- browser sessions appear shared with Lounge;
- you cannot tell whether a task is paused or active;
- a test requires a credential, token, or secret to be pasted into a prompt.

The goal is steady, verifiable progress—not a marathon. Resume at the next unchecked test.
