-- =====================================================================
-- ANAM MMA — RLS + RPC Functions
-- =====================================================================

-- Helper: get caller's role (SECURITY DEFINER to bypass RLS recursion)
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.user_role;
BEGIN
  SELECT role INTO r FROM public.profiles WHERE id = auth.uid();
  RETURN COALESCE(r, 'member'::public.user_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_perm(p text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.user_role; perms jsonb;
BEGIN
  SELECT role, permissions INTO r, perms FROM public.profiles WHERE id = auth.uid();
  IF r = 'admin' THEN RETURN true; END IF;
  IF r = 'coach' AND COALESCE((perms ->> p)::boolean, false) THEN RETURN true; END IF;
  RETURN false;
END;
$$;

-- Auth trigger: create profile row when auth.users row is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.user_role := 'member';
  v_status public.user_status := 'active';
  v_open boolean;
BEGIN
  -- Read role from app_metadata if provided (admin/coach seeding)
  IF NEW.raw_app_meta_data ? 'role' THEN
    BEGIN
      v_role := (NEW.raw_app_meta_data ->> 'role')::public.user_role;
    EXCEPTION WHEN others THEN v_role := 'member'; END;
  END IF;
  -- Honor open_registration for member self-signups
  IF v_role = 'member' THEN
    SELECT open_registration INTO v_open FROM public.settings WHERE id = 'club';
    IF v_open IS NOT NULL AND v_open = false THEN
      v_status := 'pending';
    END IF;
  END IF;

  INSERT INTO public.profiles (id, email, name, role, status, waiver_accepted, waiver_version, waiver_accepted_at)
  VALUES (
    NEW.id,
    LOWER(NEW.email),
    COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
    v_role,
    v_status,
    v_role <> 'member',
    CASE WHEN v_role <> 'member' THEN '1.0' ELSE NULL END,
    CASE WHEN v_role <> 'member' THEN now() ELSE NULL END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===========================
-- Enable RLS on all tables
-- ===========================
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_overrides   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiver_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings          ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (idempotent re-run)
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname='public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;

-- profiles: any authenticated user can read all profiles (coaches/admins need member lists; we hide sensitive fields client-side)
-- For privacy, members should only see basic coach info. We'll handle via views or limit at app level for now.
CREATE POLICY "profiles_read_authenticated" ON public.profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "profiles_update_self_or_staff" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.current_user_perm('manage_members'))
  WITH CHECK (id = auth.uid() OR public.current_user_perm('manage_members'));

CREATE POLICY "profiles_admin_delete" ON public.profiles
  FOR DELETE TO authenticated
  USING (public.current_user_role() = 'admin');

-- plans: readable by anyone (incl. anon for guest pricing), modify admin only
CREATE POLICY "plans_read_all" ON public.plans
  FOR SELECT USING (true);
CREATE POLICY "plans_admin_write" ON public.plans
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- classes: public read (for guest booking links), staff write
CREATE POLICY "classes_read_all" ON public.classes
  FOR SELECT USING (true);
CREATE POLICY "classes_staff_write" ON public.classes
  FOR ALL TO authenticated
  USING (public.current_user_perm('manage_timetable'))
  WITH CHECK (public.current_user_perm('manage_timetable'));

-- class_overrides: public read, staff write
CREATE POLICY "overrides_read_all" ON public.class_overrides FOR SELECT USING (true);
CREATE POLICY "overrides_staff_write" ON public.class_overrides
  FOR ALL TO authenticated
  USING (public.current_user_perm('manage_timetable'))
  WITH CHECK (public.current_user_perm('manage_timetable'));

-- subscriptions: own + staff
CREATE POLICY "subs_self_read" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_user_perm('manage_members'));
CREATE POLICY "subs_staff_write" ON public.subscriptions
  FOR ALL TO authenticated
  USING (public.current_user_perm('manage_members'))
  WITH CHECK (public.current_user_perm('manage_members'));

-- payments: own + staff
CREATE POLICY "payments_self_read" ON public.payments
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_user_perm('manage_members'));
CREATE POLICY "payments_staff_write" ON public.payments
  FOR ALL TO authenticated
  USING (public.current_user_perm('manage_members'))
  WITH CHECK (public.current_user_perm('manage_members'));

-- bookings: members see own, staff see all
CREATE POLICY "bookings_read" ON public.bookings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_user_perm('mark_attendance') OR public.current_user_perm('manage_members'));
CREATE POLICY "bookings_self_insert" ON public.bookings
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.current_user_perm('manage_members'));
CREATE POLICY "bookings_self_update" ON public.bookings
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.current_user_perm('mark_attendance') OR public.current_user_perm('manage_members'));
CREATE POLICY "bookings_staff_delete" ON public.bookings
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.current_user_perm('manage_members'));

-- private_sessions
CREATE POLICY "ps_read" ON public.private_sessions
  FOR SELECT TO authenticated
  USING (member_id = auth.uid() OR coach_id = auth.uid() OR public.current_user_role() = 'admin');
CREATE POLICY "ps_insert" ON public.private_sessions
  FOR INSERT TO authenticated
  WITH CHECK (member_id = auth.uid());
CREATE POLICY "ps_update" ON public.private_sessions
  FOR UPDATE TO authenticated
  USING (member_id = auth.uid() OR coach_id = auth.uid() OR public.current_user_role() = 'admin');

-- announcements: read by authenticated, write by staff
CREATE POLICY "ann_read" ON public.announcements FOR SELECT TO authenticated USING (true);
CREATE POLICY "ann_write" ON public.announcements FOR ALL TO authenticated
  USING (public.current_user_perm('send_announcements'))
  WITH CHECK (public.current_user_perm('send_announcements'));

-- notifications: only own
CREATE POLICY "notif_self_all" ON public.notifications
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- waiver_log: own + admin
CREATE POLICY "waiver_read" ON public.waiver_log FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_user_role() = 'admin');
CREATE POLICY "waiver_insert_self" ON public.waiver_log FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- settings: public read, admin write
CREATE POLICY "settings_read_all" ON public.settings FOR SELECT USING (true);
CREATE POLICY "settings_admin_write" ON public.settings FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');
