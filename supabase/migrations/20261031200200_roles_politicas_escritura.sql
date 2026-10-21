-- ============================================================================
-- Niveles de usuario (3 de 4): las políticas de ESCRITURA exigen el nivel
-- ============================================================================
--
-- QUÉ HACE
--   A cada política INSERT / UPDATE / DELETE de las tablas de negocio le añade
--   el nivel que hace falta, sin tocar la condición que ya tenía (pertenencia a
--   la tienda o a la empresa, documento no conciliado, ...):
--
--     INSERT y UPDATE   ... AND (SELECT public.rol_puede_escribir(auth.uid()))
--     DELETE            ... AND (SELECT public.rol_puede_borrar(auth.uid()))
--
--   salvo el DELETE de las líneas que se reescriben al editar su documento
--   (pedido_items, presupuesto_items, textil_presupuesto_items,
--   textil_pedido_items, textil_compra_lineas, textil_stock_reservas,
--   cliente_tiendas, enlaces_seguimiento), que exige escribir: un editor
--   modifica un presupuesto y eso reescribe sus líneas.
--
--   El (SELECT ...) hace que Postgres evalúe la función una vez por sentencia
--   (InitPlan), no una vez por fila.
--
-- QUÉ NO TOCA
--   - Las políticas de SELECT. Lectura igual que antes.
--   - Las que ya exigen has_role(auth.uid(), 'admin'): tiendas,
--     tienda_usuarios, empresas, empresa_global, tienda_plantillas_correo,
--     plantillas_presupuesto y los buckets de logos, compras, presupuestos y
--     facturas/textil. Un editor y un visor ya no podían.
--   - profiles (cada uno su perfil).
--
-- CÓMO
--   No reescribe las condiciones a mano: lee la de cada política en
--   pg_policies en el momento de aplicarse y le añade la del nivel. Así no
--   pisa lo que haya cambiado otra migración anterior (por ejemplo, la que
--   optimiza la pertenencia a tiendas). Si una política de la lista no
--   existe, avisa y sigue; si ya lleva la condición, no la añade dos veces.
--
--   Al final comprueba que NINGUNA política INSERT, UPDATE, DELETE o ALL de
--   public y storage se ha quedado sin nivel (rol_puede_* o has_role admin),
--   salvo profiles (cada uno su perfil). Si queda alguna (por ejemplo, una
--   creada a mano o desde Lovable con otro nombre), se para con un error y no
--   cambia nada: un aviso en el SQL Editor no se ve, y esa política dejaría
--   escribir a un visor desde el navegador. La guardia no lo frena: con la RLS
--   activa deja decidir a las políticas.
--
-- REVERSIBLE: sí, con supabase/reversiones/20261031200200_roles_politicas_escritura.sql,
-- que quita exactamente lo añadido.
-- ============================================================================

DO $$
DECLARE
  r RECORD;
  v_using TEXT;
  v_check TEXT;
  v_cond TEXT;
  v_sql TEXT;
  v_search_path TEXT := current_setting('search_path');
