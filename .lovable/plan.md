## Email Threading & Reply Bugs — Diagnosis and Fix Plan

I traced all four issues to the database and edge function logs for your `Campaign 28 April` test against `deedontest1@gmail.com`. Here's exactly what's happening and the fix for each.

---

### Issue 1 & 2 — Contact's reply not showing in app

**Root cause (confirmed in `email_reply_skip_log`):** the inbound reply *is* arriving in the mailbox and the cron *does* see it (`Got 11 inbox messages, 8 match tracked conversations`), but it gets dropped by the **chronology gate**:

```
skip_reason: chronology
sender:  deedontest1@gmail.com
subject: Re: Boosting TEST's Efficiency with Our New SaaS
reason:  reply received before any outbound in bucket
bucket_size: 1
```

What happened in DB:
1. We sent original email `543e13ba` at 20:18:59 with `conversationId=AIh5HThr…`
2. The contact replied from Gmail. Gmail-to-Outlook routes the reply, but Outlook assigns it a **new** internal `conversationId=ABe0tHl7…` (Outlook frequently rotates conversationId for cross-domain replies — Gmail breaks Outlook's threading hash).
3. We then sent our own follow-up `d24b6ea5` at 20:21:25, which Graph put on the new `ABe0tHl7…` conversation.
4. The reply checker buckets by `conversationId`, finds only `d24b6ea5` (sent at 20:21) in that bucket, sees the inbound at 20:19 is *older* than the bucket's only outbound, and skips it as "received before any outbound."

**Fix:** the chronology gate must use **header-based parent lookup** as the primary signal (already used for matching, but ignored for chronology). Specifically:

- When `In-Reply-To` / `References` headers point to one of our sent `internet_message_id`s, treat THAT specific email as the parent — not the bucket of the rotated `conversationId`.
- If the header-matched parent is older than the inbound, accept the reply (chronology satisfied).
- Only fall back to the conversationId-bucket chronology when no header parent was found.

This is the industry-standard Outlook/Gmail approach: RFC 5322 headers always win over per-mailstore conversationIds.

---

### Issue 3 — Replying from app creates a new thread for the contact

**Root cause:** confirmed from `campaign_communications` rows. Every "reply" send is getting a brand-new `conversationId` — `d24b6ea5`'s conv (`ABe0tHl7…`) differs from its parent `543e13ba`'s conv (`AIh5HThr…`). Two contributing problems:

a. **Subject mutation in compose modal** — the user can edit the subject before sending. In your screenshot the reply subject was changed to "Boosting TEST's Efficiency with Our New SaaS reply 2". Outlook *never* mutates a reply subject (only adds `Re:`), and Gmail uses subject equivalence to thread. Once the subject changes, Gmail starts a new thread on the contact's side regardless of `In-Reply-To` headers — exactly what you saw in image-25 (two separate threads in Gmail).

b. **`createReply` not consistently invoked** — the native Graph `createReply` path is only used when `replyToGraphMessageId` resolves. For older parents (or when the original send's metadata capture race-conditioned), it falls through to `sendMail` with custom headers, and Gmail bridges then assign a fresh conversation.

**Fix:**
- In `EmailComposeModal.tsx`, when `isReplyMode === true`, **lock the subject field** to the parent's subject prefixed with `Re:` (read-only), exactly like Outlook. Show a small "Reply to: <subject>" caption above. Same for the recipient — already locked, keep that behavior.
- In `send-campaign-email/index.ts`, in reply mode, **always** force the outgoing subject to `Re: <normalized parent subject>` server-side too (defense-in-depth, ignore client-supplied subject changes).
- In `azure-email.ts`, when `createReply` fails or when no `replyToGraphMessageId` is available, fall back to `createReply` on the parent's `internet_message_id` via Graph search before resorting to plain `sendMail`. We already have `findSentMessageGraphId`; use it pre-flight in reply mode and abort the send with a clear error if the parent can't be resolved (better to surface "can't thread this reply" than silently break the contact's inbox).

---

### Issue 4 — Some messages won't collapse on click

**Root cause (line 1665 of `CampaignCommunications.tsx`):**
```ts
const isExpanded = isLatest || expandedMessages.has(msg.id);
```
The latest message is **forced** expanded — `toggleMessageExpanded(msg.id)` flips the Set, but `isLatest` overrides it. So clicking the newest message's header never collapses it. Same bug if a thread has only one message.

**Fix:** seed the latest message's id into `expandedMessages` once per thread (the seeding effect at line 1005 already does this), and remove the `isLatest ||` override so the user-toggle state is always honoured.

```ts
const isExpanded = expandedMessages.has(msg.id);
```

---

### Files to change

1. **`supabase/functions/check-email-replies/index.ts`** — make header-matched parent the chronology anchor (pass the resolved parent into the chronology check; only use bucket fallback when no header parent).
2. **`supabase/functions/send-campaign-email/index.ts`** — server-side enforce `Re: <parent subject>` when `parent_id` is present; fail fast with a clear error if the parent's Graph message can't be resolved in reply mode.
3. **`supabase/functions/_shared/azure-email.ts`** — when `replyToInternetMessageId` is provided but `findSentMessageGraphId` returns nothing, surface that as a hard failure in reply mode (don't silently degrade to a new thread).
4. **`src/components/campaigns/EmailComposeModal.tsx`** — lock the subject input as read-only in reply mode, show parent subject as caption, ensure the value submitted is `Re: <parent subject>`.
5. **`src/components/campaigns/CampaignCommunications.tsx`** — drop the `isLatest ||` force-expand override so the latest message is collapsible.

### Out of scope

- Backfilling/repairing already-broken threads (those rows keep their wrong conversationId; only future replies will thread correctly).
- A "merge thread" UI for orphan inbound replies — manual mapping via the existing unmatched-replies queue still works.
- LinkedIn / Phone threading — the bug is purely email.

### Verification after fix

1. Send a fresh email from a campaign to `deedontest1@gmail.com`.
2. Reply from Gmail — within one cron tick (≤5 min) the inbound should appear in Monitoring with green "Auto-synced Reply" badge.
3. Click Reply in app → confirm the subject field is locked to `Re: …` and submit.
4. Check Gmail — the reply should land in the **same** Gmail thread (not a new one).
5. Click the latest message header in Monitoring → it should collapse.
