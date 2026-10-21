-- ============================================================================
-- RENDIMIENTO 2/2: POLÍTICAS DE LECTURA QUE SE EVALÚAN UNA VEZ POR CONSULTA
-- ============================================================================
--
-- QUÉ RESUELVE
--   is_tienda_member(auth.uid(), tienda_id) y es_miembro_empresa(...) son
--   SECURITY DEFINER: Postgres no las puede desplegar dentro de la consulta y
--   las llama por cada fila candidata. Con 12.000 pedidos de un año son 12.000
--   llamadas, y en Supabase cada auth.uid() vuelve a leer el JSON del token.
--   Aquí el conjunto de tiendas o empresas del usuario se calcula UNA vez por
--   consulta (InitPlan, por el «(SELECT …)») y cada fila solo se compara con
--   un array.
--
-- QUÉ CREA
--   public.mis_tiendas()  RETURNS uuid[]  admin → todas las tiendas; si no,
--                                         las suyas de tienda_usuarios.
--   public.mis_empresas() RETURNS uuid[]  admin → todas las empresas; si no,
--                                         las de sus tiendas.
--   STABLE SECURITY DEFINER, search_path = public. Solo las ejecuta
--   authenticated (REVOKE a PUBLIC y anon). Solo devuelven lo del que llama.
--
-- QUÉ CAMBIA
--   Solo las políticas FOR SELECT de pedidos, pedido_items, facturas,
--   factura_items, pedido_devoluciones, enlaces_seguimiento, cobros,
--   clientes, textil_pedidos, textil_pedido_items, textil_facturas,
--   textil_factura_items y textil_compras, con el mismo nombre que tienen.
--   Alta, edición y baja no se tocan. Ningún FOR ALL. La tabla auditoria no
--   se toca.
--
-- MISMO ACCESO QUE ANTES
--   is_tienda_member y es_miembro_empresa devuelven true para el
--   administrador con CUALQUIER valor, incluido NULL; «x = ANY(array)» con
--   x NULL da NULL (fila oculta). Es idéntico SOLO porque tienda_id y
--   empresa_id son NOT NULL en las ocho tablas raíz de aquí (pedidos,
--   facturas, pedido_devoluciones: tienda_id; cobros, clientes,
--   textil_pedidos, textil_facturas, textil_compras: empresa_id) y tienen
--   clave foránea a tiendas o empresas. Si alguna de esas columnas pasara a
--   admitir NULL, hay que revisar estas políticas.
--   El «::uuid[]» es obligatorio: sin él falla con
--   «operator does not exist: uuid = uuid[]».
--
-- ANTES DE APLICARLA (solo lectura): cada una de esas tablas debe tener UNA
--   política SELECT (y ningún FOR ALL) con el nombre que usa esta migración:
--     SELECT tablename, policyname, cmd, qual FROM pg_policies
--      WHERE schemaname = 'public' AND cmd IN ('SELECT', 'ALL')
--        AND tablename IN ('pedidos','pedido_items','facturas','factura_items',
--          'pedido_devoluciones','enlaces_seguimiento','cobros','clientes',
--          'textil_pedidos','textil_pedido_items','textil_facturas',
--          'textil_factura_items','textil_compras')
--      ORDER BY 1, 2;
--   Si una política se hubiera creado a mano con otro nombre, el DROP POLICY
--   IF EXISTS no la quitaría y la nueva se sumaría a la vieja: mismo acceso,
--   pero sin ganancia. Por eso la migración lo comprueba ella misma al
--   principio (antes de cambiar nada) y al final, y se para con un error.
--
-- REVERSIÓN
--   supabase/reversiones/20261031100100_rendimiento_rls.sql (vuelve a crear
--   las políticas anteriores, copiadas también al final de este fichero).
-- ============================================================================

-- ---- 0. Comprobación previa: las políticas que se van a sustituir ----------
DO $$
DECLARE
  v_raras TEXT;
