-- Self-signup function (auto-confirms email, bypassing GoTrue's mailer)
-- The client should call this RPC, then call signInWithPassword to get a session.
CREATE OR REPLACE FUNCTION public.public_signup(
  p_name text, p_email text, p_password text, p_phone text DEFAULT ''
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_new_id uuid := gen_random_uuid();
  v_hash text;
  v_email text := LOWER(TRIM(p_email));
  v_open boolean;
  v_status public.user_status := 'active';
BEGIN
  IF v_email = '' OR p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'Email and password (min 6 chars) required';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = v_email) THEN
    RAISE EXCEPTION 'Email already registered';
  END IF;

  SELECT open_registration INTO v_open FROM public.settings WHERE id = 'club';
  IF v_open IS NOT NULL AND v_open = false THEN v_status := 'pending'; END IF;

  v_hash := crypt(p_password, gen_salt('bf'));

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_new_id, 'authenticated', 'authenticated', v_email, v_hash,
    now(), jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'role','member'),
    jsonb_build_object('name', p_name, 'phone', COALESCE(p_phone,'')),
    now(), now(), '', '', '', ''
  );
  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), v_new_id,
          jsonb_build_object('sub', v_new_id::text, 'email', v_email),
          'email', v_new_id::text, now(), now(), now());

  -- Trigger created profile; patch with phone + status
  UPDATE public.profiles SET name=p_name, phone=COALESCE(p_phone,''), status=v_status
   WHERE id = v_new_id;

  -- Welcome email
  PERFORM public.queue_email(v_email, 'Welcome to ANAM MMA',
    format('<h2>Welcome to ANAM MMA, %s!</h2><p>Your account has been created.%s</p><p>Train hard. See you on the mats.</p>',
      p_name,
      CASE WHEN v_status='pending' THEN ' It is pending admin approval — you''ll be notified once approved.' ELSE '' END
    ));

  RETURN jsonb_build_object('user_id', v_new_id, 'status', v_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.public_signup(text,text,text,text) TO anon;
