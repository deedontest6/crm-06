

## Plan: Clearer Campaign Types + Useful Fields in Create/Edit Modal

### Problem
- Type options today (`Outreach`, `Nurture`, `Event`) — "Nurture" is jargon and unclear.
- Modal collects only Name, Type, Owner, Dates, Description. Important fields like Goal, Priority, Budget, Channel, and Tags are absent — users have to dig into Strategy tabs even for basics.

### New Type options (plain English)

Replace the 3-option list with 6 self-explanatory types:

| Value | Meaning |
|-------|---------|
| **New Outreach** | Cold contact / first touch with new prospects |
| **Follow-up** | Re-engage existing leads/contacts (replaces "Nurture") |
| **Product Launch** | Announce new product/service |
| **Event / Webinar** | In-person or online event promotion |
| **Promotion / Offer** | Discounts, deals, time-bound offers |
| **Newsletter / Update** | Periodic informational broadcast |

Backwards-compatibility: existing "Nurture" rows auto-display as "Follow-up" via a small label map; existing "Outreach"/"Event" still valid (mapped to "New Outreach" / "Event / Webinar" in the dropdown but old DB values render fine).

### Additional fields in Create/Edit modal

Add these (all optional except where noted) — grouped so the modal stays scannable:

**Basics row 1**: Name * | Type *
**Basics row 2**: Owner * | Priority (Low / Medium / High — new field, store in `notes` JSON-ish OR add column; see below)
**Schedule row**: Start Date * | End Date *
**Reach row**: Primary Channel (Email / Phone / LinkedIn / Mixed) | Goal (short text, e.g. "50 demos booked")
**Details**: Description (textarea, existing)

Fields that map directly to existing `campaigns` columns: `goal` (already in DB but not in modal — surface it), `region`/`country` (leave to Strategy tab), `target_audience` (leave to Strategy).

**New columns needed** (small migration):
- `priority text` — values: Low / Medium / High, default Medium
- `primary_channel text` — values: Email / Phone / LinkedIn / Mixed
- `tags text[]` — optional comma-entered tags for filtering

### UX details
- Modal grows slightly (still fits `sm:max-w-[560px]`); group with subtle dividers/labels: "Basics", "Schedule", "Reach", "Details".
- Goal field gets placeholder "e.g. 50 demos booked, 10 new accounts".
- Priority shown as a small color-coded select (red/amber/green dot).
- Tags use a simple comma-separated input → array on save; chips render inline.
- Edit modal preserves existing Status read-only behavior (gated by header dropdown).

### Files to change
1. `supabase/migrations/<new>.sql` — add `priority`, `primary_channel`, `tags` columns to `campaigns` (nullable, safe defaults).
2. `src/hooks/useCampaigns.tsx` — extend `CampaignFormData`, write new fields in create/update/clone.
3. `src/components/campaigns/CampaignModal.tsx` — new type list, new fields with grouping, tag chip input, priority color dot.
4. `src/components/campaigns/CampaignOverview.tsx` — show Priority, Channel, Tags, Goal in the overview panel.
5. `src/pages/Campaigns.tsx` + `CampaignDashboard.tsx` — extend Type filter to new options; add Priority filter; render channel/priority badge in table.
6. Small label-mapper util `campaignTypeLabel(value)` so legacy values display gracefully.

### Out of scope
- Editing tags inline from list view (only via modal for now).
- Per-channel quotas / send limits (lives in Strategy tabs).

