

## Plan: Fix Audience data display + add realtime sync

### Root causes identified

Looking at `CampaignAudienceTable.tsx` (line 82-103, the `ContactRow`):

1. **Industry column is hardcoded to `—`** (line 85). The query never selects `industry` from contacts, so it always shows a dash. Deepak Dongare has `industry: Automotive` in DB but it isn't fetched or rendered.
2. **Phone is missing entirely** — the contact row has no phone column at all (the table only has Name/Industry/Title/Email/LinkedIn/Actions), even though phone exists for Deepak (+918425062561).
3. **Account-level "Industry" works** because the accounts query selects `accounts(account_name, industry)`, but at the contact row the same column position blindly renders `—`.
4. **No realtime sync** — `contacts` is in the realtime publication, but `CampaignAudienceTable` only fetches once via React Query. Edits in the Contacts module don't propagate until manual refetch.

### Changes

**File: `src/components/campaigns/CampaignAudienceTable.tsx`**

1. **Expand contacts query select** (line 44) to include `industry, phone_no`:
   ```ts
   .select("id, contact_id, account_id, contacts(contact_name, email, position, linkedin, industry, phone_no)")
   ```

2. **Fix `ContactRow`** (lines 82–103):
   - Render `cc.contacts?.industry || "—"` in the Industry cell (instead of hardcoded `—`).
   - Show phone number under the contact name as a small muted line, since the table doesn't have a dedicated phone column (keeps current column layout intact).

3. **Add a Realtime subscription** via `useEffect`:
   - Subscribe to Postgres changes on `contacts`, `accounts`, `campaign_contacts`, `campaign_accounts` (filter campaign_* by `campaign_id=eq.{campaignId}`).
   - On any change, invalidate the two queries: `["campaign-audience-contacts", campaignId]` and `["campaign-audience-accounts", campaignId]`.
   - Cleanup channel on unmount.

**File: `supabase/migrations/<new>.sql`** (new migration)

Add the three missing tables to the realtime publication so subscriptions actually fire:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.accounts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.campaign_contacts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.campaign_accounts;
ALTER TABLE public.accounts REPLICA IDENTITY FULL;
ALTER TABLE public.contacts REPLICA IDENTITY FULL;
ALTER TABLE public.campaign_contacts REPLICA IDENTITY FULL;
ALTER TABLE public.campaign_accounts REPLICA IDENTITY FULL;
```
(Wrapped in `DO $$ ... EXCEPTION WHEN duplicate_object` to be idempotent.)

### Result

- "Deepak Dongare" row will show Industry = Automotive, with phone visible under the name.
- Editing a contact (name, email, position, industry, phone, linkedin) anywhere in the app updates the Audience table within ~1s without manual reload.
- Adding/removing campaign accounts/contacts from another tab/device also reflects live.