BEGIN
  SELECT string_agg(p.tablename || ' «' || p.policyname || '» (' || p.cmd || ')', ', ')
    INTO v_raras
    FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.cmd IN ('SELECT', 'ALL')
     AND (p.tablename, p.policyname) NOT IN (
       ('pedidos',              'pedidos lectura'),
       ('facturas',             'facturas lectura miembros'),
       ('pedido_devoluciones',  'pedido_devoluciones lectura'),
       ('pedido_items',         'pedido_items lectura'),
       ('enlaces_seguimiento',  'enlaces_seguimiento lectura'),
       ('factura_items',        'factura_items lectura miembros'),
       ('cobros',               'cobros lectura'),
       ('clientes',             'clientes lectura'),
       ('textil_pedidos',       'textil_pedidos_lectura'),
       ('textil_facturas',      'textil_facturas_lectura'),
       ('textil_pedido_items',  'textil_pedido_items lectura'),
       ('textil_factura_items', 'textil_factura_items lectura'),
       ('textil_compras',       'compras lectura'),
       ('textil_compras',       'textil_compras lectura'))
     AND p.tablename IN ('pedidos', 'pedido_items', 'facturas', 'factura_items',
                         'pedido_devoluciones', 'enlaces_seguimiento', 'cobros',
                         'clientes', 'textil_pedidos', 'textil_pedido_items',
                         'textil_facturas', 'textil_factura_items', 'textil_compras');
  IF v_raras IS NOT NULL THEN
    RAISE EXCEPTION 'rendimiento_rls: hay políticas de lectura con un nombre que esta migración no sustituye: %. No se ha cambiado nada; revisarlas antes de aplicarla.', v_raras;
  END IF;
END $$;

-- ---- 1. Las dos funciones ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.mis_tiendas()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(t.id), '{}')
    FROM public.tiendas t
   WHERE public.has_role(auth.uid(), 'admin')
      OR EXISTS (SELECT 1 FROM public.tienda_usuarios tu
                  WHERE tu.user_id = auth.uid() AND tu.tienda_id = t.id);
$$;

CREATE OR REPLACE FUNCTION public.mis_empresas()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(e.id), '{}')
    FROM public.empresas e
   WHERE public.has_role(auth.uid(), 'admin')
      OR EXISTS (SELECT 1 FROM public.tienda_usuarios tu
                   JOIN public.tiendas t ON t.id = tu.tienda_id
                  WHERE tu.user_id = auth.uid() AND t.empresa_id = e.id);
$$;

COMMENT ON FUNCTION public.mis_tiendas() IS
  'Tiendas que puede leer quien llama (admin: todas). Para políticas de lectura: tienda_id = ANY ((SELECT public.mis_tiendas())::uuid[]).';
COMMENT ON FUNCTION public.mis_empresas() IS
  'Empresas que puede leer quien llama (admin: todas). Para políticas de lectura: empresa_id = ANY ((SELECT public.mis_empresas())::uuid[]).';

REVOKE ALL ON FUNCTION public.mis_tiendas(), public.mis_empresas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mis_tiendas(), public.mis_empresas() TO authenticated;

-- ---- 2. Por tienda ----------------------------------------------------------
DROP POLICY IF EXISTS "pedidos lectura" ON public.pedidos;
CREATE POLICY "pedidos lectura" ON public.pedidos FOR SELECT TO authenticated
  USING (tienda_id = ANY ((SELECT public.mis_tiendas())::uuid[]));

DROP POLICY IF EXISTS "facturas lectura miembros" ON public.facturas;
CREATE POLICY "facturas lectura miembros" ON public.facturas FOR SELECT TO authenticated
  USING (tienda_id = ANY ((SELECT public.mis_tiendas())::uuid[]));

DROP POLICY IF EXISTS "pedido_devoluciones lectura" ON public.pedido_devoluciones;
CREATE POLICY "pedido_devoluciones lectura" ON public.pedido_devoluciones FOR SELECT TO authenticated
  USING (tienda_id = ANY ((SELECT public.mis_tiendas())::uuid[]));

