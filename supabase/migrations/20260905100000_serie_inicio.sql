-- ============================================================================
-- FACTURACIÓN · Dónde empieza la numeración, y quién puede decidirlo
-- ============================================================================
--
-- QUÉ FALTA
--   El contador de facturas (series_facturacion) siempre arranca en 0, así que
--   la primera factura de una serie es la número 1. No hay ninguna forma de
--   decirle que empiece en otro sitio.
--
--   Eso es un problema el día que DTI traiga la numeración de otro programa:
--   si ya se emitieron 214 facturas este ejercicio fuera del CRM, la siguiente
--   tiene que ser la 215, no la 1. Repetir del 1 al 214 produce números
--   duplicados dentro de la misma serie y ejercicio, que es exactamente lo que
--   la numeración correlativa existe para impedir.
--
-- QUÉ HAY AHORA MISMO Y ENGAÑA
--   La pantalla de alta de tienda pide «Siguiente nº de factura» y «Serie de
--   factura». Los dos controles están muertos desde 20260903100000:
--
--     - La serie es de la sociedad (empresas.serie_factura). La columna
--       tiendas.serie_factura está marcada OBSOLETA en esa migración y
--       emitir_factura() ya no la lee.
--     - tiendas.siguiente_numero_factura no lo lee nadie. Se usó una sola vez,
--       como semilla, el día que se aplicó 20260902130000.
--
--   Así que hoy se puede escribir «500» en ese campo, guardarlo sin error, y
--   que la primera factura salga con el número 1. Un control que acepta un dato
--   fiscal y lo tira es peor que no tener control.
--
-- QUÉ HACE ESTA MIGRACIÓN
--   1. series_facturacion.numero_inicial: por dónde empieza la serie.
--   2. serie_estado(): en qué punto está cada serie de un ejercicio y si
--      todavía se puede fijar por dónde empieza.
--   3. serie_fijar_inicio(): fija el número de la próxima factura, y SOLO
--      mientras esa serie y ese ejercicio no tengan ninguna factura emitida.
--   4. facturas_huecos_en_serie() pasa a contar desde numero_inicial.
--
-- POR QUÉ HACE FALTA numero_inicial
--   facturas_huecos_en_serie() recorría generate_series(1, ultimo_numero). Una
--   serie que arranca en el 215 no tiene las facturas 1 a 214 —no son suyas, se
--   emitieron en el otro programa— y el detector las habría dado por huecos.
--   214 huecos falsos, todos los días, para siempre. Y una alarma que siempre
--   suena no avisa de nada, que es justo lo que dice el comentario de esa misma
--   función. Con numero_inicial, el recorrido empieza donde empieza la serie.
--
-- POR QUÉ SOLO MIENTRAS ESTÉ VACÍA
--   Mover el contador con facturas ya emitidas rompe la serie en los dos
--   sentidos: subirlo deja un hueco (números asignados sin factura detrás),
--   bajarlo produce un número repetido. Ninguna de las dos cosas se arregla
--   después. Por eso no es una preferencia configurable: es una decisión que se
--   toma una vez, antes de la primera factura, y luego se cierra sola.
--
--   La comprobación mira las DOS tablas que comparten numeración, facturas y
--   textil_facturas, igual que facturas_huecos_en_serie().
--
-- POR QUÉ CON BLOQUEO
--   Se toma el mismo bloqueo de fila que emitir_factura() y se vuelve a
--   comprobar que no hay facturas DENTRO del bloqueo. Sin eso, una emisión que
--   entrara entre la comprobación y la escritura se quedaría con un número que
--   luego se reasignaría.
--
-- ESTO NO ES EL SIF DE VERIFACTU
--   Sigue sin haber huella encadenada ni envío a la AEAT: eso lo hace el
--   proveedor certificado. Esto es el motor interno sobre el que se engancha.
--
-- DEPENDE DE
--   20260902130000_motor_facturacion.sql   (series_facturacion, factura_tipo)
--   20260903100000_empresa_y_serie_unicas.sql (empresa_serie, serie única)
--
-- REVERSIBLE
--   Sí. Añade una columna con valor por defecto y dos funciones, y redefine
--   facturas_huecos_en_serie() (el cuerpo anterior está en 20260903100000).
--   No modifica ni borra ninguna fila.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Por dónde empieza la serie
-- ---------------------------------------------------------------------------
-- Por defecto 1, que es lo que han hecho todas las series hasta hoy: la columna
-- se añade con ese valor y ninguna serie existente cambia de comportamiento.
ALTER TABLE public.series_facturacion
  ADD COLUMN IF NOT EXISTS numero_inicial INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.series_facturacion
  DROP CONSTRAINT IF EXISTS series_numero_inicial_valido;
