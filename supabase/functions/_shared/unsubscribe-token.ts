// Shared HMAC-signed unsubscribe token helpers.
// Token format: `<token_id>.<base64url(hmac_sha256(token_id + ":" + email))>`
// `token_id` is a UUID stored in `email_unsubscribe_tokens` so we can record
// minted/consumed state without ever needing to verify by email lookup alone.

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  let str = "";
  for (let i = 0; i < b.length; i++) str += String.fromCharCode(b[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * Returns `{ token, tokenId }`. Caller is responsible for upserting the
 * `email_unsubscribe_tokens` row using the returned `tokenId`.
 */
export async function mintUnsubscribeToken(
  email: string,
  signingSecret: string,
): Promise<{ token: string; tokenId: string }> {
  const tokenId = crypto.randomUUID();
  const key = await hmacKey(signingSecret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${tokenId}:${email.toLowerCase()}`),
  );
  return { token: `${tokenId}.${b64url(sig)}`, tokenId };
}

/**
 * Builds the absolute unsubscribe URL for the given token.
 */
export function buildUnsubscribeUrl(
  baseUrl: string,
  token: string,
  campaignId?: string | null,
): string {
  const params = new URLSearchParams({ t: token });
  if (campaignId) params.set("c", campaignId);
  return `${baseUrl}/functions/v1/unsubscribe?${params.toString()}`;
}
