-- ============================================================================
-- WooCommerce: una sincronización cada vez por tienda, y por dónde va de verdad
-- ============================================================================
--
-- Requiere 20261024100000_woo_sincronizacion.sql (la tabla).
--
-- EL PROBLEMA
--   1. Dos sincronizaciones de la misma tienda a la vez —el bucle de Ajustes,
--      que sigue aunque se salga de la página, y el botón de Pedidos— procesan
--      la misma página de pedidos en paralelo. Cada una borra las líneas de
--      esos pedidos y las vuelve a escribir: si se cruzan, las líneas quedan
--      duplicadas. Nada lo impedía.
--   2. El cursor guardaba solo la fecha. Con 500 o más pedidos modificados en
--      el mismo segundo, la página dentro de ese segundo no se guardaba: el
--      botón de Pedidos (una tanda de 5 páginas) volvía cada vez a la página 1
--      y no salía nunca de ahí.
--   3. Los productos no guardaban la página por lo mismo, y los clientes
--      nuevos no guardaban nada: si una sincronización se cortaba a mitad, la
--      siguiente empezaba desde el cliente más alto de Clientes, que puede
--      haber entrado por un pedido, y se saltaba a los que se registraron
--      antes que él sin comprar.
--
-- QUÉ HACE
--   Añade columnas a public.woo_sincronizacion:
--     pedidos_pagina, productos_pagina   la página dentro del mismo segundo.
--     clientes_hasta_id                  hasta qué id de WooCommerce están ya
--                                        todos los clientes de la tienda (0:
--                                        ninguno todavía).
--     clientes_tope_id, clientes_bajo_id la pasada de clientes que va a medias:
--                                        de qué id empezó y hasta cuál ha bajado
--                                        (NULL si no hay ninguna). Va por ids y
--                                        no por número de página: si se borra un
--                                        cliente en WooCommerce entre dos
--                                        peticiones, una página siguiente se
--                                        correría un puesto y se saltaría a uno.
--     bloqueado_hasta, bloqueo_id        el turno: quién sincroniza ahora y
--                                        hasta cuándo.
--   Y tres funciones, solo para la clave de servicio:
--     woo_sincronizacion_tomar(tienda, segundos) → UUID del turno, o NULL si
--       otra sincronización lo tiene y no ha caducado. Lo hace con un solo
--       INSERT ... ON CONFLICT DO UPDATE ... WHERE bloqueado_hasta <= now():
--       si dos llegan a la vez, Postgres bloquea la fila y la segunda ve el
--       turno ya cogido.
--     woo_sincronizacion_renovar(tienda, turno, segundos) → si sigue siendo
--       suyo; lo alarga. Se llama antes de guardar cada página.
--     woo_sincronizacion_soltar(tienda, turno) → lo suelta al terminar.
--   El turno caduca solo (la aplicación pide 120 s y lo renueva en cada
--   página): si la función muere sin soltarlo, la tienda no se queda
--   bloqueada.
--
-- PERMISOS
--   Las funciones son SECURITY INVOKER y solo las puede ejecutar service_role:
--   las llama sincronizarWoo en el servidor. La tabla sigue igual: los
--   usuarios de la empresa la leen y no la escriben.
--
-- SIN ESTA MIGRACIÓN
--   La sincronización funciona como con la 20261024100000 sola, y avisa en
--   pantalla de que falta: sin turno, sin página guardada y sin pasada de
--   clientes guardada.
--
-- NO TOCA NINGUNA FILA EXISTENTE salvo para dar a las columnas nuevas su valor
-- por defecto (página 1, sin turno). Se puede aplicar dos veces.
--
-- REVERSIBLE
--   Sí, sin perder nada de negocio (pídelo antes: son DROP):
--     DROP FUNCTION public.woo_sincronizacion_tomar(UUID, INTEGER);
--     DROP FUNCTION public.woo_sincronizacion_renovar(UUID, UUID, INTEGER);
--     DROP FUNCTION public.woo_sincronizacion_soltar(UUID, UUID);
--     ALTER TABLE public.woo_sincronizacion
--       DROP COLUMN pedidos_pagina, DROP COLUMN productos_pagina,
--       DROP COLUMN clientes_hasta_id, DROP COLUMN clientes_tope_id,
--       DROP COLUMN clientes_bajo_id, DROP COLUMN bloqueado_hasta,
--       DROP COLUMN bloqueo_id;
--   Solo se pierde por dónde iba la sincronización; la aplicación vuelve a lo
--   de la 20261024100000.
-- ============================================================================

ALTER TABLE public.woo_sincronizacion
  ADD COLUMN IF NOT EXISTS pedidos_pagina INTEGER NOT NULL DEFAULT 1
    CHECK (pedidos_pagina >= 1),
  ADD COLUMN IF NOT EXISTS productos_pagina INTEGER NOT NULL DEFAULT 1
    CHECK (productos_pagina >= 1),
  ADD COLUMN IF NOT EXISTS clientes_hasta_id BIGINT
    CHECK (clientes_hasta_id >= 0),
  ADD COLUMN IF NOT EXISTS clientes_tope_id BIGINT
    CHECK (clientes_tope_id >= 1),
  ADD COLUMN IF NOT EXISTS clientes_bajo_id BIGINT
    CHECK (clientes_bajo_id >= 1),
  ADD COLUMN IF NOT EXISTS bloqueado_hasta TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bloqueo_id UUID;