ALTER TABLE public.series_facturacion
  ADD CONSTRAINT series_numero_inicial_valido CHECK (numero_inicial >= 1);

COMMENT ON COLUMN public.series_facturacion.numero_inicial IS
  'Primer número que usa esta serie. 1 salvo que la numeración venga de otro '
  'programa. Marca desde dónde busca huecos facturas_huecos_en_serie().';

-- ---------------------------------------------------------------------------
-- 2. En qué punto está la numeración
-- ---------------------------------------------------------------------------
-- Devuelve una fila por serie (ordinaria y rectificativa) del ejercicio.
-- `emitidas` cuenta las facturas reales; `ultimo_numero` es lo que dice el
-- contador. Si difieren, hay huecos: facturas_huecos_en_serie() los enumera.
CREATE OR REPLACE FUNCTION public.serie_estado(
  _empresa_id UUID,
  _ejercicio INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
)
RETURNS TABLE (
  tipo public.factura_tipo,
  serie TEXT,
  ejercicio INTEGER,
  numero_inicial INTEGER,
  ultimo_numero INTEGER,
  proximo_numero INTEGER,
  emitidas BIGINT,
  se_puede_fijar BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH tipos AS (
    SELECT t.tipo, public.empresa_serie(_empresa_id, t.tipo) AS serie
      FROM (VALUES ('ordinaria'::public.factura_tipo), ('rectificativa'::public.factura_tipo))
        AS t(tipo)
  ),
  emitidas AS (
    SELECT f.empresa_id, f.serie, f.ejercicio FROM public.facturas f
    UNION ALL
    SELECT tf.empresa_id, tf.serie, tf.ejercicio
      FROM public.textil_facturas tf WHERE tf.numero_serie IS NOT NULL
  )
  SELECT
    t.tipo,
    t.serie,
    _ejercicio,
    COALESCE(s.numero_inicial, 1),
    COALESCE(s.ultimo_numero, COALESCE(s.numero_inicial, 1) - 1),
    GREATEST(COALESCE(s.ultimo_numero, 0) + 1, COALESCE(s.numero_inicial, 1)),
    COALESCE(n.emitidas, 0),
    COALESCE(n.emitidas, 0) = 0
  FROM tipos t
  LEFT JOIN public.series_facturacion s
    ON s.empresa_id = _empresa_id AND s.serie = t.serie AND s.ejercicio = _ejercicio
  LEFT JOIN LATERAL (
    SELECT count(*) AS emitidas FROM emitidas e
     WHERE e.empresa_id = _empresa_id AND e.serie = t.serie AND e.ejercicio = _ejercicio
  ) n ON TRUE
  ORDER BY t.tipo;
$$;

COMMENT ON FUNCTION public.serie_estado(UUID, INTEGER) IS
  'Punto en que está cada serie del ejercicio. se_puede_fijar es falso en '
  'cuanto hay una factura emitida: a partir de ahí el contador no se toca.';

REVOKE EXECUTE ON FUNCTION public.serie_estado(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.serie_estado(UUID, INTEGER) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Fijar por dónde empieza
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.serie_fijar_inicio(
  _usuario_id UUID,
  _empresa_id UUID,
  _ejercicio INTEGER,
  _tipo public.factura_tipo,
  _siguiente INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_serie TEXT;
  v_serie_id UUID;
  v_emitidas BIGINT;
  v_anio INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
BEGIN
  IF _usuario_id IS NULL THEN
    RAISE EXCEPTION 'Falta el usuario: el contador de facturas no se mueve sin autor';
  END IF;

  -- SECURITY DEFINER se salta la RLS, así que la pertenencia se comprueba aquí.
  IF NOT public.es_miembro_empresa(_usuario_id, _empresa_id) THEN
    RAISE EXCEPTION 'Sin acceso a esta empresa';
  END IF;

  IF _siguiente IS NULL OR _siguiente < 1 THEN
    RAISE EXCEPTION 'El número de la próxima factura tiene que ser 1 o mayor, no %', _siguiente;
  END IF;

  -- Un ejercicio futuro se puede preparar; uno anterior al actual, no: si ya
  -- pasó, o tiene facturas (y entonces está cerrado igualmente) o no las tuvo
  -- nunca y no hay nada que numerar.
  IF _ejercicio IS NULL OR _ejercicio < v_anio OR _ejercicio > v_anio + 1 THEN
    RAISE EXCEPTION 'Ejercicio fuera de rango: % (solo % o %)', _ejercicio, v_anio, v_anio + 1;
  END IF;

  v_serie := public.empresa_serie(_empresa_id, _tipo);

  PERFORM set_config('app.usuario_id', _usuario_id::TEXT, true);

  -- El mismo bloqueo que toma emitir_factura(), por la misma razón.
  INSERT INTO public.series_facturacion (empresa_id, tienda_id, serie, ejercicio, ultimo_numero)
  VALUES (_empresa_id, NULL, v_serie, _ejercicio, 0)
  ON CONFLICT (empresa_id, serie, ejercicio) DO NOTHING;

  SELECT s.id INTO v_serie_id
    FROM public.series_facturacion s
   WHERE s.empresa_id = _empresa_id AND s.serie = v_serie AND s.ejercicio = _ejercicio
     FOR UPDATE;

  -- Dentro del bloqueo: si se comprobara antes, una emisión concurrente podría
  -- colarse entre la comprobación y la escritura y quedarse con un número que
  -- luego se reasignaría.
  SELECT count(*) INTO v_emitidas FROM (
    SELECT 1 FROM public.facturas f
     WHERE f.empresa_id = _empresa_id AND f.serie = v_serie AND f.ejercicio = _ejercicio
    UNION ALL
    SELECT 1 FROM public.textil_facturas tf
     WHERE tf.empresa_id = _empresa_id AND tf.serie = v_serie AND tf.ejercicio = _ejercicio
       AND tf.numero_serie IS NOT NULL
  ) x;

  IF v_emitidas > 0 THEN
    RAISE EXCEPTION
      'La serie % del ejercicio % ya tiene % factura(s) emitida(s): su numeración no se mueve. '
      'Subir el contador dejaría un hueco y bajarlo repetiría un número.',
      v_serie, _ejercicio, v_emitidas;
  END IF;

  -- numero_inicial es lo que impide que el detector de huecos cuente como
  -- ausentes los números anteriores, que nunca fueron de esta serie.
  UPDATE public.series_facturacion
     SET ultimo_numero = _siguiente - 1,
         numero_inicial = _siguiente
   WHERE id = v_serie_id;

  RETURN jsonb_build_object(
    'serie', v_serie,
    'ejercicio', _ejercicio,
    'tipo', _tipo,
    'proximo_numero', _siguiente
  );
END;
$$;

COMMENT ON FUNCTION public.serie_fijar_inicio(UUID, UUID, INTEGER, public.factura_tipo, INTEGER) IS
  'Fija el número de la próxima factura de una serie. Solo mientras esa serie '
  'y ejercicio no tengan ninguna factura emitida.';

REVOKE EXECUTE ON FUNCTION public.serie_fijar_inicio(
  UUID, UUID, INTEGER, public.factura_tipo, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.serie_fijar_inicio(
  UUID, UUID, INTEGER, public.factura_tipo, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. El detector de huecos cuenta desde donde empieza la serie
-- ---------------------------------------------------------------------------
-- Mismo cuerpo que en 20260903100000, con generate_series arrancando en
-- numero_inicial en vez de en 1. Para las series que empiezan en 1 —todas las
-- de hoy— el resultado es idéntico.
CREATE OR REPLACE FUNCTION public.facturas_huecos_en_serie()
RETURNS TABLE (empresa_id UUID, serie TEXT, ejercicio INTEGER, numero_ausente INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH emitidas AS (
    SELECT f.empresa_id, f.serie, f.ejercicio, f.numero
      FROM public.facturas f
    UNION ALL
    SELECT tf.empresa_id, tf.serie, tf.ejercicio, tf.numero_serie
      FROM public.textil_facturas tf
     WHERE tf.numero_serie IS NOT NULL
  )
  SELECT s.empresa_id, s.serie, s.ejercicio, g.n
  FROM public.series_facturacion s
  CROSS JOIN LATERAL generate_series(s.numero_inicial, s.ultimo_numero) AS g(n)
  WHERE NOT EXISTS (
    SELECT 1 FROM emitidas e
     WHERE e.empresa_id = s.empresa_id
       AND e.serie = s.serie
       AND e.ejercicio = s.ejercicio
       AND e.numero = g.n
  );
$$;

COMMENT ON FUNCTION public.facturas_huecos_en_serie() IS
  'Números asignados por el contador que no corresponden a ninguna factura '
  'emitida, desde numero_inicial y mirando las dos tablas que comparten serie. '
  'Sin filas, la numeración está completa.';

REVOKE EXECUTE ON FUNCTION public.facturas_huecos_en_serie() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.facturas_huecos_en_serie() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Dejar dicho en el esquema que la columna vieja no vale
-- ---------------------------------------------------------------------------
-- La columna no se borra: la usó la semilla de 20260902130000 y borrarla
-- perdería el rastro de por dónde iba cada tienda antes de unificar la serie.
-- Pero que quede escrito en el propio esquema, no solo en una migración.
COMMENT ON COLUMN public.tiendas.siguiente_numero_factura IS
  'OBSOLETA. No la lee nadie. El contador vivo es series_facturacion, y por '
  'dónde empieza se fija con serie_fijar_inicio().';
