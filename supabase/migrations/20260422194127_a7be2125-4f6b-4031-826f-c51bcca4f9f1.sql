-- =========================================
-- Critical: user_roles UPDATE was wide open
-- =========================================
DROP POLICY IF EXISTS "Users can update all roles" ON public.user_roles;

CREATE POLICY "Admins can update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (is_user_admin())
WITH CHECK (is_user_admin());

-- =========================================
-- security_audit_log: tighten authenticated insert
-- =========================================
DROP POLICY IF EXISTS "Allow audit logging for authenticated users" ON public.security_audit_log;
DROP POLICY IF EXISTS "Users can insert audit logs" ON public.security_audit_log;

CREATE POLICY "Users can insert their own audit logs"
ON public.security_audit_log
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Service role policy stays (RLS bypassed anyway, but explicit is fine)
DROP POLICY IF EXISTS "Allow audit logging for service role" ON public.security_audit_log;
CREATE POLICY "Service role can insert audit logs"
ON public.security_audit_log
FOR INSERT
TO service_role
WITH CHECK (true);

-- =========================================
-- email_history: keep service-role insert explicit
-- (service_role bypasses RLS, so this is informational; linter accepts it)
-- =========================================
-- No change needed — already scoped TO service_role.