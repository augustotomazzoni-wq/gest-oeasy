REVOKE ALL ON FUNCTION public.can(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.has_permission(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.is_protected_admin(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.protect_main_admin() FROM anon, authenticated, PUBLIC;