# Compose Email — recipient auto-collapse + Schedule fix

## Problems observed

1. **Recipient list auto-collapses on every click.** In `EmailComposeModal.tsx` (lines 975–986), an effect runs on every change to `selectedContactIds` and collapses the list after 350 ms whenever there is no search text. So as soon as a user checks one box, the list snaps shut and they have to click "Edit" again to check the next person.
2. **Schedule silently does nothing for bulk batches under the enqueue threshold.** The compose footer always shows the Schedule input for bulk (line 1490). But the send handler only routes through `enqueue-campaign-send` (which honours `scheduled_at` via the DB `claim_send_job_items` RPC) when `sendable.length >= campaignSettings.enqueueThreshold` (default **25**, line 648–650). For 1–24 recipients the code falls through to the per-recipient `send-campaign-email` loop (line 774+), which never reads `scheduledAt`. Result: the user picks a future time, clicks Send, and emails go out immediately.
3. Minor: the auto-collapse also fights the user when they're actively typing in the search box (the effect's `if (!recipientSearch)` short-circuit means the moment they clear the search it collapses again).

## Changes (frontend only — `src/components/campaigns/EmailComposeModal.tsx`)

### A. Recipient auto-collapse → 10 s idle debounce

- Replace the existing effect (lines 975–986) with an **activity-based debounce**:
  - Track the last interaction timestamp via a ref, updated whenever the user toggles a checkbox, types in the search field, clicks "All/Clear", or scrolls the recipient list.
  - When the list is expanded and at least one recipient is selected, start a **10-second** timer that collapses the list. Any new interaction resets the timer.
  - Never collapse while the search input has focus or contains text.
  - Never collapse while the recipient list is being hovered (mouse over the scroll area).
  - Keep the existing "expand again when selection drops to 0" behaviour.
- Remove the immediate 350 ms collapse-on-pick — that's the root cause of the snap-shut feeling.
- Manual "Collapse" / "Edit" toggle button keeps working unchanged.

### B. Subtle UX polish around the recipient header

- Show a tiny muted hint "Auto-collapses after 10s of inactivity" next to the Collapse button only when the timer is armed (selection > 0, expanded, no active search/hover). Keeps the new behaviour discoverable without being noisy.
- Cancel the timer when the modal closes or `mode` switches away from `bulk`.

### C. Schedule actually schedules (small batches too)

- In the send handler (around line 648), change the routing rule:
  - **If `scheduledAt` is set AND `mode === "bulk"` AND not in reply mode → always go through `enqueue-campaign-send`,** regardless of `sendable.length` vs `ENQUEUE_THRESHOLD`. The cron runner + `claim_send_job_items` already honour `j.scheduled_at`, so a single queued job at any size is enough.
  - Otherwise keep the current threshold-based routing.
- Add a guard: if `scheduledAt` is in the past (clock drift after the modal was open a while), block Send and toast "Scheduled time is in the past — pick a future time or clear the schedule."
- Update the existing post-enqueue toast wording so the scheduled case reads "Scheduled N email(s) for <local time>. They'll be sent automatically." (already mostly there at line 741 — just confirm the text and keep the modal closeable).
- Disable the Send button's label swap so it reads **"Schedule Send"** when `scheduledAt` is set, **"Send Email(s)"** otherwise. Visual cue that the click won't fire emails right now.
- Recompute `scheduleMin` lazily on each render (or via a 30 s interval) so a modal left open for several minutes can't accept a "now-ish" value that's already in the past by the time Send is clicked. Currently `scheduleMin` is memoised on `[open]` only.

### D. Out of scope

- No changes to edge functions, DB functions, or `useCampaignSettings`. Schedule honouring is already correct on the backend; the bug is purely the frontend bypassing the queue for small batches.
- No changes to single-mode or reply-mode (schedule input isn't shown there).

## Files touched

- `src/components/campaigns/EmailComposeModal.tsx` (only)

## Verification

- Bulk compose, pick 2 recipients → list stays open; wait ~10 s without interaction → collapses. Click "Edit", check more → timer resets.
- Type in search → no collapse; clear search → 10 s timer starts.
- Bulk compose, pick 3 recipients, set Schedule to +10 min, click "Schedule Send" → toast confirms scheduled time; check `campaign_send_jobs` row has `scheduled_at` set and `status='queued'`; runner picks it up only after that time.
- Same flow with 30 recipients (above threshold) → unchanged behaviour, still queued and scheduled.
- Set Schedule to a past time (e.g., open modal, wait, then click Send) → blocked with clear toast.
