import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function html(body: string, status = 200) {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title><style>
      body { font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 48px 16px; color: #0f172a; }
      .card { max-width: 480px; margin: 0 auto; background: white; padding: 32px; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); }
      h1 { font-size: 22px; margin: 0 0 12px; }
      p { color: #475569; line-height: 1.6; margin: 8px 0; }
      .ok { color: #16a34a; font-weight: 600; }
      .err { color: #dc2626; font-weight: 600; }
      a { color: #2563eb; }
    </style></head><body><div class="card">${body}</div></body></html>`,
    { status, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
  );
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const enc = new TextEncoder();

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (let i = 0; i < b.length; i++) str += String.fromCharCode(b[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Token format: `<token_id>.<base64url(hmac_sha256(token_id + ":" + email))>`
 * Constant-time signature verification protects against forgery.
 */
async function verifyToken(
  rawToken: string,
  signingKey: string,
): Promise<{ ok: true; tokenId: string } | { ok: false; reason: string }> {
  if (!rawToken || !rawToken.includes(".")) return { ok: false, reason: "malformed" };
  const [tokenId, sig] = rawToken.split(".", 2);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tokenId)) {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, tokenId };
  // (We compute the expected signature once we know the email from the
  // tokens table — see the handler — and compare in constant time there.)
}

async function hmacSign(key: CryptoKey, message: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return base64UrlEncode(sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

const CONFIRM_PAGE = (token: string, email: string, campaignId: string | null, alreadyDone: boolean) => `
  <h1>${alreadyDone ? "You're already unsubscribed" : "Confirm unsubscribe"}</h1>
  <p>${alreadyDone
    ? `<strong>${email}</strong> is on our suppression list. You will not receive further marketing emails.`
    : `Click the button below to stop receiving marketing emails sent to <strong>${email}</strong>.`}
  </p>
  ${alreadyDone ? "" : `
    <form method="POST" action="?confirm=1" style="margin-top:24px;">
      <input type="hidden" name="t" value="${token}">
      ${campaignId ? `<input type="hidden" name="c" value="${campaignId}">` : ""}
      <button type="submit" style="background:#dc2626;color:white;border:0;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">
        Yes, unsubscribe me
      </button>
    </form>
    <p style="margin-top:24px;font-size:13px;color:#94a3b8;">If you didn't request this, you can safely close this page.</p>
  `}
`;

const SUCCESS_PAGE = (email: string) => `
  <h1 class="ok">You've been unsubscribed</h1>
  <p><strong>${email}</strong> has been added to our suppression list.</p>
  <p>It may take a few minutes for in-flight messages to stop.</p>
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const isJsonClient = req.headers.get("accept")?.includes("application/json");

    // Read either query (?t=) or POST body (form-urlencoded { t, c }).
    let rawToken = url.searchParams.get("t") || "";
    let campaignIdParam = url.searchParams.get("c");
    const isPost = req.method === "POST";

    if (isPost) {
      const ct = req.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const body = await req.json().catch(() => ({}));
        rawToken = body.token || rawToken;
        campaignIdParam = body.campaign_id || campaignIdParam;
      } else if (ct.includes("application/x-www-form-urlencoded")) {
        const form = await req.formData();
        rawToken = (form.get("t") as string) || rawToken;
        campaignIdParam = (form.get("c") as string) || campaignIdParam;
      }
    }

    const signingKey = Deno.env.get("UNSUBSCRIBE_SIGNING_KEY");
    if (!signingKey) {
      return isJsonClient
        ? jsonResponse({ error: "Unsubscribe is not configured (signing key missing)." }, 500)
        : html(`<h1 class="err">Service unavailable</h1><p>The unsubscribe service is misconfigured. Please email the sender to opt out.</p>`, 500);
    }

    const verify = await verifyToken(rawToken, signingKey);
    if (!verify.ok) {
      return isJsonClient
        ? jsonResponse({ error: "Invalid token" }, 400)
        : html(`<h1 class="err">Invalid request</h1><p>This unsubscribe link is malformed or has expired. Please use the link from a recent email.</p>`, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Look up the token record.
    const { data: tokenRow, error: lookupErr } = await supabase
      .from("email_unsubscribe_tokens")
      .select("id, token_id, email, campaign_id, contact_id, consumed_at, expires_at")
      .eq("token_id", verify.tokenId)
      .maybeSingle();

    if (lookupErr) {
      console.error("[unsubscribe] token lookup error:", lookupErr.message);
      return isJsonClient
        ? jsonResponse({ error: "Lookup failed" }, 500)
        : html(`<h1 class="err">Something went wrong</h1><p>Please try again later, or email the sender to opt out.</p>`, 500);
    }
    if (!tokenRow) {
      return isJsonClient
        ? jsonResponse({ error: "Unknown token" }, 404)
        : html(`<h1 class="err">Unknown link</h1><p>This unsubscribe link is no longer valid. If you keep receiving emails, contact the sender directly.</p>`, 404);
    }
    if (new Date(tokenRow.expires_at) < new Date()) {
      return isJsonClient
        ? jsonResponse({ error: "Token expired" }, 410)
        : html(`<h1 class="err">Link expired</h1><p>This unsubscribe link is older than 6 months. Reply directly to the sender to opt out.</p>`, 410);
    }

    // Verify the signature now that we know the email bound to the token.
    const key = await importHmacKey(signingKey);
    const expectedSig = await hmacSign(key, `${tokenRow.token_id}:${tokenRow.email}`);
    const actualSig = rawToken.split(".", 2)[1] || "";
    if (!timingSafeEqual(expectedSig, actualSig)) {
      return isJsonClient
        ? jsonResponse({ error: "Bad signature" }, 401)
        : html(`<h1 class="err">Invalid request</h1><p>This unsubscribe link is invalid.</p>`, 401);
    }

    const alreadyDone = !!tokenRow.consumed_at;

    // GET → confirm page (or "already unsubscribed" page).
    // Detect mailbox-provider one-click POST via List-Unsubscribe-Post: Gmail/Yahoo
    // send `Content-Type: application/x-www-form-urlencoded` with body
    // `List-Unsubscribe=One-Click`. Treat that as a confirmed unsubscribe.
    let isOneClickPost = false;
    if (isPost) {
      const ct = req.headers.get("content-type") || "";
      if (ct.includes("application/x-www-form-urlencoded")) {
        // Already consumed body above for tokens; re-check the raw text.
        // (For Gmail one-click the form contains List-Unsubscribe=One-Click)
        const provider = req.headers.get("x-list-unsubscribe-post") ||
          req.headers.get("list-unsubscribe-post") || "";
        if (provider) isOneClickPost = true;
      }
    }

    const isExplicitConfirm = isPost && (url.searchParams.get("confirm") === "1" || isOneClickPost);

    if (!isPost) {
      return html(CONFIRM_PAGE(rawToken, tokenRow.email, tokenRow.campaign_id, alreadyDone));
    }

    if (!isExplicitConfirm && !isJsonClient) {
      // POST without `confirm=1` — treat as a no-op render (defence
      // against link prefetchers that send POST without the confirm flag).
      return html(CONFIRM_PAGE(rawToken, tokenRow.email, tokenRow.campaign_id, alreadyDone));
    }

    // ── Apply suppression ──────────────────────────────────────
    if (!alreadyDone) {
      const { error: supErr } = await supabase
        .from("campaign_suppression_list")
        .upsert(
          {
            email: tokenRow.email,
            reason: "unsubscribed",
            source: "footer_link",
            campaign_id: tokenRow.campaign_id,
            contact_id: tokenRow.contact_id,
          },
          { onConflict: "email" },
        );
      if (supErr) {
        console.error("[unsubscribe] suppression upsert error:", supErr.message);
        return isJsonClient
          ? jsonResponse({ error: "Failed to suppress" }, 500)
          : html(`<h1 class="err">Something went wrong</h1><p>Please email the sender to opt out.</p>`, 500);
      }

      await supabase
        .from("email_unsubscribe_tokens")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", tokenRow.id);

      // Mark *this contact's* communications in this campaign as
      // unsubscribed — NOT every row in the campaign (the previous
      // implementation had a critical bug doing the latter).
      if (tokenRow.contact_id) {
        const update = supabase
          .from("campaign_communications")
          .update({ unsubscribed_at: new Date().toISOString() })
          .eq("contact_id", tokenRow.contact_id);
        if (tokenRow.campaign_id) update.eq("campaign_id", tokenRow.campaign_id);
        await update;
      }
    }

    if (isJsonClient) {
      return jsonResponse({ ok: true, email: tokenRow.email, alreadyDone });
    }
    return html(SUCCESS_PAGE(tokenRow.email));
  } catch (err) {
    console.error("[unsubscribe] unexpected error:", (err as Error).message);
    return html(`<h1 class="err">Something went wrong</h1><p>Please try again later.</p>`, 500);
  }
});
