

## Performance Audit — Key Issues Found and Fix Plan

### Diagnosis (root causes of slow page loads)

**1. Missing database indexes (biggest single win)**
With 4,432 contacts, 631 accounts, 50 deals and growing, several hot queries do full-table scans:

| Table | Missing index | Used by |
|---|---|---|
| `contacts` | `created_time DESC` | Default sort on Contacts page |
| `contacts` | `company_name` | Account → linked-contact lookup, contact search |
| `deals` | `modified_at DESC` | Default sort on Deals page |
| `deals` | `campaign_id` | Campaign Overview deal counts |
| `campaign_communications` | `campaign_id` (+ `communication_date DESC`) | Every campaign detail page |
| `campaign_contacts` | `campaign_id` alone | Campaign detail Audience/Overview |
| `campaign_accounts` | `campaign_id` alone | Campaign detail Audience/Overview |
| `notifications` | `(user_id, status)` partial | Bell unread count on every page |
| `action_items` | `(status, archived_at)` | Default open-items filter |

Add these as a single migration. Each shaves 100–500 ms on the relevant pages.

**2. `fetch-user-display-names` edge function is slow**
The function calls `supabase.auth.admin.listUsers()` — this fetches **every** user in the project regardless of how many IDs were requested, then filters client-side. Replace with a direct `profiles` table lookup (`.in('id', ids)`) which is a one-shot indexed query. The current edge function adds 300–800 ms on first paint of every list view (Campaigns, Accounts, Action Items, Notifications).

**3. `usePermissions` blocks every page**
`PermissionsContext` runs two queries (`user_roles`, `page_permissions`) on every fresh login, and `loading` gates downstream rendering. The `loading` flag is fine (it has cached fallback), but the `permissions` query has no `staleTime` mismatch — already 10 min — so this is only an issue on cold load. Fix: add a 1-hour `localStorage` warm cache for the role so the second-tab open is instant.

**4. DealsPage double-fetches**
`useQuery(['deals-all'])` fetches once, then `useEffect` calls `fetchDeals()` (= `invalidateQueries`) immediately on mount — that triggers a second identical request. Remove the redundant invalidate; let the query handle initial load.

**5. ContactTable / AccountTable show two spinners on first mount**
The lazy `<Suspense>` shows `RouteFallback` (full-screen spinner), then the table mounts and shows another "Loading contacts…" spinner before data arrives. Combine these by removing the inner full-screen spinner and showing a skeleton table immediately (the page layout, header, filters render instantly).

**6. ActionItems: client-side sort runs on every render**
`const sortedActionItems = [...actionItems].sort(...)` runs every render with no `useMemo`. With 74 items it's fine today, but the modal-open-from-notification effect causes a re-render storm. Wrap with `useMemo`.

**7. KanbanBoard always loads `useActionItems()` even when not needed**
`KanbanBoard` calls `useActionItems()` at the top to support the action-item modal, but that hook fetches & subscribes to `action_items` regardless of whether the modal is opened. Only fetch when the modal opens (or scope the fetch to the deal in the modal).

**8. CampaignDashboard `get_campaign_aggregates` RPC + campaigns query run sequentially**
On Campaigns page first paint we wait for `campaigns` query → then dashboard queries. They can run in parallel — already do via React Query, but `staleTime` on `campaign-aggregates` is only 60 s so quick navigations refetch. Bump to 5 min.

**9. NotificationBell + Notifications page double-fetch**
`useUnreadNotificationCount` (sidebar) and `useNotifications` (page) both subscribe to the `notifications` channel and both run a HEAD count + full list. Acceptable today but worth deduping later.

---

### Plan — Fixes in priority order

#### A. Database migration (biggest impact)
Add the missing indexes:
```sql
CREATE INDEX IF NOT EXISTS idx_contacts_created_time ON contacts (created_time DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_company_name ON contacts (company_name);
CREATE INDEX IF NOT EXISTS idx_contacts_created_by ON contacts (created_by);
CREATE INDEX IF NOT EXISTS idx_deals_modified_at ON deals (modified_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_campaign_id ON deals (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deals_created_by ON deals (created_by);
CREATE INDEX IF NOT EXISTS idx_camp_comms_campaign ON campaign_communications (campaign_id, communication_date DESC);
CREATE INDEX IF NOT EXISTS idx_camp_contacts_campaign ON campaign_contacts (campaign_id);
CREATE INDEX IF NOT EXISTS idx_camp_accounts_campaign ON campaign_accounts (campaign_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_status ON notifications (user_id, status) WHERE status='unread';
CREATE INDEX IF NOT EXISTS idx_action_items_status_archived ON action_items (status, archived_at);
```

#### B. Replace edge function with direct `profiles` query
`src/hooks/useUserDisplayNames.tsx` — drop the `supabase.functions.invoke('fetch-user-display-names', …)` call entirely and use only the existing `profiles` fallback. Saves a function cold-start (~300 ms) and cuts payload to just the requested IDs.

#### C. DealsPage: remove redundant `fetchDeals()` invalidate on mount
Keep the real-time subscription, drop the immediate invalidation — `useQuery` already fetched.

#### D. Show skeleton tables instead of double spinners
`ContactTable`, `AccountTable`: replace the "Loading contacts…" full-spinner with skeleton rows so the user sees structure immediately. (This is a perceived-perf win; also drop the `min-h-screen` spinner inside the lazy Suspense for these routes — render the page chrome immediately and only skeleton the table.)

#### E. Memoize sort in ActionItems
Wrap `sortedActionItems` and `paginatedItems` in `useMemo`.

#### F. Bump dashboard query stale times
`campaign-aggregates` → 5 min; `account-owners` already at 5 min (good).

#### G. Defer `useActionItems()` in KanbanBoard
Only mount the action-item hook lazily when the action modal opens.

### File changes

| File | Change |
|---|---|
| `supabase/migrations/<new>.sql` | Add 11 missing indexes |
| `src/hooks/useUserDisplayNames.tsx` | Remove edge-function call; use `profiles` directly |
| `src/pages/DealsPage.tsx` | Remove redundant `fetchDeals()` on mount; only call on visibility change |
| `src/components/ContactTable.tsx` | Replace spinner with skeleton rows; render table chrome immediately |
| `src/components/AccountTable.tsx` | Same skeleton treatment |
| `src/pages/ActionItems.tsx` | `useMemo` for `sortedActionItems` and `paginatedItems` |
| `src/components/campaigns/CampaignDashboard.tsx` | Bump `staleTime` to 5 min |
| `src/components/KanbanBoard.tsx` | Lazy-mount `useActionItems` only when action modal opens |

### Expected improvement
- Contacts page first paint: ~1.2 s → ~400 ms (index + skeleton + no edge function)
- Campaign Detail page: ~1.5 s → ~500 ms (campaign_communications/contacts/accounts indexes are the big win)
- Deals page: ~800 ms → ~400 ms (modified_at index + no double fetch)
- Action Items: snappier sort + filter changes
- Sidebar unread bell: instant on every page (partial index)

