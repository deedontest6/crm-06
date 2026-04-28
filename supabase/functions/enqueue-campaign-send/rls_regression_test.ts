// F3 regression guard: RLS policies on `campaign_send_job_items` MUST restrict
// SELECT/INSERT/UPDATE/DELETE for authenticated users to campaigns the caller
// can view (read) or manage (write). Service role keeps full access for the runner.
//
// We assert this against the migration source so a future migration that loosens
// the policy will fail this test before it ships.
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const MIGRATION_URL = new URL(
  "../../migrations/20260426145425_a35618db-e025-443c-97f0-639581d83373.sql",
  import.meta.url,
);

// Helper: extract the body of a CREATE POLICY ... FOR <op> ... statement (terminated by `;`).
function extractPolicy(sql: string, op: string): string | null {
  const re = new RegExp(
    `CREATE POLICY[\\s\\S]*?ON\\s+public\\.campaign_send_job_items\\s+FOR\\s+${op}\\s+TO\\s+authenticated[\\s\\S]*?;`,
    "i",
  );
  return sql.match(re)?.[0] ?? null;
}

Deno.test("campaign_send_job_items RLS — read restricted to viewable campaigns", async () => {
  const sql = await Deno.readTextFile(MIGRATION_URL);
  const policy = extractPolicy(sql, "SELECT");
  assert(policy, "Missing SELECT policy on campaign_send_job_items");
  assert(
    policy!.includes("can_view_campaign(campaign_id)"),
    `SELECT policy must guard with can_view_campaign(campaign_id), got: ${policy}`,
  );
  assert(
    !/USING\s*\(\s*true\s*\)/i.test(policy!),
    "SELECT policy must NOT be permissive (USING true)",
  );
});

Deno.test("campaign_send_job_items RLS — write restricted to manageable campaigns", async () => {
  const sql = await Deno.readTextFile(MIGRATION_URL);
  for (const op of ["INSERT", "UPDATE", "DELETE"]) {
    const policy = extractPolicy(sql, op);
    assert(policy, `Missing ${op} policy on campaign_send_job_items`);
    assert(
      policy!.includes("can_manage_campaign(campaign_id)"),
      `${op} policy must guard with can_manage_campaign(campaign_id), got: ${policy}`,
    );
    assert(
      !/USING\s*\(\s*true\s*\)|WITH CHECK\s*\(\s*true\s*\)/i.test(policy!),
      `${op} policy must NOT be permissive (true)`,
    );
  }
});

Deno.test("campaign_send_job_items RLS — service_role retains full access for runner", async () => {
  const sql = await Deno.readTextFile(MIGRATION_URL);
  assert(
    /CREATE POLICY[^;]*ON\s+public\.campaign_send_job_items\s+FOR\s+ALL\s+TO\s+service_role/i.test(
      sql,
    ),
    "service_role must retain FOR ALL access (campaign-send-job-runner depends on it)",
  );
});

Deno.test("enqueue-campaign-send — never trusts actor_user_id from request body", async () => {
  // A3 hardening companion: ensure the audit row's actor_user_id is sourced from
  // the verified JWT (`userId`), never from `body.actor_user_id` or similar.
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(
    !/body\s*\.\s*actor_user_id|body\[['"]actor_user_id['"]\]/.test(src),
    "enqueue-campaign-send must never read actor_user_id from request body",
  );
  assert(
    /actor_user_id:\s*userId/.test(src),
    "Audit insert must set actor_user_id from the verified JWT (userId)",
  );
  assert(
    /can_manage_campaign/.test(src),
    "enqueue-campaign-send must call can_manage_campaign before service-role inserts",
  );
});