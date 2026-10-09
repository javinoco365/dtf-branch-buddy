-- ============================================================================
-- RLS: fuera los FOR ALL que quedaban. Una política por operación, mismo acceso
-- ============================================================================
--
-- EL PROBLEMA
--   CLAUDE.md prohíbe FOR ALL en las tablas de negocio: un FOR ALL concede
--   también DELETE sin decirlo, y no se lee si borrar estaba permitido a
--   propósito o de rebote. Las migraciones de cimientos fueron quitándolos
--   (tiendas, empresas, clientes, productos, facturas...), pero después de
--   aplicar todas las del repositorio siguen quedando doce, todos para
--   authenticated:
--
--     pedidos                    «pedidos member access»                   20260615144900
--     pedido_items               «pedido_items member access»              20260615144900
--     tienda_usuarios            «tienda_usuarios admin write»             20260615144900
--     tienda_credenciales        «no direct access creds»                  20260615144900
--     tienda_seguimiento_config  «seguimiento_member_access»               20260615160422
--     enlaces_seguimiento        «Members manage seguimiento de su tienda» 20260615160957
--     pedido_devoluciones        «miembros_tienda_devoluciones»            20260615171915
--     empresa_global             «empresa_global admin write»              20260615185009
--     cliente_tiendas            «cliente_tiendas por pertenencia»         20260902120400
--     textil_presupuesto_items   «textil_presupuesto_items_por_documento»  20260902120200
--     textil_pedido_items        «textil_pedido_items_por_documento»       20260902120200
--     textil_factura_items       «textil_factura_items_por_documento»      20260902120200
--
--   Ninguna migración posterior los había cambiado: es la lista que da
--   pg_policies (cmd = 'ALL') tras aplicar hasta 20261022100000.
--
-- QUÉ HACE
--   Cambia cada FOR ALL por políticas FOR SELECT, FOR INSERT, FOR UPDATE y
--   FOR DELETE con EXACTAMENTE la misma condición que tenía: el USING del
--   FOR ALL pasa a la lectura, a la edición y al borrado, y su WITH CHECK al
--   alta y a la edición. Es lo mismo que hace Postgres por dentro con un
--   FOR ALL, solo que escrito. Nadie gana ni pierde acceso.
--
--   Dos excepciones, que tampoco cambian lo que se puede hacer hoy:
--
--   - textil_factura_items: solo lectura. 20260902130100 quitó a authenticated
--     INSERT, UPDATE y DELETE sobre esta tabla (las líneas de una factura las
--     escribe emitir_factura_textil(), con el rol de servicio), así que del
--     FOR ALL solo funcionaba la lectura. Es lo mismo que se hizo con
--     factura_items en 20260902130000: «La RLS FOR ALL se sustituye por
--     lectura, y nada más». Si en la base alguien hubiera vuelto a dar esos
--     permisos, la migración lo avisa con un NOTICE: desde aquí la RLS
--     tampoco deja escribir líneas de factura desde el navegador.
--
--   - tienda_credenciales: se queda sin políticas. La que tenía era
--     USING (false) WITH CHECK (false), y una política permisiva que dice
--     «false» no quita nada: lo que impide leer y escribir es que la tabla
--     tiene la RLS activada y ninguna política da acceso. Es el mismo patrón
--     que smtp_config (20260904100000). authenticated sigue sin ver ni tocar
--     una sola fila; supabaseAdmin, que es quien la usa, se salta la RLS.
--
--   Las políticas nuevas se crean ANTES de quitar las viejas, tabla a tabla,
--   para que en ningún momento una tabla se quede sin acceso aunque esto se
--   ejecute sentencia a sentencia.
--
--   Al final avisa con un WARNING si queda en public algún FOR ALL que esta
--   migración no conoce (uno creado a mano en producción con otro nombre). No
--   lo borra: no se quita algo que no se sabe de dónde sale.
--
--   No toca ninguna fila. Se puede aplicar dos veces.
--
-- QUÉ NO CAMBIA EN LA APLICACIÓN
--   Lo que hace la app sobre estas tablas (buscado en src/):
--     - pedidos, pedido_items, pedido_devoluciones, enlaces_seguimiento: lee
--       con el cliente del usuario (listados, Gerencia, periodo, exportación)
--       y escribe con supabaseAdmin, que se salta la RLS.
--     - textil_presupuesto_items y textil_pedido_items: borra e inserta las
--       líneas con context.supabase al guardar (textil.functions.ts). Siguen
--       teniendo alta y borrado con la misma condición.
--     - textil_factura_items: solo lee, y con supabaseAdmin.
--     - tienda_usuarios: lee con el cliente del usuario e inserta con
--       supabaseAdmin al crear usuarios.
--     - tienda_credenciales: solo supabaseAdmin.
--     - cliente_tiendas, tienda_seguimiento_config, empresa_global: la app no
--       las usa hoy (empresa_global está obsoleta desde 20260903100000).
--
-- REVERSIBLE
--   Sí. Volver a crear cada FOR ALL con su nombre y su condición originales
--   (están en las migraciones citadas arriba) y quitar las políticas nuevas
--   de esta migración lo deja como estaba. No hay datos que recuperar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. pedidos: por pertenencia a la tienda
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "pedidos lectura" ON public.pedidos;
CREATE POLICY "pedidos lectura" ON public.pedidos
  FOR SELECT TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "pedidos alta" ON public.pedidos;