DROP POLICY IF EXISTS "pedido_items lectura" ON public.pedido_items;
CREATE POLICY "pedido_items lectura" ON public.pedido_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pedidos p
                  WHERE p.id = pedido_items.pedido_id
                    AND p.tienda_id = ANY ((SELECT public.mis_tiendas())::uuid[])));

DROP POLICY IF EXISTS "enlaces_seguimiento lectura" ON public.enlaces_seguimiento;
CREATE POLICY "enlaces_seguimiento lectura" ON public.enlaces_seguimiento FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pedidos p
                  WHERE p.id = enlaces_seguimiento.pedido_id
                    AND p.tienda_id = ANY ((SELECT public.mis_tiendas())::uuid[])));

DROP POLICY IF EXISTS "factura_items lectura miembros" ON public.factura_items;
CREATE POLICY "factura_items lectura miembros" ON public.factura_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.facturas f
                  WHERE f.id = factura_items.factura_id
                    AND f.tienda_id = ANY ((SELECT public.mis_tiendas())::uuid[])));

-- ---- 3. Por empresa ---------------------------------------------------------
DROP POLICY IF EXISTS "cobros lectura" ON public.cobros;
CREATE POLICY "cobros lectura" ON public.cobros FOR SELECT TO authenticated
  USING (empresa_id = ANY ((SELECT public.mis_empresas())::uuid[]));

DROP POLICY IF EXISTS "clientes lectura" ON public.clientes;
CREATE POLICY "clientes lectura" ON public.clientes FOR SELECT TO authenticated
  USING (empresa_id = ANY ((SELECT public.mis_empresas())::uuid[]));

DROP POLICY IF EXISTS "textil_pedidos_lectura" ON public.textil_pedidos;
CREATE POLICY "textil_pedidos_lectura" ON public.textil_pedidos FOR SELECT TO authenticated
  USING (empresa_id = ANY ((SELECT public.mis_empresas())::uuid[]));

DROP POLICY IF EXISTS "textil_facturas_lectura" ON public.textil_facturas;
CREATE POLICY "textil_facturas_lectura" ON public.textil_facturas FOR SELECT TO authenticated
  USING (empresa_id = ANY ((SELECT public.mis_empresas())::uuid[]));

DROP POLICY IF EXISTS "textil_pedido_items lectura" ON public.textil_pedido_items;
CREATE POLICY "textil_pedido_items lectura" ON public.textil_pedido_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.textil_pedidos p
                  WHERE p.id = textil_pedido_items.pedido_id
                    AND p.empresa_id = ANY ((SELECT public.mis_empresas())::uuid[])));

DROP POLICY IF EXISTS "textil_factura_items lectura" ON public.textil_factura_items;
CREATE POLICY "textil_factura_items lectura" ON public.textil_factura_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.textil_facturas p
                  WHERE p.id = textil_factura_items.factura_id
                    AND p.empresa_id = ANY ((SELECT public.mis_empresas())::uuid[])));

DROP POLICY IF EXISTS "textil_compras lectura" ON public.textil_compras;
DROP POLICY IF EXISTS "compras lectura" ON public.textil_compras;
CREATE POLICY "compras lectura" ON public.textil_compras FOR SELECT TO authenticated
  USING (empresa_id = ANY ((SELECT public.mis_empresas())::uuid[]));

-- ---- 4. Comprobación final: una sola política de lectura, la nueva ---------
DO $$
DECLARE
  v_mal TEXT;
