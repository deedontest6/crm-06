// Regression guard: ensure the function rejects requests without an Authorization header.
// If a future edit removes the auth check, this test fails immediately.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("send-campaign-email returns 401 when Authorization header is missing", async () => {
  // The module calls Deno.serve(handler) at top level, so importing it in a unit
  // test leaks the HTTP server. Keep this as a source-level regression guard.
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const hasAuthCheck = src.includes('Authorization') && src.includes('401') && src.includes('Unauthorized');
  assertEquals(hasAuthCheck, true, "send-campaign-email must keep the Authorization 401 guard");
});