CREATE POLICY "pedidos alta" ON public.pedidos
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "pedidos edicion" ON public.pedidos;
CREATE POLICY "pedidos edicion" ON public.pedidos
  FOR UPDATE TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id))
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "pedidos baja" ON public.pedidos;
CREATE POLICY "pedidos baja" ON public.pedidos
  FOR DELETE TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "pedidos member access" ON public.pedidos;

-- ---------------------------------------------------------------------------
-- 2. pedido_items: por la tienda de su pedido
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "pedido_items lectura" ON public.pedido_items;
CREATE POLICY "pedido_items lectura" ON public.pedido_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = pedido_items.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)));

DROP POLICY IF EXISTS "pedido_items alta" ON public.pedido_items;
CREATE POLICY "pedido_items alta" ON public.pedido_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = pedido_items.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)));

DROP POLICY IF EXISTS "pedido_items edicion" ON public.pedido_items;
CREATE POLICY "pedido_items edicion" ON public.pedido_items
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = pedido_items.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = pedido_items.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)));

DROP POLICY IF EXISTS "pedido_items baja" ON public.pedido_items;
CREATE POLICY "pedido_items baja" ON public.pedido_items
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = pedido_items.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)));

DROP POLICY IF EXISTS "pedido_items member access" ON public.pedido_items;

-- ---------------------------------------------------------------------------
-- 3. pedido_devoluciones: por pertenencia a la tienda
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "pedido_devoluciones lectura" ON public.pedido_devoluciones;
CREATE POLICY "pedido_devoluciones lectura" ON public.pedido_devoluciones
  FOR SELECT TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "pedido_devoluciones alta" ON public.pedido_devoluciones;
CREATE POLICY "pedido_devoluciones alta" ON public.pedido_devoluciones
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "pedido_devoluciones edicion" ON public.pedido_devoluciones;
CREATE POLICY "pedido_devoluciones edicion" ON public.pedido_devoluciones
  FOR UPDATE TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id))
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "pedido_devoluciones baja" ON public.pedido_devoluciones;
CREATE POLICY "pedido_devoluciones baja" ON public.pedido_devoluciones
  FOR DELETE TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "miembros_tienda_devoluciones" ON public.pedido_devoluciones;

-- ---------------------------------------------------------------------------
-- 4. enlaces_seguimiento: por la tienda de su pedido
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "enlaces_seguimiento lectura" ON public.enlaces_seguimiento;
CREATE POLICY "enlaces_seguimiento lectura" ON public.enlaces_seguimiento
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = enlaces_seguimiento.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)));

DROP POLICY IF EXISTS "enlaces_seguimiento alta" ON public.enlaces_seguimiento;
CREATE POLICY "enlaces_seguimiento alta" ON public.enlaces_seguimiento
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = enlaces_seguimiento.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)));

DROP POLICY IF EXISTS "enlaces_seguimiento edicion" ON public.enlaces_seguimiento;
CREATE POLICY "enlaces_seguimiento edicion" ON public.enlaces_seguimiento
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = enlaces_seguimiento.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = enlaces_seguimiento.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)));

DROP POLICY IF EXISTS "enlaces_seguimiento baja" ON public.enlaces_seguimiento;
CREATE POLICY "enlaces_seguimiento baja" ON public.enlaces_seguimiento
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = enlaces_seguimiento.pedido_id AND public.is_tienda_member(auth.uid(), p.tienda_id)));

DROP POLICY IF EXISTS "Members manage seguimiento de su tienda" ON public.enlaces_seguimiento;

-- ---------------------------------------------------------------------------
-- 5. tienda_seguimiento_config: por pertenencia a la tienda
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "tienda_seguimiento_config lectura" ON public.tienda_seguimiento_config;
CREATE POLICY "tienda_seguimiento_config lectura" ON public.tienda_seguimiento_config
  FOR SELECT TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "tienda_seguimiento_config alta" ON public.tienda_seguimiento_config;
