-- ============================================================================
-- REVERSIÓN de 20261031100100_rendimiento_rls.sql
-- ============================================================================
-- Vuelve a poner las políticas de lectura anteriores (con is_tienda_member y
-- es_miembro_empresa por fila), con el mismo nombre. El acceso es el mismo
-- antes y después; solo vuelve a ser más lento. No toca datos.
-- Las funciones mis_tiendas() y mis_empresas() se quitan al final, cuando ya
-- no las usa ninguna política (si otra migración posterior las usara, el DROP
-- FUNCTION fallaría por dependencia: en ese caso, dejarlas).
-- ============================================================================

DROP POLICY IF EXISTS "pedidos lectura" ON public.pedidos;
CREATE POLICY "pedidos lectura" ON public.pedidos FOR SELECT TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "facturas lectura miembros" ON public.facturas;
CREATE POLICY "facturas lectura miembros" ON public.facturas FOR SELECT TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "pedido_devoluciones lectura" ON public.pedido_devoluciones;
CREATE POLICY "pedido_devoluciones lectura" ON public.pedido_devoluciones FOR SELECT TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "pedido_items lectura" ON public.pedido_items;
CREATE POLICY "pedido_items lectura" ON public.pedido_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pedidos p
                  WHERE p.id = pedido_items.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)));

DROP POLICY IF EXISTS "enlaces_seguimiento lectura" ON public.enlaces_seguimiento;
CREATE POLICY "enlaces_seguimiento lectura" ON public.enlaces_seguimiento FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pedidos p
                  WHERE p.id = enlaces_seguimiento.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)));

DROP POLICY IF EXISTS "factura_items lectura miembros" ON public.factura_items;
CREATE POLICY "factura_items lectura miembros" ON public.factura_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.facturas f
                  WHERE f.id = factura_items.factura_id AND public.is_tienda_member(auth.uid(), f.tienda_id)));

DROP POLICY IF EXISTS "cobros lectura" ON public.cobros;
CREATE POLICY "cobros lectura" ON public.cobros FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "clientes lectura" ON public.clientes;
CREATE POLICY "clientes lectura" ON public.clientes FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "textil_pedidos_lectura" ON public.textil_pedidos;
CREATE POLICY "textil_pedidos_lectura" ON public.textil_pedidos FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "textil_facturas_lectura" ON public.textil_facturas;
CREATE POLICY "textil_facturas_lectura" ON public.textil_facturas FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "textil_pedido_items lectura" ON public.textil_pedido_items;
CREATE POLICY "textil_pedido_items lectura" ON public.textil_pedido_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.textil_pedidos p
                  WHERE p.id = textil_pedido_items.pedido_id AND public.es_miembro_empresa(auth.uid(), p.empresa_id)));

DROP POLICY IF EXISTS "textil_factura_items lectura" ON public.textil_factura_items;
CREATE POLICY "textil_factura_items lectura" ON public.textil_factura_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.textil_facturas p
                  WHERE p.id = textil_factura_items.factura_id AND public.es_miembro_empresa(auth.uid(), p.empresa_id)));

DROP POLICY IF EXISTS "compras lectura" ON public.textil_compras;
CREATE POLICY "compras lectura" ON public.textil_compras FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP FUNCTION IF EXISTS public.mis_tiendas();
DROP FUNCTION IF EXISTS public.mis_empresas();

NOTIFY pgrst, 'reload schema';