COMMENT ON COLUMN public.woo_sincronizacion.pedidos_pagina IS
  'Página de la consulta desde pedidos_hasta. Solo pasa de 1 con cientos de pedidos '
  'modificados en el mismo segundo.';
COMMENT ON COLUMN public.woo_sincronizacion.productos_pagina IS
  'Página de la consulta desde productos_hasta (como pedidos_pagina).';
COMMENT ON COLUMN public.woo_sincronizacion.clientes_hasta_id IS
  'Los clientes de WooCommerce con id menor o igual que este ya están todos aquí. '
  '0: ninguno todavía. NULL: nunca se ha guardado.';
COMMENT ON COLUMN public.woo_sincronizacion.clientes_tope_id IS
  'El id más alto de la pasada de clientes en curso; al terminarla pasa a clientes_hasta_id.';
COMMENT ON COLUMN public.woo_sincronizacion.clientes_bajo_id IS
  'Hasta dónde ha bajado la pasada de clientes en curso: los de id entre este y '
  'clientes_tope_id ya se han visto. La siguiente petición pide los 100 ids de debajo. '
  'NULL: no hay pasada en curso.';
COMMENT ON COLUMN public.woo_sincronizacion.bloqueado_hasta IS
  'Hasta cuándo tiene el turno la sincronización en marcha. NULL o pasado: libre.';
COMMENT ON COLUMN public.woo_sincronizacion.bloqueo_id IS
  'El turno de la sincronización en marcha: solo quien lo tiene lo renueva o lo suelta.';

-- ---------------------------------------------------------------------------
-- El turno
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.woo_sincronizacion_tomar(_tienda_id UUID, _segundos INTEGER)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_empresa UUID;
  v_turno UUID;
BEGIN
  IF _segundos IS NULL OR _segundos < 1 OR _segundos > 600 THEN
    RAISE EXCEPTION 'El turno tiene que durar entre 1 y 600 segundos, no %', _segundos;
  END IF;

  SELECT t.empresa_id INTO v_empresa FROM public.tiendas t WHERE t.id = _tienda_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe la tienda %', _tienda_id;
  END IF;

  INSERT INTO public.woo_sincronizacion AS w (tienda_id, empresa_id, bloqueado_hasta, bloqueo_id)
  VALUES (
    _tienda_id,
    COALESCE(v_empresa, public.empresa_por_defecto()),
    now() + make_interval(secs => _segundos),
    gen_random_uuid()
  )
  ON CONFLICT (tienda_id) DO UPDATE
     SET bloqueado_hasta = EXCLUDED.bloqueado_hasta,
         bloqueo_id = EXCLUDED.bloqueo_id
   WHERE w.bloqueado_hasta IS NULL OR w.bloqueado_hasta <= now()
  RETURNING w.bloqueo_id INTO v_turno;

  -- Sin fila devuelta (v_turno NULL): otra sincronización tiene el turno.
  RETURN v_turno;
END;
$$;

COMMENT ON FUNCTION public.woo_sincronizacion_tomar(UUID, INTEGER) IS
  'Coge el turno de sincronización de una tienda durante _segundos. Devuelve el turno, '
  'o NULL si otra sincronización lo tiene y no ha caducado.';

CREATE OR REPLACE FUNCTION public.woo_sincronizacion_renovar(
  _tienda_id UUID,
  _bloqueo_id UUID,
  _segundos INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF _segundos IS NULL OR _segundos < 1 OR _segundos > 600 THEN
    RAISE EXCEPTION 'El turno tiene que durar entre 1 y 600 segundos, no %', _segundos;
  END IF;
  -- Aunque haya caducado: si nadie lo ha cogido, sigue siendo suyo.
  UPDATE public.woo_sincronizacion
     SET bloqueado_hasta = now() + make_interval(secs => _segundos)
   WHERE tienda_id = _tienda_id AND bloqueo_id = _bloqueo_id;
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.woo_sincronizacion_renovar(UUID, UUID, INTEGER) IS
  'Alarga el turno si sigue siendo de quien lo pide. FALSE: lo tiene otra sincronización.';

CREATE OR REPLACE FUNCTION public.woo_sincronizacion_soltar(_tienda_id UUID, _bloqueo_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.woo_sincronizacion
     SET bloqueado_hasta = NULL, bloqueo_id = NULL
   WHERE tienda_id = _tienda_id AND bloqueo_id = _bloqueo_id;
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.woo_sincronizacion_soltar(UUID, UUID) IS
  'Suelta el turno si es de quien lo pide.';

-- Solo la clave de servicio. Supabase da EXECUTE a anon y authenticated en
-- las funciones nuevas de public: se les quita por nombre.
REVOKE ALL ON FUNCTION public.woo_sincronizacion_tomar(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.woo_sincronizacion_renovar(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.woo_sincronizacion_soltar(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.woo_sincronizacion_tomar(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.woo_sincronizacion_renovar(UUID, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.woo_sincronizacion_soltar(UUID, UUID) TO service_role;