CREATE POLICY "tienda_seguimiento_config alta" ON public.tienda_seguimiento_config
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "tienda_seguimiento_config edicion" ON public.tienda_seguimiento_config;
CREATE POLICY "tienda_seguimiento_config edicion" ON public.tienda_seguimiento_config
  FOR UPDATE TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id))
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "tienda_seguimiento_config baja" ON public.tienda_seguimiento_config;
CREATE POLICY "tienda_seguimiento_config baja" ON public.tienda_seguimiento_config
  FOR DELETE TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "seguimiento_member_access" ON public.tienda_seguimiento_config;

-- ---------------------------------------------------------------------------
-- 6. cliente_tiendas: por pertenencia a la tienda
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "cliente_tiendas lectura" ON public.cliente_tiendas;
CREATE POLICY "cliente_tiendas lectura" ON public.cliente_tiendas
  FOR SELECT TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "cliente_tiendas alta" ON public.cliente_tiendas;
CREATE POLICY "cliente_tiendas alta" ON public.cliente_tiendas
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "cliente_tiendas edicion" ON public.cliente_tiendas;
CREATE POLICY "cliente_tiendas edicion" ON public.cliente_tiendas
  FOR UPDATE TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id))
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "cliente_tiendas baja" ON public.cliente_tiendas;
CREATE POLICY "cliente_tiendas baja" ON public.cliente_tiendas
  FOR DELETE TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id));

DROP POLICY IF EXISTS "cliente_tiendas por pertenencia" ON public.cliente_tiendas;

-- ---------------------------------------------------------------------------
-- 7. Líneas de presupuesto y de pedido textil: por la empresa del documento
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "textil_presupuesto_items lectura" ON public.textil_presupuesto_items;
CREATE POLICY "textil_presupuesto_items lectura" ON public.textil_presupuesto_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.textil_presupuestos p WHERE p.id = textil_presupuesto_items.presupuesto_id AND public.es_miembro_empresa(auth.uid(), p.empresa_id)));

DROP POLICY IF EXISTS "textil_presupuesto_items alta" ON public.textil_presupuesto_items;
CREATE POLICY "textil_presupuesto_items alta" ON public.textil_presupuesto_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.textil_presupuestos p WHERE p.id = textil_presupuesto_items.presupuesto_id AND public.es_miembro_empresa(auth.uid(), p.empresa_id)));

DROP POLICY IF EXISTS "textil_presupuesto_items edicion" ON public.textil_presupuesto_items;
CREATE POLICY "textil_presupuesto_items edicion" ON public.textil_presupuesto_items
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.textil_presupuestos p WHERE p.id = textil_presupuesto_items.presupuesto_id AND public.es_miembro_empresa(auth.uid(), p.empresa_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.textil_presupuestos p WHERE p.id = textil_presupuesto_items.presupuesto_id AND public.es_miembro_empresa(auth.uid(), p.empresa_id)));

DROP POLICY IF EXISTS "textil_presupuesto_items baja" ON public.textil_presupuesto_items;
CREATE POLICY "textil_presupuesto_items baja" ON public.textil_presupuesto_items
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.textil_presupuestos p WHERE p.id = textil_presupuesto_items.presupuesto_id AND public.es_miembro_empresa(auth.uid(), p.empresa_id)));

DROP POLICY IF EXISTS "textil_presupuesto_items_por_documento" ON public.textil_presupuesto_items;

DROP POLICY IF EXISTS "textil_pedido_items lectura" ON public.textil_pedido_items;
CREATE POLICY "textil_pedido_items lectura" ON public.textil_pedido_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.textil_pedidos p WHERE p.id = textil_pedido_items.pedido_id AND public.es_miembro_empresa(auth.uid(), p.empresa_id)));

DROP POLICY IF EXISTS "textil_pedido_items alta" ON public.textil_pedido_items;
CREATE POLICY "textil_pedido_items alta" ON public.textil_pedido_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.textil_pedidos p WHERE p.id = textil_pedido_items.pedido_id AND public.es_miembro_empresa(auth.uid(), p.empresa_id)));

DROP POLICY IF EXISTS "textil_pedido_items edicion" ON public.textil_pedido_items;
CREATE POLICY "textil_pedido_items edicion" ON public.textil_pedido_items
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.textil_pedidos p WHERE p.id = textil_pedido_items.pedido_id AND public.es_miembro_empresa(auth.uid(), p.empresa_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.textil_pedidos p WHERE p.id = textil_pedido_items.pedido_id AND public.es_miembro_empresa(auth.uid(), p.empresa_id)));

DROP POLICY IF EXISTS "textil_pedido_items baja" ON public.textil_pedido_items;
CREATE POLICY "textil_pedido_items baja" ON public.textil_pedido_items
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.textil_pedidos p WHERE p.id = textil_pedido_items.pedido_id AND public.es_miembro_empresa(auth.uid(), p.empresa_id)));

