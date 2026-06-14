-- =====================================================================
-- ANAM MMA — Supabase Schema, RLS, Functions
-- =====================================================================

-- Required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_net";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- ===========================
-- 1. Enums
-- ===========================
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('member','coach','admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.user_status AS ENUM ('active','pending','removed','suspended');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.booking_status AS ENUM ('booked','waitlist','attended','no_show','cancelled','class_cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.sub_status AS ENUM ('pending_payment','active','frozen','expired','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.plan_type AS ENUM ('monthly','trial','class_pack');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.private_status AS ENUM ('requested','confirmed','declined','cancelled');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ===========================
-- 2. Tables
-- ===========================

-- profiles: extends auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  name text NOT NULL DEFAULT '',
  phone text DEFAULT '',
  role public.user_role NOT NULL DEFAULT 'member',
  status public.user_status NOT NULL DEFAULT 'active',
  waiver_accepted boolean NOT NULL DEFAULT false,
  waiver_version text,
  waiver_accepted_at timestamptz,
  emergency_contact_name text DEFAULT '',
  emergency_contact_phone text DEFAULT '',
  medical_notes text DEFAULT '',
  admin_notes text DEFAULT '',
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  bio text DEFAULT '',
  photo text DEFAULT '',
  deletion_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles(role);
CREATE INDEX IF NOT EXISTS profiles_status_idx ON public.profiles(status);

-- plans
CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  price numeric(10,2) NOT NULL,
  type public.plan_type NOT NULL,
  duration_days int NOT NULL DEFAULT 30,
  sessions int,
  description text DEFAULT '',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- classes (recurring weekly)
CREATE TABLE IF NOT EXISTS public.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  day_of_week int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time text NOT NULL, -- "HH:MM"
  duration_min int NOT NULL DEFAULT 60,
  room text NOT NULL DEFAULT 'Main Mat',
  capacity int NOT NULL DEFAULT 20,
  coach_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  image text DEFAULT '',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- class overrides (cancellations for specific dates)
CREATE TABLE IF NOT EXISTS public.class_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  date date NOT NULL,
  status text NOT NULL DEFAULT 'cancelled',
  reason text DEFAULT '',
  UNIQUE (class_id, date)
);

-- subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  plan_id uuid NOT NULL REFERENCES public.plans(id),
  plan_name text NOT NULL,
  plan_type public.plan_type NOT NULL,
  price numeric(10,2) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status public.sub_status NOT NULL DEFAULT 'pending_payment',
  sessions_remaining int,
  reminder_sent boolean NOT NULL DEFAULT false,
  frozen_at date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS subs_user_idx ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS subs_status_end_idx ON public.subscriptions(status, end_date);

-- payments
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  plan_name text NOT NULL,
  amount numeric(10,2) NOT NULL,
  method text NOT NULL DEFAULT 'cash',
  receipt_no text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_user_idx ON public.payments(user_id);

-- bookings
CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  class_name text NOT NULL,
  date date NOT NULL,
  start_time text NOT NULL,
  room text DEFAULT '',
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  guest_name text,
  guest_email text,
  status public.booking_status NOT NULL DEFAULT 'booked',
  checked_in_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_class_date_idx ON public.bookings(class_id, date);
CREATE INDEX IF NOT EXISTS bookings_user_idx ON public.bookings(user_id);

-- private sessions
CREATE TABLE IF NOT EXISTS public.private_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  member_name text NOT NULL,
  coach_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  coach_name text NOT NULL,
  date date NOT NULL,
  time text NOT NULL,
  notes text DEFAULT '',
  status public.private_status NOT NULL DEFAULT 'requested',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- announcements
CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  audience text NOT NULL DEFAULT 'all',
  class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- notifications (in-app)
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  type text NOT NULL DEFAULT 'general',
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notif_user_idx ON public.notifications(user_id, created_at DESC);

-- waiver log
CREATE TABLE IF NOT EXISTS public.waiver_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_email text NOT NULL,
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);

-- settings (singleton)
CREATE TABLE IF NOT EXISTS public.settings (
  id text PRIMARY KEY DEFAULT 'club',
  open_registration boolean NOT NULL DEFAULT true,
  cancellation_window_hours int NOT NULL DEFAULT 2,
  private_session_policy text DEFAULT '',
  club_email text DEFAULT '',
  waiver_version text DEFAULT '1.0',
  media jsonb NOT NULL DEFAULT '{}'::jsonb
);
