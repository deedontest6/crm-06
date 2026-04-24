-- =========================================
-- Batch A: Tighten permissive write policies
-- =========================================

-- accounts: enforce created_by on INSERT
DROP POLICY IF EXISTS "Users can insert accounts" ON public.accounts;
CREATE POLICY "Users can insert accounts"
ON public.accounts
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

-- keep_alive: enable RLS, admin-only writes, authenticated reads
ALTER TABLE public.keep_alive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read keep_alive" ON public.keep_alive;
CREATE POLICY "Authenticated can read keep_alive"
ON public.keep_alive
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Admins can insert keep_alive" ON public.keep_alive;
CREATE POLICY "Admins can insert keep_alive"
ON public.keep_alive
FOR INSERT
TO authenticated
WITH CHECK (is_user_admin());

DROP POLICY IF EXISTS "Admins can update keep_alive" ON public.keep_alive;
CREATE POLICY "Admins can update keep_alive"
ON public.keep_alive
FOR UPDATE
TO authenticated
USING (is_user_admin());

DROP POLICY IF EXISTS "Admins can delete keep_alive" ON public.keep_alive;
CREATE POLICY "Admins can delete keep_alive"
ON public.keep_alive
FOR DELETE
TO authenticated
USING (is_user_admin());

-- page_permissions: ensure write policies are admin-gated (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='page_permissions'
      AND policyname='Admins can insert page permissions'
  ) THEN
    EXECUTE 'DROP POLICY "Admins can insert page permissions" ON public.page_permissions';
  END IF;
END $$;

CREATE POLICY "Admins can insert page permissions"
ON public.page_permissions
FOR INSERT
TO authenticated
WITH CHECK (is_user_admin());

DROP POLICY IF EXISTS "Admins can update page permissions" ON public.page_permissions;
CREATE POLICY "Admins can update page permissions"
ON public.page_permissions
FOR UPDATE
TO authenticated
USING (is_user_admin())
WITH CHECK (is_user_admin());

DROP POLICY IF EXISTS "Admins can delete page permissions" ON public.page_permissions;
CREATE POLICY "Admins can delete page permissions"
ON public.page_permissions
FOR DELETE
TO authenticated
USING (is_user_admin());