BEGIN
  -- Nombres calificados en las condiciones que se leen y se vuelven a escribir.
  PERFORM set_config('search_path', '', true);

  FOR r IN
    SELECT * FROM (VALUES
      ('public', 'banco_cuentas', 'cuentas baja', 'borrar'),
      ('public', 'banco_cuentas', 'cuentas alta', 'escribir'),
      ('public', 'banco_cuentas', 'cuentas edicion', 'escribir'),
      ('public', 'banco_extractos', 'extractos alta', 'escribir'),
      ('public', 'banco_movimientos', 'banco baja', 'borrar'),
      ('public', 'banco_movimientos', 'banco alta', 'escribir'),
      ('public', 'caja_conceptos', 'caja conceptos alta', 'escribir'),
      ('public', 'caja_conceptos', 'caja conceptos edicion', 'escribir'),
      ('public', 'caja_movimientos', 'caja baja', 'borrar'),
      ('public', 'caja_movimientos', 'caja alta', 'escribir'),
      ('public', 'caja_movimientos', 'caja edicion', 'escribir'),
      ('public', 'caja_socios', 'caja socios alta', 'escribir'),
      ('public', 'caja_socios', 'caja socios edicion', 'escribir'),
      ('public', 'cliente_tiendas', 'cliente_tiendas baja', 'escribir'),
      ('public', 'cliente_tiendas', 'cliente_tiendas alta', 'escribir'),
      ('public', 'cliente_tiendas', 'cliente_tiendas edicion', 'escribir'),
      ('public', 'clientes', 'clientes baja', 'borrar'),
      ('public', 'clientes', 'clientes alta', 'escribir'),
      ('public', 'clientes', 'clientes edicion', 'escribir'),
      ('public', 'enlaces_seguimiento', 'enlaces_seguimiento baja', 'escribir'),
      ('public', 'enlaces_seguimiento', 'enlaces_seguimiento alta', 'escribir'),
      ('public', 'enlaces_seguimiento', 'enlaces_seguimiento edicion', 'escribir'),
      ('public', 'gerencia_ajustes', 'gerencia ajustes alta', 'escribir'),
      ('public', 'gerencia_ajustes', 'gerencia ajustes edicion', 'escribir'),
      ('public', 'gerencia_gastos_fijos', 'gerencia gastos baja', 'borrar'),
      ('public', 'gerencia_gastos_fijos', 'gerencia gastos alta', 'escribir'),
      ('public', 'gerencia_gastos_fijos', 'gerencia gastos edicion', 'escribir'),
      ('public', 'gerencia_objetivos', 'gerencia objetivos baja', 'borrar'),
      ('public', 'gerencia_objetivos', 'gerencia objetivos alta', 'escribir'),
      ('public', 'gerencia_objetivos', 'gerencia objetivos edicion', 'escribir'),
      ('public', 'inversion_movimientos', 'inversion baja', 'borrar'),
      ('public', 'inversion_movimientos', 'inversion alta', 'escribir'),
      ('public', 'inversion_movimientos', 'inversion edicion', 'escribir'),
      ('public', 'pedido_devoluciones', 'pedido_devoluciones baja', 'borrar'),
      ('public', 'pedido_devoluciones', 'pedido_devoluciones alta', 'escribir'),
      ('public', 'pedido_devoluciones', 'pedido_devoluciones edicion', 'escribir'),
      ('public', 'pedido_items', 'pedido_items baja', 'escribir'),
      ('public', 'pedido_items', 'pedido_items alta', 'escribir'),
      ('public', 'pedido_items', 'pedido_items edicion', 'escribir'),
      ('public', 'pedidos', 'pedidos baja', 'borrar'),
      ('public', 'pedidos', 'pedidos alta', 'escribir'),
      ('public', 'pedidos', 'pedidos edicion', 'escribir'),
      ('public', 'presupuesto_imagenes', 'presupuesto_imagenes baja', 'borrar'),
      ('public', 'presupuesto_imagenes', 'presupuesto_imagenes alta', 'escribir'),
      ('public', 'presupuesto_imagenes', 'presupuesto_imagenes edicion', 'escribir'),
      ('public', 'presupuesto_items', 'presupuesto_items baja', 'escribir'),
      ('public', 'presupuesto_items', 'presupuesto_items alta', 'escribir'),
      ('public', 'presupuesto_items', 'presupuesto_items edicion', 'escribir'),
      ('public', 'presupuestos', 'presupuestos baja', 'borrar'),
      ('public', 'presupuestos', 'presupuestos alta', 'escribir'),
      ('public', 'presupuestos', 'presupuestos edicion', 'escribir'),
      ('public', 'productos', 'productos baja', 'borrar'),
      ('public', 'productos', 'productos alta', 'escribir'),
      ('public', 'productos', 'productos edicion', 'escribir'),
      ('public', 'proveedores', 'proveedores baja', 'borrar'),
      ('public', 'proveedores', 'proveedores alta', 'escribir'),
      ('public', 'proveedores', 'proveedores edicion', 'escribir'),
      ('public', 'textil_clientes', 'textil_clientes_borrado', 'borrar'),
      ('public', 'textil_clientes', 'textil_clientes_alta', 'escribir'),
      ('public', 'textil_clientes', 'textil_clientes_modificacion', 'escribir'),
      ('public', 'textil_compra_lineas', 'compra lineas baja', 'escribir'),
      ('public', 'textil_compra_lineas', 'compra lineas alta', 'escribir'),
      ('public', 'textil_compra_lineas', 'compra lineas edicion', 'escribir'),
      ('public', 'textil_compras', 'compras baja', 'borrar'),
      ('public', 'textil_compras', 'compras alta', 'escribir'),
      ('public', 'textil_compras', 'compras edicion', 'escribir'),
      ('public', 'textil_marcas', 'textil_marcas_borrado', 'borrar'),
      ('public', 'textil_marcas', 'textil_marcas_alta', 'escribir'),
      ('public', 'textil_marcas', 'textil_marcas_modificacion', 'escribir'),
      ('public', 'textil_pedido_items', 'textil_pedido_items baja', 'escribir'),
      ('public', 'textil_pedido_items', 'textil_pedido_items alta', 'escribir'),
      ('public', 'textil_pedido_items', 'textil_pedido_items edicion', 'escribir'),
      ('public', 'textil_pedidos', 'textil_pedidos_borrado', 'borrar'),
      ('public', 'textil_pedidos', 'textil_pedidos_alta', 'escribir'),
      ('public', 'textil_pedidos', 'textil_pedidos_modificacion', 'escribir'),
      ('public', 'textil_presupuesto_items', 'textil_presupuesto_items baja', 'escribir'),
      ('public', 'textil_presupuesto_items', 'textil_presupuesto_items alta', 'escribir'),
      ('public', 'textil_presupuesto_items', 'textil_presupuesto_items edicion', 'escribir'),
      ('public', 'textil_presupuestos', 'textil_presupuestos_borrado', 'borrar'),
      ('public', 'textil_presupuestos', 'textil_presupuestos_alta', 'escribir'),
      ('public', 'textil_presupuestos', 'textil_presupuestos_modificacion', 'escribir'),
      ('public', 'textil_productos', 'textil_productos baja', 'borrar'),
      ('public', 'textil_productos', 'textil_productos alta', 'escribir'),
      ('public', 'textil_productos', 'textil_productos edicion', 'escribir'),
      ('public', 'textil_referencias_proveedor', 'textil_referencias_proveedor baja', 'borrar'),
      ('public', 'textil_referencias_proveedor', 'textil_referencias_proveedor alta', 'escribir'),
      ('public', 'textil_referencias_proveedor', 'textil_referencias_proveedor edicion', 'escribir'),
      ('public', 'textil_stock', 'textil_stock_borrado', 'borrar'),
      ('public', 'textil_stock', 'textil_stock_alta', 'escribir'),
      ('public', 'textil_stock', 'textil_stock_modificacion', 'escribir'),
      ('public', 'textil_stock_movimientos', 'movimientos alta autenticados', 'escribir'),
      ('public', 'textil_stock_reservas', 'reservas baja', 'escribir'),
      ('public', 'textil_stock_reservas', 'reservas alta', 'escribir'),
      ('public', 'textil_stock_reservas', 'reservas edicion', 'escribir'),
      ('public', 'tienda_seguimiento_config', 'tienda_seguimiento_config baja', 'borrar'),
      ('public', 'tienda_seguimiento_config', 'tienda_seguimiento_config alta', 'escribir'),
      ('public', 'tienda_seguimiento_config', 'tienda_seguimiento_config edicion', 'escribir'),
      ('storage', 'objects', 'facturas_delete_miembros', 'borrar'),
      ('storage', 'objects', 'facturas_insert_miembros', 'escribir'),
      ('storage', 'objects', 'facturas_update_miembros', 'escribir')

    ) AS t(esquema, tabla, politica, accion)
  LOOP
    SELECT p.qual, p.with_check INTO v_using, v_check
      FROM pg_catalog.pg_policies p
     WHERE p.schemaname = r.esquema AND p.tablename = r.tabla AND p.policyname = r.politica;
    IF NOT FOUND THEN
      RAISE NOTICE 'Política «%» de %.% no existe: se salta', r.politica, r.esquema, r.tabla;
      CONTINUE;
    END IF;
    IF coalesce(v_using, '') || coalesce(v_check, '') LIKE '%rol_puede_%' THEN
      CONTINUE;
    END IF;

    v_cond := CASE r.accion
      WHEN 'borrar' THEN '(SELECT public.rol_puede_borrar(auth.uid()))'
      ELSE '(SELECT public.rol_puede_escribir(auth.uid()))'
    END;

    v_sql := format('ALTER POLICY %I ON %I.%I', r.politica, r.esquema, r.tabla);
    IF v_using IS NOT NULL THEN
      v_sql := v_sql || format(' USING ((%s) AND %s)', v_using, v_cond);
    END IF;
    IF v_check IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK ((%s) AND %s)', v_check, v_cond);
    END IF;
    EXECUTE v_sql;
  END LOOP;

  PERFORM set_config('search_path', v_search_path, true);
END $$;

-- Ninguna política de escritura se queda sin nivel (hallazgo SEG-REV-4).
DO $$
DECLARE
  v_sin_nivel TEXT;
BEGIN
  SELECT string_agg(format('%s.%s «%s» (%s)', schemaname, tablename, policyname, cmd), ', ')
    INTO v_sin_nivel
    FROM pg_catalog.pg_policies
   WHERE schemaname IN ('public', 'storage')
     AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     AND NOT (schemaname = 'public' AND tablename = 'profiles')
     AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%rol_puede_%'
     AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%has_role(auth.uid(), ''admin''%'
     AND NOT (coalesce(qual, 'false') = 'false' AND coalesce(with_check, 'false') = 'false');
  IF v_sin_nivel IS NOT NULL THEN
    RAISE EXCEPTION 'roles_politicas_escritura: estas políticas de escritura no exigen nivel: %. No se ha cambiado nada; añadirlas a la lista de esta migración (o quitarlas) antes de aplicarla.', v_sin_nivel;
  END IF;
END $$;