BEGIN
  SELECT string_agg(t.tabla || ' (' || coalesce(x.n, 0) || ' políticas SELECT/ALL)', ', ')
    INTO v_mal
    FROM unnest(ARRAY['pedidos', 'pedido_items', 'facturas', 'factura_items',
                      'pedido_devoluciones', 'enlaces_seguimiento', 'cobros',
                      'clientes', 'textil_pedidos', 'textil_pedido_items',
                      'textil_facturas', 'textil_factura_items', 'textil_compras']) AS t(tabla)
    LEFT JOIN LATERAL (
      SELECT count(*) AS n,
             bool_and(p.cmd = 'SELECT'
                      AND (p.qual LIKE '%mis_tiendas()%' OR p.qual LIKE '%mis_empresas()%')) AS nuevas
        FROM pg_policies p
       WHERE p.schemaname = 'public' AND p.tablename = t.tabla
         AND p.cmd IN ('SELECT', 'ALL')
    ) x ON true
   WHERE coalesce(x.n, 0) <> 1 OR NOT coalesce(x.nuevas, false);
  IF v_mal IS NOT NULL THEN
    RAISE EXCEPTION 'rendimiento_rls: estas tablas no han quedado con una sola política de lectura con mis_tiendas()/mis_empresas(): %', v_mal;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- POLÍTICAS ANTERIORES (para deshacer; están también en
-- supabase/reversiones/20261031100100_rendimiento_rls.sql)
-- ============================================================================
-- CREATE POLICY "pedidos lectura" ON public.pedidos FOR SELECT TO authenticated
--   USING (public.is_tienda_member(auth.uid(), tienda_id));
-- CREATE POLICY "facturas lectura miembros" ON public.facturas FOR SELECT TO authenticated
--   USING (public.is_tienda_member(auth.uid(), tienda_id));
-- CREATE POLICY "pedido_devoluciones lectura" ON public.pedido_devoluciones FOR SELECT TO authenticated
--   USING (public.is_tienda_member(auth.uid(), tienda_id));
-- CREATE POLICY "pedido_items lectura" ON public.pedido_items FOR SELECT TO authenticated
--   USING (EXISTS (SELECT 1 FROM public.pedidos p
--                   WHERE p.id = pedido_items.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)));
-- CREATE POLICY "enlaces_seguimiento lectura" ON public.enlaces_seguimiento FOR SELECT TO authenticated
--   USING (EXISTS (SELECT 1 FROM public.pedidos p
--                   WHERE p.id = enlaces_seguimiento.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)));
-- CREATE POLICY "factura_items lectura miembros" ON public.factura_items FOR SELECT TO authenticated
--   USING (EXISTS (SELECT 1 FROM public.facturas f
--                   WHERE f.id = factura_items.factura_id AND public.is_tienda_member(auth.uid(), f.tienda_id)));
-- CREATE POLICY "cobros lectura" ON public.cobros FOR SELECT TO authenticated
--   USING (public.es_miembro_empresa(auth.uid(), empresa_id));
-- CREATE POLICY "clientes lectura" ON public.clientes FOR SELECT TO authenticated
--   USING (public.es_miembro_empresa(auth.uid(), empresa_id));
-- CREATE POLICY "textil_pedidos_lectura" ON public.textil_pedidos FOR SELECT TO authenticated
--   USING (public.es_miembro_empresa(auth.uid(), empresa_id));
-- CREATE POLICY "textil_facturas_lectura" ON public.textil_facturas FOR SELECT TO authenticated
--   USING (public.es_miembro_empresa(auth.uid(), empresa_id));
-- CREATE POLICY "textil_pedido_items lectura" ON public.textil_pedido_items FOR SELECT TO authenticated
--   USING (EXISTS (SELECT 1 FROM public.textil_pedidos p
--                   WHERE p.id = textil_pedido_items.pedido_id AND public.es_miembro_empresa(auth.uid(), p.empresa_id)));
-- CREATE POLICY "textil_factura_items lectura" ON public.textil_factura_items FOR SELECT TO authenticated
--   USING (EXISTS (SELECT 1 FROM public.textil_facturas p
--                   WHERE p.id = textil_factura_items.factura_id AND public.es_miembro_empresa(auth.uid(), p.empresa_id)));
-- CREATE POLICY "compras lectura" ON public.textil_compras FOR SELECT TO authenticated
--   USING (public.es_miembro_empresa(auth.uid(), empresa_id));
