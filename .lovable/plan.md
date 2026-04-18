
## Plan: Cleaner Account Rows + UX Improvements

### Problems
1. Account rows render 3 empty cells (Title/Email/LinkedIn) — wasted space, noisy.
2. Account row only shows Industry; missing useful fields (Region, Country, Website, Phone) that exist on the `accounts` table.
3. No counts of contacts per account besides text in the name.
4. No quick way to expand/collapse all, no search, and no visual separation between accounts.

### Changes — `src/components/campaigns/CampaignAudienceTable.tsx`

**1. Restructure account row (merge Industry + Region/Country into one cell, span the rest)**

- Expand accounts query to fetch more fields:
  ```ts
  .select("id, account_id, created_at, accounts(account_name, industry, region, country, website, phone)")
  ```
- Replace the 3 empty `<TableCell />` slots with a single `colSpan={3}` cell that displays secondary metadata (Region · Country · Website link) in muted text. Keeps the table column grid intact, removes empty visual gaps.
- Industry stays in column 2; the merged cell sits in columns 3-5.

**2. Account row — add count badge + cleaner header**

- Replace the inline `(N contacts)` text with a small pill badge next to the name (shadcn `Badge` variant `secondary`).
- Show a 🌐 globe icon link for `website` (opens in new tab) when present.

**3. Toolbar improvements**

- Add a search `Input` that filters accounts by name/industry/region and contacts by name/email/position (live filter on existing data, no extra fetch).
- Add **Expand all / Collapse all** toggle button next to the Add buttons.

**4. Contact row stays as-is** (already shows industry + phone after last fix).

**5. Empty-state polish for "Unlinked Contacts"**

- Keep section, but only show header when unlinked > 0 (already the case). Add a small helper text: "Contacts not linked to any campaign account."

### Result

- Account rows look clean: Name + count badge | Industry | Region · Country · 🌐 | Actions.
- Title/Email/LinkedIn only appear meaningfully on contact rows (under expanded accounts).
- Users can search and bulk expand/collapse for faster scanning.
- Realtime sync from prior change continues to work.

### Files Modified

| File | What |
|------|------|
| `src/components/campaigns/CampaignAudienceTable.tsx` | Account row restructure, search input, expand/collapse-all, badge, website link |
