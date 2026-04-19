

## Campaign Status Lifecycle — Audit & Fixes

### Current behavior (what the button does)

The status button is a dropdown that switches the campaign between 4 states stored in `campaigns.status`. Logic lives in `CampaignDetail.tsx` (`handleStatusChange` + `getAvailableStatuses`).

Today: **Draft → (Active if all 4 strategy sections done) → Paused → Completed**, and an auto-complete effect flips Active→Completed when end date passes.

### Bugs & gaps found

1. **No confirmation before Completed** — one-click irreversible. Memory says "completed cannot be reactivated" but UX gives no warning.
2. **No confirmation when Activating** — going live should be deliberate (sends emails, starts monitoring).
3. **Pause → Resume is broken UX**: from Paused the only forward option shown is "Active" (good) but there's no visual hint it means "Resume". Also no Draft fallback shown if strategy regressed.
4. **Start-date not enforced** — user can Activate before `start_date`. Should warn or block.
5. **End-date past + status still Draft** — auto-complete only fires for Active, so a Draft past its end date sits forever. Should prompt user.
6. **Strategy gate silently hides "Active"** in dropdown but the toast on click never fires (because option isn't shown). User has no idea why Active is missing — needs a disabled item with tooltip "Complete Strategy first".
7. **Edit modal can change status** bypassing all rules → status transitions should only flow through `handleStatusChange`.
8. **No status history / audit** — can't see when it went Active or who paused it.
9. **Archive while Active** is silently allowed — should warn (active campaign will stop running).
10. **Auto-complete toast shows raw ISO date** instead of formatted dd-MM-yy (memory rule).
11. **Button label ambiguity** — current shows just "Draft ▾". Should read like an action: "Status: Draft" or include a dot indicator. Screenshot shows menu listing only Paused/Completed when in Draft → "Active" hidden because strategy incomplete (confusing).

### Proposed lifecycle

```text
        ┌─────────┐  activate (strategy=100%, confirm)   ┌────────┐
        │  Draft  │ ───────────────────────────────────► │ Active │
        └─────────┘                                      └────┬───┘
             ▲                                          pause │ ▲ resume
             │ revert (only if never activated)               ▼ │
             │                                          ┌────────┐
             │                                          │ Paused │
             │                                          └────┬───┘
             │                                  complete │   │ complete
             ▼                                           ▼   ▼
                                                     ┌───────────┐
                                                     │ Completed │ (locked)
                                                     └───────────┘
```

Rules:
- **Draft → Active**: requires strategy 100% AND confirm dialog ("Activating will start outreach…"). Warn if today < start_date.
- **Active ↔ Paused**: free toggle, no confirm. Label says "Resume" not "Active" when coming from Paused.
- **Active/Paused → Completed**: confirm dialog ("This is permanent. Cannot be reactivated.")
- **Draft → Completed**: blocked (must activate first, otherwise just delete/archive).
- **Auto-complete**: fires for Active OR Paused when end_date passes. For Draft past end_date, show a banner prompting user.
- **Completed**: dropdown becomes a static badge (no chevron, no menu).

### Changes

**File: `src/pages/CampaignDetail.tsx`**

1. Add confirmation `AlertDialog` for Activate and Complete with appropriate copy.
2. Rewrite `getAvailableStatuses` + render: always show full menu, but mark unreachable items as **disabled** with reason tooltip (e.g. "Complete all 4 Strategy sections" for Active when strategy<100%).
3. Rename "Active" → "Resume" in the menu when current status is Paused.
4. Add small colored dot before label in trigger button: "● Draft ▾".
5. Auto-complete effect: extend to also handle Paused; format date with `format(..., "dd-MM-yy")`; only fire once via the existing ref.
6. Add a banner under header when Draft and end_date passed: "End date has passed — activate, reschedule, or mark complete."
7. Pre-Active warning if today < start_date: confirm "Start date is {date}. Activate now anyway?".
8. Archive guard: if status===Active or Paused, archive dialog gets extra warning line.

**File: `src/components/campaigns/CampaignModal.tsx`**

9. Remove the Status field from the edit form (or make it read-only), so transitions only flow through the gated handler. Keep status editable only when creating (defaults to Draft, locked).

**Optional polish (low risk)**

10. Add `status_changed_at` write — set `campaign.last_status_change` when transitioning (only if column exists; otherwise skip — confirm via supabase types).

### Out of scope (flagged for later)

- Persistent status history table (audit log).
- Scheduled auto-activation when start_date arrives.

### Files Modified

| File | What |
|------|------|
| `src/pages/CampaignDetail.tsx` | Confirm dialogs, disabled-with-reason items, Resume label, dot indicator, Draft-ended banner, formatted toast, archive warning |
| `src/components/campaigns/CampaignModal.tsx` | Remove/lock Status field in edit mode |

