-- ============================================================================
-- Unir productos textiles que son el mismo modelo
-- ============================================================================
-- PROBLEMA
--   Hay proveedores que meten la talla y el color en la referencia (Roly:
--   SS643203011 es la Antartida en L y blanco perla; SS643201011, la misma en
--   S). Al registrar sus compras, el escáner hacía un producto por marca y
--   referencia, así que cada talla de esas prendas es hoy un producto distinto
--   con la misma marca y el mismo nombre: la Antartida son seis productos de
--   una variante cada uno. El catálogo no sabe que son la misma prenda: la
--   rejilla color × talla de «Elegir del stock» sale de una casilla y la
--   columna SKU, vacía.
--
-- QUÉ HACE
--   textil_productos_unir(_usuario_id, _destino, _origenes[]): deja en el
--   producto de destino (el modelo) todas las variantes de los de origen.
--   - Solo une productos de la misma empresa, la misma marca y el mismo nombre.
--   - Si dos variantes activas tienen el mismo color y la misma talla no une
--     nada (un producto no puede tener dos variantes iguales: índice
--     textil_stock_variante_unica) y dice cuáles son, para fusionarlas antes.
--   - La referencia de cada producto de origen pasa al SKU de sus variantes,
--     si no tienen ya uno: era la referencia de esa talla.
--   - Si el destino tiene referencia, pasa igual al SKU de sus variantes y el
--     destino se queda sin referencia, por lo mismo.
--   - Los productos de origen se quedan sin variantes y se desactivan. NO SE
--     BORRA NADA: las variantes conservan su id, sus existencias, su historial
--     de movimientos, sus reservas y la memoria del escáner.
--   - Exige nivel de escritura (rol_exigir_quien) y deja el autor en la
--     auditoría (app.usuario_id).
--   Solo la llama el servidor (service_role), como el resto de funciones que
--   reciben _usuario_id.
--
-- NO TOCA NINGUNA FILA AL APLICARSE. La unión la hace quien la pulsa en
-- Textil › Stock, después de ver qué prendas se unen. Se puede aplicar dos
-- veces sin cambiar nada.
--
-- REVERSIBLE
--   Sí: supabase/reversiones/20261101100000_textil_productos_unir.sql borra la
--   función. Las uniones que ya se hayan hecho no se deshacen solas: cada
--   variante guarda en su SKU la referencia de su producto de antes, y los
--   productos de antes siguen en la tabla, desactivados, con su referencia.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.textil_productos_unir(
  _usuario_id UUID,
  _destino UUID,
  _origenes UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_destino public.textil_productos%ROWTYPE;
  v_origen public.textil_productos%ROWTYPE;
  v_origenes UUID[];
  v_choque TEXT;
  v_otro TEXT;
  v_n INT;
  v_variantes INT := 0;
  v_productos INT := 0;
BEGIN
  -- Nivel: escribir. Unir no borra: las variantes siguen con toda su historia.
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  IF _usuario_id IS NULL THEN
    RAISE EXCEPTION 'Sin usuario: la unión necesita un autor.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.usuario_id', _usuario_id::TEXT, true);

  v_origenes := ARRAY(SELECT DISTINCT o FROM unnest(_origenes) AS o WHERE o IS NOT NULL);
  IF _destino IS NULL OR cardinality(v_origenes) = 0 THEN
    RAISE EXCEPTION 'Falta qué productos unir.' USING ERRCODE = '22023';
  END IF;
  IF _destino = ANY(v_origenes) THEN
    RAISE EXCEPTION 'Un producto no se une consigo mismo.' USING ERRCODE = '22023';
  END IF;

  -- Bloqueo en orden de id: dos uniones cruzadas no se bloquean entre sí.
  PERFORM 1 FROM public.textil_productos
   WHERE id = _destino OR id = ANY(v_origenes)
   ORDER BY id FOR UPDATE;

  SELECT * INTO v_destino FROM public.textil_productos WHERE id = _destino;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto no existe.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.es_miembro_empresa(_usuario_id, v_destino.empresa_id) THEN
    RAISE EXCEPTION 'Sin acceso a esta empresa.' USING ERRCODE = '42501';
  END IF;
  IF NOT v_destino.activo THEN
    RAISE EXCEPTION 'El producto que se queda tiene que estar activo.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT count(*) INTO v_n FROM public.textil_productos WHERE id = ANY(v_origenes);
  IF v_n <> cardinality(v_origenes) THEN
    RAISE EXCEPTION 'Algún producto que se iba a unir no existe.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.textil_productos
              WHERE id = ANY(v_origenes) AND empresa_id <> v_destino.empresa_id) THEN
    RAISE EXCEPTION 'Los productos tienen que ser de la misma empresa.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.textil_productos
              WHERE id = ANY(v_origenes)
                AND (marca_clave <> v_destino.marca_clave
                     OR nombre_clave <> v_destino.nombre_clave)) THEN
    RAISE EXCEPTION 'Solo se unen productos con la misma marca y el mismo nombre.'
      USING ERRCODE = '22023';
  END IF;

  -- El destino se va a quedar sin referencia: no puede haber otro producto sin
  -- referencia con la misma marca y nombre (índice textil_productos_nombre_unico)
  -- que no sea él. Si es uno de los de origen, ese tiene que ser el destino.
  IF v_destino.referencia_clave <> '' THEN
    SELECT nombre INTO v_otro FROM public.textil_productos
     WHERE empresa_id = v_destino.empresa_id
       AND marca_clave = v_destino.marca_clave
       AND nombre_clave = v_destino.nombre_clave
       AND referencia_clave = ''
       AND id <> _destino
     LIMIT 1;
    IF v_otro IS NOT NULL THEN
      RAISE EXCEPTION 'Ya hay un producto % sin referencia: tiene que ser el que se queda.', v_otro
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Dos variantes activas con el mismo color y talla no caben en un producto.
  SELECT string_agg(etiqueta, ', ' ORDER BY etiqueta) INTO v_choque
    FROM (SELECT COALESCE(NULLIF(concat_ws(' · ', NULLIF(btrim(min(color)), ''),
                                           NULLIF(btrim(min(talla)), '')), ''),
                          'sin color ni talla') AS etiqueta
            FROM public.textil_stock
           WHERE (producto_id = _destino OR producto_id = ANY(v_origenes))
             AND activa AND NOT repetida
           GROUP BY color_clave, talla_clave
          HAVING count(*) > 1) x;
  IF v_choque IS NOT NULL THEN
    RAISE EXCEPTION 'No se unen: % está en más de un producto. Fusiona antes esas variantes en Stock.', v_choque
      USING ERRCODE = 'unique_violation';
  END IF;

  -- La referencia del destino era la de una talla: al SKU de sus variantes.
  IF v_destino.referencia_clave <> '' THEN
    UPDATE public.textil_stock
       SET sku = v_destino.referencia
     WHERE producto_id = _destino AND NULLIF(btrim(sku), '') IS NULL;
    UPDATE public.textil_productos SET referencia = NULL WHERE id = _destino;
  END IF;

  -- Cada producto de origen: su referencia al SKU de sus variantes, sus
  -- variantes al destino, y él se desactiva.
  FOR v_origen IN
    SELECT * FROM public.textil_productos WHERE id = ANY(v_origenes) ORDER BY id
  LOOP
    UPDATE public.textil_stock
       SET sku = COALESCE(NULLIF(btrim(sku), ''), v_origen.referencia),
           producto_id = _destino
     WHERE producto_id = v_origen.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_variantes := v_variantes + v_n;
    UPDATE public.textil_productos SET activo = false WHERE id = v_origen.id;
    v_productos := v_productos + 1;
  END LOOP;

  RETURN jsonb_build_object('variantes', v_variantes, 'productos', v_productos);
END;
$$;

COMMENT ON FUNCTION public.textil_productos_unir(UUID, UUID, UUID[]) IS
  'Deja en un producto (el modelo) las variantes de otros con la misma marca y nombre. '
  'La referencia de cada uno pasa al SKU de sus variantes; los de origen se desactivan. '
  'No borra nada. Exige escribir.';

-- Solo el servidor: recibe _usuario_id y no lo compara con auth.uid() (C22, caso 33).
REVOKE ALL ON FUNCTION public.textil_productos_unir(UUID, UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.textil_productos_unir(UUID, UUID, UUID[]) TO service_role;
