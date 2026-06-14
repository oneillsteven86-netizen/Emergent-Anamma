-- =====================================================================
-- ANAM MMA — Migration 0009: Rooms catalogue
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  capacity int,
  notes text DEFAULT '',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rooms_read_all ON public.rooms;
DROP POLICY IF EXISTS rooms_admin_write ON public.rooms;
CREATE POLICY rooms_read_all ON public.rooms FOR SELECT USING (true);
CREATE POLICY rooms_admin_write ON public.rooms FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- Seed distinct rooms from existing classes (idempotent)
INSERT INTO public.rooms (name)
SELECT DISTINCT room FROM public.classes
 WHERE room IS NOT NULL AND room <> ''
 ON CONFLICT (name) DO NOTHING;

-- Helper: when an admin renames a room, cascade to existing classes that use it.
CREATE OR REPLACE FUNCTION public.rooms_after_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.name <> OLD.name THEN
    UPDATE public.classes SET room = NEW.name WHERE room = OLD.name;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rooms_rename_sync ON public.rooms;
CREATE TRIGGER rooms_rename_sync AFTER UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.rooms_after_update();
