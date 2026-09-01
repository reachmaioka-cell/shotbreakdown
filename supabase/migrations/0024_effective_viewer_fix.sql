-- effective_viewer() used current_user, which inside a SECURITY DEFINER
-- function is the function owner (postgres) rather than the caller's role — so
-- the spoofed-viewer guard never engaged.
--
-- auth.role() reads the caller's JWT claim and is unaffected by SECURITY
-- DEFINER, which is exactly the question being asked here: "is a browser
-- calling this, or our own server?"
--
-- (The column-protection triggers in 0022 ask the opposite question — "is my
-- own SECURITY DEFINER function doing this write?" — and correctly use
-- current_user. The two are not interchangeable.)

create or replace function public.effective_viewer(p_requested uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(auth.role(), '') in ('authenticated', 'anon') then auth.uid()
    else p_requested
  end;
$$;

grant execute on function public.effective_viewer(uuid) to anon, authenticated, service_role;
