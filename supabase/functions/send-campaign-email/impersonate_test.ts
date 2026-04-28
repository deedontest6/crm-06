// F6 regression guard: the `x-impersonate-user` header must ONLY take effect
// when the bearer token equals the SUPABASE_SERVICE_ROLE_KEY. For any other
// bearer (anon JWT, user JWT, garbage) the header MUST be ignored and the
// caller authenticated normally via auth.getUser(token).
//
// We assert this at the source level instead of booting the server because
// the module calls Deno.serve(handler) at top-level, which would leak a port
// across the test runner.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("send-campaign-email gates x-impersonate-user behind service-role key", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

  // The conditional block must check token === serviceRoleKey AND impersonateUserId.
  // If a future edit accidentally allows impersonation for any caller, this test fails.
  const guardPattern = /if\s*\(\s*token\s*===\s*serviceRoleKey\s*&&\s*impersonateUserId\s*\)/;
  assert(
    guardPattern.test(src),
    "Impersonation must be gated by `token === serviceRoleKey && impersonateUserId`",
  );

  // The user JWT path (auth.getUser) must remain the else-branch, not run unconditionally
  // before the impersonation check.
  const userBranchAfterImpersonate = src.indexOf("auth.getUser(token)") >
    src.indexOf("impersonateUserId");
  assertEquals(userBranchAfterImpersonate, true, "auth.getUser fallback must come AFTER the impersonation guard");

  // The header name itself must not be read anywhere outside that guarded block.
  const headerRefs = (src.match(/x-impersonate-user/g) || []).length;
  // Header is referenced in: the comment block above the check, and the actual
  // headers.get(...) call. Anything more than 2 references suggests the header
  // is being trusted in additional code paths.
  assert(
    headerRefs <= 2,
    `x-impersonate-user appears ${headerRefs} times — should only be in the comment + the gated check`,
  );
});
