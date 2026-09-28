-- Automatically create user_roles and profiles when a new user signs up in auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.app_role;
  v_full_name TEXT;
  v_phone TEXT;
BEGIN
  -- Determine role from user metadata
  IF NEW.raw_user_meta_data->>'role' = 'interviewer' THEN
    v_role := 'interviewer'::public.app_role;
  ELSE
    v_role := 'candidate'::public.app_role;
  END IF;

  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
  v_phone := COALESCE(NEW.raw_user_meta_data->>'phone_number', '0000000000');

  -- 1. Insert into user_roles
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, v_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- 2. Insert into profiles
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (NEW.id, v_full_name, NEW.email)
  ON CONFLICT (user_id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      email = EXCLUDED.email;

  -- 3. If candidate, ensure candidate_profiles row exists
  IF v_role = 'candidate' THEN
    INSERT INTO public.candidate_profiles (user_id, phone_number, full_name, email, verification_status)
    VALUES (NEW.id, v_phone, v_full_name, NEW.email, 'pending')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
