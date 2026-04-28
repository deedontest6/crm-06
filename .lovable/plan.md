# Fix: Contact Replies Not Detected

## Diagnosis (from logs + DB)

I traced the issue end-to-end and found a chain of failures, not a single bug.

### What is happening

1. **Outlook silently rejects standard `In-Reply-To` headers.** Every send shows the warning:
   `Standard threading headers rejected by Graph; retrying with x- prefix.`
   The fallback uses `x-In-Reply-To` / `x-References` — but Gmail and Outlook **ignore `x-` prefixed headers** for threading. So every outbound goes out with **no threading headers the recipient can see**.

2. **Native `createReply` fails with 403 ErrorAccessDenied.** Logs show:
   `createReply failed (403); falling back to sendMail with headers. ErrorAccessDenied`
   This happens because the parent was sent as the shared mailbox `crm@realthingks.com` but the user `deepak.dongare@realthingks.com` is calling `createReply` against their own user mailbox endpoint. Graph can't find that message in the wrong mailbox → 403.

3. **Each send creates a new `conversation_id`.** Because Outlook never sees a real `In-Reply-To`, it uses subject normalization. With slightly mutated subjects like "...reply 2" or new sends after replies, every send becomes a new Outlook conversation. The DB shows 5 outbounds with the same subject, each in a different `conversation_id`.

4. **Chronology gate kills the contact's reply.** `email_reply_skip_log` shows reply at 20:35:59 anchored to parent at 20:38:14 — i.e., the gate compared the reply against an outbound sent *3 minutes after* the reply (a different one in the rotated conversation bucket). The header-anchored fast path didn't save it because the inbound has no usable `In-Reply-To` (see #1) — so we fell through to bucket logic and skipped.

5. **Some outbounds have `internet_message_id = NULL`** (e.g. the 19:22 / 19:48 rows), so even if a reply DID have In-Reply-To pointing at them, header lookup couldn't match. Cause: `fetchSentMessageMetadata` returns empty when Sent Items lookup loses the race against the cron.

6. **UI message-collapse bug** (lower priority): the `9f1b2562` message in the screenshot shows only one outbound, but the user reported the same screen has un-collapsing items. The `expandedMessages` Set is seeded from initial render but never cleared on thread switch.

## Fixes

### Edge function: `_shared/azure-email.ts`

a. **Detect the shared-mailbox case before calling `createReply`.** If the parent was sent as a shared mailbox (`sentAsShared` / `parent.sender_email !== authenticated user`), call `createReply` against the **shared mailbox endpoint** (`/users/{shared}/messages/{id}/createReply`), not the user mailbox. This eliminates the 403.

b. **Stop trying standard header names.** Microsoft Graph rejects `In-Reply-To` / `References` as "InvalidInternetMessageHeader" — only `x-` prefixed custom headers are accepted via `sendMail`. Skip the standard-name attempt to remove the noisy retry, and **rely on `createReply` (now fixed in (a)) as the only path that produces real RFC 5322 threading headers in the outbound message**.

c. **Hard-fail when both `createReply` paths fail.** Returning success after the `x-`-prefix fallback gives the false impression that threading worked. Instead, return `errorCode: "REPLY_THREADING_BROKEN"` so the UI surfaces it. (We already added `REPLY_PARENT_UNRESOLVABLE`; this is the runtime sibling.)

d. **Persist `internet_message_id` reliably.** Extend `fetchSentMessageMetadata` retry budget for the no-correlation-token path and, if still empty after retries, do one final `findSentMessageGraphId` lookup using `conversationId` to recover the `internetMessageId` instead of storing NULL.

### Edge function: `check-email-replies/index.ts`

e. **Always fetch `internetMessageHeaders` per-message when missing.** The list endpoint sometimes returns an empty `internetMessageHeaders` array even when the field is `$select`-ed. Currently we only re-fetch when `conversationId` doesn't match a tracked conversation (line 437). Move that re-fetch into the inner relevant-messages loop so we always have headers before doing header-anchored lookup.

f. **Loosen header matching: strip `<>` and lowercase before comparing.** Some Graph payloads return `In-Reply-To` without angle brackets while we store `internet_message_id` with `<>`. Normalize both sides before the `IN` query.

g. **Add a subject + contact + ±10min chronology rescue.** When header-anchored lookup AND bucket-by-convId both fail to produce a parent within ±10 minutes, do one last lookup: same campaign + same contact + subject-compatible + outbound `communication_date` within ±10 min of `received_at`. This catches the case where Outlook rotated convId AND the reply has no usable `In-Reply-To`. Mark these matches with `match_method: "subject_chronology_rescue"` in metadata.

h. **Loosen the chronology gate by 60 seconds.** Allow `outTime <= receivedTime + 60_000` to account for Outlook's `receivedDateTime` being the inbox-arrival time (sometimes slightly *before* our `communication_date` is written by the post-send DB insert).

### Send path: `send-campaign-email/index.ts`

i. **When sending a reply, prefer the parent's mailbox.** If `parentComm.sender_email` differs from the current user's mailbox, route the createReply call through the parent's mailbox (the user has Send-As on the shared mailbox per existing config). This pairs with fix (a).

j. **Never store NULL `internet_message_id` for `delivery_status='sent'` rows.** If metadata lookup fails, surface a warning and let the row be retried by the metadata back-fill cron rather than leaving NULL forever.

### UI: `CampaignCommunications.tsx`

k. **Reset `expandedMessages` when thread changes.** On thread/conversation switch, clear the Set and re-seed only the latest message. Fixes the "some emails don't collapse" report.

## Validation

After deploy:
1. Manually invoke `check-email-replies` and confirm the existing 4 chronology-skipped replies in `email_reply_skip_log` are now ingested (header-fetch + rescue path).
2. Send a fresh test reply from `deedontest1@gmail.com` and confirm it lands in the conversation reader.
3. Reply from the app and confirm `email_send_log` shows `success` with non-null `internet_message_id` and the contact's mail client shows the message threaded under the original (not a new thread).
4. Verify edge logs no longer contain the "Standard threading headers rejected" warning.
5. Click to collapse the latest message in a thread and confirm it stays collapsed.

## Out of scope (call out, not fixing here)

- Backfilling NULL `internet_message_id` on the 3 historical rows — needs a one-shot SQL job; will offer separately.
- Switching to Microsoft Graph subscription/webhook for inbox events instead of the 5-minute cron — bigger architectural change.
