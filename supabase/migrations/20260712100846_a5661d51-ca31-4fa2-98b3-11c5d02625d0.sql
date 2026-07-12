DROP POLICY IF EXISTS "empresa_global select autenticados" ON public.empresa_global;
CREATE POLICY "empresa_global select miembros" ON public.empresa_global
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (SELECT 1 FROM public.tienda_usuarios tu WHERE tu.user_id = auth.uid())
);