-- ============================================================================
-- ESCÁNER TEXTIL (2 de 3) · Datos: lo que ya hay pasa al catálogo
-- ============================================================================
--
-- QUÉ RESUELVE
--   Después de 20261028100000 existen productos, proveedores y la memoria del
--   escáner, pero vacíos: el stock y las compras que ya hay no apuntan a nada.
--   Esta migración los rellena desde lo que ya hay, sin inventar nada.
--
-- QUÉ HACE: define y llama a escaner_textil_migrar_datos(), en este orden:
--   A. Productos desde el stock. Un producto por (empresa, nombre normalizado)
--      de las variantes sin producto (origen 'migracion', sin marca ni
--      referencia, categoría de la variante más antigua) y cada variante a su
--      producto.
--   B. Repetidas. Entre las variantes activas de un mismo producto, color y
--      talla (normalizados), se queda buena la que tiene más movimientos
--      (empate: la más antigua); las demás se marcan repetida. No se desactiva
--      nada ni se mueve stock: se resuelven fusionándolas en Textil › Stock.
--   C. Proveedores desde las compras. Uno por NIF normalizado (con el nombre de
--      la compra más reciente que lo traiga) y, sin NIF, uno por nombre
--      normalizado. Cada compra queda enlazada a su proveedor (también las
--      registradas: de nulo a un proveedor es lo único que se les permite).
--   D. Memoria desde lo ya registrado. Para cada línea de compra textil
--      registrada con proveedor y variante, la clave de solo descripción
--      ('d:' + descripción). Si todas las líneas de una clave fueron a la
--      misma variante, se aprende (veces = cuántas); si fueron a más de una,
--      la clave es ambigua y no se aprende.
--   Devuelve y anuncia con NOTICE lo hecho en esa llamada:
--   {"productos", "variantes_enlazadas", "repetidas", "proveedores",
--    "compras_enlazadas", "memoria"}.
--
-- IDEMPOTENTE: solo toca lo que aún no está hecho. La migración de reglas
-- (20261028100200) la vuelve a llamar justo antes de poner producto_id NOT
-- NULL. Se puede aplicar dos veces.
--
-- AUDITORÍA: las variantes y compras que se actualizan dejan su fila de
-- auditoría sin autor: es una migración, no la escribe nadie desde la
-- aplicación.
--
-- REVERSIBLE
--   Sí: supabase/reversiones/20261028100100_escaner_textil_datos.sql (después
--   de la de 20261028100200). Deshace solo lo que hizo esta migración.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.escaner_textil_migrar_datos()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_productos INT := 0;
  v_enlazadas INT := 0;
  v_repetidas INT := 0;
  v_proveedores INT := 0;
  v_n INT := 0;
  v_compras INT := 0;
  v_memoria INT := 0;