DROP POLICY IF EXISTS "textil_pedido_items_por_documento" ON public.textil_pedido_items;

-- ---------------------------------------------------------------------------
-- 8. Líneas de factura textil: solo lectura
-- ---------------------------------------------------------------------------
-- Ver «QUÉ HACE»: authenticated no tiene INSERT, UPDATE ni DELETE sobre esta
-- tabla desde 20260902130100, así que lo único que daba el FOR ALL era leer.
DROP POLICY IF EXISTS "textil_factura_items lectura" ON public.textil_factura_items;
CREATE POLICY "textil_factura_items lectura" ON public.textil_factura_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.textil_facturas p WHERE p.id = textil_factura_items.factura_id AND public.es_miembro_empresa(auth.uid(), p.empresa_id)));

DROP POLICY IF EXISTS "textil_factura_items_por_documento" ON public.textil_factura_items;

DO $$
DECLARE v_permisos TEXT;
BEGIN
  SELECT string_agg(p, ', ') INTO v_permisos
    FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) AS p
   WHERE has_table_privilege('authenticated', 'public.textil_factura_items', p);

  IF v_permisos IS NOT NULL THEN
    RAISE NOTICE 'authenticated tiene % sobre textil_factura_items, que 20260902130100 había quitado. '
      'Desde esta migración la RLS tampoco deja escribir líneas de factura textil desde el navegador '
      '(solo emitir_factura_textil(), con el rol de servicio). Revisa quién devolvió esos permisos.',
      v_permisos;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 9. tienda_usuarios: escribir es cosa de administradores
-- ---------------------------------------------------------------------------
-- «tienda_usuarios select» (cada uno ve sus filas, el administrador todas) se
-- queda como está. La lectura de abajo es la parte de lectura del FOR ALL:
-- ya la cubre esa otra política, pero se escribe igual para que el acceso sea
-- exactamente el de antes aunque algún día cambie la otra.
DROP POLICY IF EXISTS "tienda_usuarios lectura admin" ON public.tienda_usuarios;
CREATE POLICY "tienda_usuarios lectura admin" ON public.tienda_usuarios
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "tienda_usuarios alta admin" ON public.tienda_usuarios;
CREATE POLICY "tienda_usuarios alta admin" ON public.tienda_usuarios
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "tienda_usuarios edicion admin" ON public.tienda_usuarios;
CREATE POLICY "tienda_usuarios edicion admin" ON public.tienda_usuarios
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "tienda_usuarios baja admin" ON public.tienda_usuarios;
CREATE POLICY "tienda_usuarios baja admin" ON public.tienda_usuarios
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "tienda_usuarios admin write" ON public.tienda_usuarios;

-- ---------------------------------------------------------------------------
-- 10. empresa_global (obsoleta): escribir es cosa de administradores
-- ---------------------------------------------------------------------------
-- Igual que tienda_usuarios: «empresa_global select miembros» se queda, y la
-- lectura de administrador se escribe aparte con la condición del FOR ALL.
DROP POLICY IF EXISTS "empresa_global lectura admin" ON public.empresa_global;
CREATE POLICY "empresa_global lectura admin" ON public.empresa_global
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "empresa_global alta admin" ON public.empresa_global;
CREATE POLICY "empresa_global alta admin" ON public.empresa_global
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "empresa_global edicion admin" ON public.empresa_global;
CREATE POLICY "empresa_global edicion admin" ON public.empresa_global
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "empresa_global baja admin" ON public.empresa_global;
CREATE POLICY "empresa_global baja admin" ON public.empresa_global
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "empresa_global admin write" ON public.empresa_global;

-- ---------------------------------------------------------------------------
-- 11. tienda_credenciales: sin políticas, como smtp_config
-- ---------------------------------------------------------------------------
-- USING (false) en una política permisiva no restringe nada. La tabla sigue
-- con la RLS activada y sin ninguna política que dé acceso: authenticated no
-- ve ni escribe ninguna fila, igual que antes.
ALTER TABLE public.tienda_credenciales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no direct access creds" ON public.tienda_credenciales;

-- ---------------------------------------------------------------------------
-- 12. ¿Queda algún FOR ALL?
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_restantes TEXT;
BEGIN
  SELECT string_agg(format('%s («%s»)', tablename, policyname), ', ' ORDER BY tablename, policyname)
    INTO v_restantes
    FROM pg_policies
   WHERE schemaname = 'public' AND cmd = 'ALL';

  IF v_restantes IS NOT NULL THEN
    RAISE WARNING 'Quedan políticas FOR ALL en public que esta migración no conoce: %. '
      'No se han tocado: revísalas a mano y sustitúyelas por políticas por operación.',
      v_restantes;
  END IF;
END $$;