BEGIN
  -- A. Productos desde el stock -------------------------------------------
  INSERT INTO public.textil_productos (empresa_id, nombre, categoria, origen)
  -- Un nombre en blanco no puede ser el de un producto: esas variantes van a
  -- «(sin nombre)», para que la persona las reconozca y las reclasifique.
  SELECT DISTINCT ON (s.empresa_id, public.textil_clave(COALESCE(NULLIF(btrim(s.nombre), ''), '(sin nombre)')))
         s.empresa_id,
         COALESCE(NULLIF(btrim(s.nombre), ''), '(sin nombre)'),
         s.categoria,
         'migracion'
    FROM public.textil_stock s
   WHERE s.producto_id IS NULL
   ORDER BY s.empresa_id, public.textil_clave(COALESCE(NULLIF(btrim(s.nombre), ''), '(sin nombre)')),
            s.created_at, s.id
  ON CONFLICT (empresa_id, marca_clave, nombre_clave) WHERE referencia_clave = '' DO NOTHING;
  GET DIAGNOSTICS v_productos = ROW_COUNT;

  UPDATE public.textil_stock s
     SET producto_id = p.id
    FROM public.textil_productos p
   WHERE s.producto_id IS NULL
     AND p.empresa_id = s.empresa_id
     AND p.marca_clave = '' AND p.referencia_clave = ''
     AND p.nombre_clave = public.textil_clave(COALESCE(NULLIF(btrim(s.nombre), ''), '(sin nombre)'));
  GET DIAGNOSTICS v_enlazadas = ROW_COUNT;

  -- B. Repetidas ------------------------------------------------------------
  WITH grupos AS (
    SELECT s.id,
           row_number() OVER (
             PARTITION BY s.producto_id, s.color_clave, s.talla_clave
             ORDER BY (SELECT count(*) FROM public.textil_stock_movimientos m
                        WHERE m.stock_id = s.id) DESC,
                      s.created_at, s.id) AS puesto
      FROM public.textil_stock s
     WHERE s.activa AND NOT s.repetida AND s.producto_id IS NOT NULL
  )
  UPDATE public.textil_stock s
     SET repetida = true
    FROM grupos g
   WHERE g.id = s.id AND g.puesto > 1;
  GET DIAGNOSTICS v_repetidas = ROW_COUNT;

  -- C. Proveedores desde las compras ----------------------------------------
  -- Con NIF: uno por (empresa, NIF normalizado), con el nombre de la compra
  -- más reciente que lo traiga (si ninguna, el NIF).
  INSERT INTO public.proveedores (empresa_id, nombre, nif, origen)
  SELECT g.empresa_id,
         COALESCE(
           (SELECT btrim(c2.proveedor) FROM public.textil_compras c2
             WHERE c2.empresa_id = g.empresa_id
               AND public.nif_clave(c2.nif_proveedor) = g.clave
               AND btrim(COALESCE(c2.proveedor, '')) <> ''
             ORDER BY c2.fecha DESC NULLS LAST, c2.created_at DESC, c2.id DESC LIMIT 1),
           g.clave),
         COALESCE(
           (SELECT btrim(c2.nif_proveedor) FROM public.textil_compras c2
             WHERE c2.empresa_id = g.empresa_id
               AND public.nif_clave(c2.nif_proveedor) = g.clave
               AND btrim(COALESCE(c2.proveedor, '')) <> ''
             ORDER BY c2.fecha DESC NULLS LAST, c2.created_at DESC, c2.id DESC LIMIT 1),
           (SELECT btrim(c2.nif_proveedor) FROM public.textil_compras c2
             WHERE c2.empresa_id = g.empresa_id
               AND public.nif_clave(c2.nif_proveedor) = g.clave
             ORDER BY c2.fecha DESC NULLS LAST, c2.created_at DESC, c2.id DESC LIMIT 1)),
         'migracion'
    FROM (SELECT DISTINCT c.empresa_id, public.nif_clave(c.nif_proveedor) AS clave
            FROM public.textil_compras c
           WHERE c.proveedor_id IS NULL AND public.nif_clave(c.nif_proveedor) <> '') g
  ON CONFLICT (empresa_id, nif_clave) WHERE nif_clave <> '' DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_proveedores := v_n;

  -- Una compra sin NIF de un proveedor que sí lo tiene en otra (la IA no lo
  -- leyó): al proveedor CON NIF de ese nombre, si es uno solo. Así no se crea
  -- otro de solo nombre y no se parten en dos su memoria y sus pagos (igual
  -- que textil_compra_guardar_y_registrar).
  UPDATE public.textil_compras c
     SET proveedor_id = p.id
    FROM public.proveedores p
   WHERE c.proveedor_id IS NULL
     AND public.nif_clave(c.nif_proveedor) = ''
     AND public.textil_clave(c.proveedor) <> ''
     AND p.empresa_id = c.empresa_id
     AND p.nif_clave <> ''
     AND p.nombre_clave = public.textil_clave(c.proveedor)
     AND (SELECT count(*) FROM public.proveedores p2
           WHERE p2.empresa_id = c.empresa_id AND p2.nif_clave <> ''
             AND p2.nombre_clave = p.nombre_clave) = 1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_compras := v_n;

  -- Sin NIF: uno por (empresa, nombre normalizado).
  INSERT INTO public.proveedores (empresa_id, nombre, origen)
  SELECT DISTINCT ON (c.empresa_id, public.textil_clave(c.proveedor))
         c.empresa_id, btrim(c.proveedor), 'migracion'
    FROM public.textil_compras c
   WHERE c.proveedor_id IS NULL
     AND public.nif_clave(c.nif_proveedor) = ''
     AND public.textil_clave(c.proveedor) <> ''
   ORDER BY c.empresa_id, public.textil_clave(c.proveedor),
            c.fecha DESC NULLS LAST, c.created_at DESC, c.id DESC
  ON CONFLICT (empresa_id, nombre_clave) WHERE nif_clave = '' DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_proveedores := v_proveedores + v_n;

  UPDATE public.textil_compras c
     SET proveedor_id = p.id
    FROM public.proveedores p
   WHERE c.proveedor_id IS NULL
     AND p.empresa_id = c.empresa_id
     AND public.nif_clave(c.nif_proveedor) <> ''
     AND p.nif_clave = public.nif_clave(c.nif_proveedor);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_compras := v_compras + v_n;

  UPDATE public.textil_compras c
     SET proveedor_id = p.id
    FROM public.proveedores p
   WHERE c.proveedor_id IS NULL
     AND p.empresa_id = c.empresa_id
     AND public.nif_clave(c.nif_proveedor) = ''
     AND public.textil_clave(c.proveedor) <> ''
     AND p.nif_clave = ''
     AND p.nombre_clave = public.textil_clave(c.proveedor);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_compras := v_compras + v_n;

  -- D. Memoria desde lo ya registrado ---------------------------------------
  -- La variante de cada línea, siguiendo la fusión si la hubo. Una clave que
  -- fue a más de una variante es ambigua (una descripción sin talla ni color,
  -- por ejemplo) y no se aprende.
  WITH lineas AS (
    SELECT c.empresa_id, c.proveedor_id, c.id AS compra_id, c.fecha, c.created_at,
           l.orden, l.unidades_por_pack,
           public.textil_clave_memoria(NULL, NULL, NULL, l.descripcion) AS clave,
           COALESCE(s.fusionada_en, s.id) AS variante
      FROM public.textil_compra_lineas l
      JOIN public.textil_compras c ON c.id = l.compra_id
      JOIN public.textil_stock s ON s.id = l.stock_id
     WHERE c.estado = 'registrada' AND c.categoria = 'textil'
       AND c.proveedor_id IS NOT NULL
  ),
  claves AS (
    SELECT empresa_id, proveedor_id, clave,
           count(*) AS veces,
           count(DISTINCT variante) AS variantes,
           min(variante::TEXT)::UUID AS variante,
           (array_agg(unidades_por_pack ORDER BY fecha DESC NULLS LAST, created_at DESC, orden DESC))[1] AS pack,
           (array_agg(compra_id ORDER BY fecha DESC NULLS LAST, created_at DESC, orden DESC))[1] AS ultima
      FROM lineas
     WHERE clave <> ''
     GROUP BY empresa_id, proveedor_id, clave
  )
  INSERT INTO public.textil_referencias_proveedor
    (empresa_id, proveedor_id, clave, stock_id, unidades_por_pack, veces, ultima_compra_id, origen)
  SELECT k.empresa_id, k.proveedor_id, k.clave, k.variante, k.pack, k.veces, k.ultima, 'migracion'
    FROM claves k
    JOIN public.textil_stock s ON s.id = k.variante
   WHERE k.variantes = 1 AND s.activa AND NOT s.repetida
  ON CONFLICT (empresa_id, proveedor_id, clave) DO NOTHING;
  GET DIAGNOSTICS v_memoria = ROW_COUNT;

  RETURN jsonb_build_object(
    'productos', v_productos,
    'variantes_enlazadas', v_enlazadas,
    'repetidas', v_repetidas,
    'proveedores', v_proveedores,
    'compras_enlazadas', v_compras,
    'memoria', v_memoria);
END;
$$;

COMMENT ON FUNCTION public.escaner_textil_migrar_datos() IS
  'Pasa al catálogo lo que ya hay: productos desde el stock, variantes repetidas, proveedores '
  'desde las compras y memoria del escáner desde lo registrado. Idempotente: devuelve lo hecho '
  'en esta llamada.';

REVOKE ALL ON FUNCTION public.escaner_textil_migrar_datos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.escaner_textil_migrar_datos() TO service_role;

DO $$
DECLARE v JSONB;
BEGIN
  v := public.escaner_textil_migrar_datos();
  RAISE NOTICE 'Escáner textil, migración de datos: %', v;
END $$;

NOTIFY pgrst, 'reload schema';
