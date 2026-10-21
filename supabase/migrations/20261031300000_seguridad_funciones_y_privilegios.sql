-- ============================================================================
-- SEGURIDAD: VISTAS, FUNCIONES SECURITY DEFINER Y PRIVILEGIOS DE TABLA
-- ============================================================================
--
-- QUÉ RESUELVE (hallazgos de la auditoría de seguridad de octubre)
--
--   SEG-01  La vista clientes_duplicados_por_email se creó sin
--           security_invoker: se ejecuta como su dueño (postgres) y se salta la
--           RLS de clientes, pedidos, facturas y tiendas. Y como Supabase
--           concede por defecto SELECT a anon sobre todo lo que se crea en
--           public, con solo la clave pública de la web (sin iniciar sesión)
--           se leían correo, NIF y nombre de todos los clientes con correo
--           repetido.
--             -> security_invoker = true en esa vista, y REVOKE ALL FROM anon
--                en las tres vistas de public.
--
--   SEG-02  banco_conciliar(_usuario_id, ...) y banco_desconciliar(...) son
--           SECURITY DEFINER, están concedidas a authenticated y fijan el autor
--           de la auditoría con el parámetro. Nada comprobaba que _usuario_id
--           fuera quien llama: cualquiera con sesión conciliaba firmando como
--           otro socio (y con la pertenencia de ese socio).
--             -> Si hay sesión (auth.uid() no nulo), _usuario_id tiene que ser
--                auth.uid(). Desde el servidor con la clave de servicio
--                auth.uid() es nulo y todo sigue igual. La aplicación ya manda
--                context.userId, que es auth.uid(): no cambia nada para ella.
--
--   SEG-04  Funciones SECURITY DEFINER que authenticated puede ejecutar y que
--           no miraban de quién es el objeto:
--             - Escriben: textil_pedido_entregar (convertía en venta las
--               reservas de un pedido ajeno), textil_stock_retirar,
--               siguiente_numero (gastaba números de otra empresa) y
--               plantillas_correo_sembrar.
--                 -> Si hay sesión y quien llama no es de la empresa (o de la
--                    tienda), RAISE 42501. Mismo patrón que
--                    textil_compra_registrar().
--             - Leen: tienda_resumen_borrado (RAISE si no es de la tienda),
--               smtp_estado, serie_estado, stock_descuadres,
--               stock_reservas_descuadres y facturas_huecos_en_serie (solo
--               devuelven filas de las empresas de quien llama).
--             - auditoria_verificar y serie_mayor_numero no las llama la
--               aplicación: REVOKE EXECUTE a anon y authenticated (las sigue
--               usando service_role y las funciones que corren como dueño).
--           Sin sesión (service_role, o postgres en el SQL Editor) todo se
--           comporta como antes.
--
--   SEG-10  anon y authenticated tenían TRUNCATE, TRIGGER y REFERENCES sobre
--           todas las tablas de public (privilegios por defecto de Supabase).
--           TRUNCATE se salta la RLS y los triggers de fila, también el de
--           auditoría. PostgREST no lo expone, pero sobra.
--             -> REVOKE de los tres sobre todas las tablas, y lo mismo en los
--                privilegios por defecto para las que se creen después.
--
--   SEG-07  (la parte que no son políticas) El bucket 'compras' no tenía
--           límite de tamaño ni de tipo, y 'logos' no limitaba el tipo.
--             -> compras: 10 MB y PDF/JPG/PNG/WEBP/GIF (lo mismo que ya
--                exige ficheroDe() en compras.functions.ts). logos: 2 MB y
--                PNG/JPG/WEBP (lo mismo que ya exigen las dos pantallas que
--                suben logos). Los ficheros que ya están no se tocan.
--
--   SEG-13  Las funciones que se recrean aquí llevan
--           SET search_path = public, pg_temp.
--
-- NIVELES DE USUARIO (20261031200300)
--   Seis de las funciones que se recrean aquí (banco_conciliar,
--   banco_desconciliar, textil_pedido_entregar, textil_stock_retirar,
--   siguiente_numero y plantillas_correo_sembrar) llevan ya en su primera
--   línea la comprobación de nivel rol_exigir_quien(). Se conserva tal cual al
--   recrearlas, y la reversión vuelve al cuerpo de 20261031200300 (con esa
--   línea), no al de antes de los niveles. Esta migración depende, por tanto,
--   de 20261031200100 (que crea rol_exigir_quien).
--
-- QUÉ NO TOCA
--   Ninguna política RLS (ni de tabla ni de storage.objects), ni has_role,
--   is_tienda_member o es_miembro_empresa, ni user_roles: eso va en las ramas
--   de rendimiento (mis_tiendas()/mis_empresas()) y de usuarios y roles.
--   Ningún dato: solo definiciones de funciones, permisos y la configuración
--   de dos buckets.
--
-- REVERSIBLE
--   Sí: supabase/reversiones/20261031300000_seguridad_funciones_y_privilegios.sql
--   repone las definiciones y permisos de antes. No toca datos.
--
-- PRUEBA
--   supabase/pruebas/C22_seguridad.sql (registrada en probar-migraciones.sh).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Vistas (SEG-01)
-- ---------------------------------------------------------------------------
ALTER VIEW public.clientes_duplicados_por_email SET (security_invoker = true);

REVOKE ALL ON public.clientes_duplicados_por_email FROM anon;
REVOKE ALL ON public.clientes_posibles_duplicados FROM anon;
REVOKE ALL ON public.pedidos_pendientes_cobro FROM anon;

-- authenticated solo lee: una vista no se escribe desde el navegador.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON public.clientes_duplicados_por_email,
     public.clientes_posibles_duplicados,
     public.pedidos_pendientes_cobro
  FROM authenticated;

-- ---------------------------------------------------------------------------
-- 2. Conciliación: el autor es quien llama (SEG-02)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.banco_conciliar(
  _usuario_id UUID,
  _movimiento_id UUID,
  _factura_id UUID,
  _motivo TEXT DEFAULT 'importe'
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_grupo UUID;
  v_id UUID;
BEGIN
  -- Nivel: escribir (20261031200300; se conserva al recrearla aquí).
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  -- Con sesión, el autor no se elige: es quien llama. Sin sesión (servidor con
  -- la clave de servicio) se confía en el parámetro, como en emitir_factura().
  IF auth.uid() IS NOT NULL AND _usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'El autor de la conciliación tiene que ser quien la hace'
      USING ERRCODE = '42501';
  END IF;

  v_grupo := public.banco_enlazar_como(
    _usuario_id, ARRAY[_movimiento_id],
    jsonb_build_array(jsonb_build_object('tipo', 'factura', 'id', _factura_id)),
    'conciliada', _motivo);
  SELECT id INTO v_id FROM public.banco_conciliaciones WHERE grupo = v_grupo;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.banco_desconciliar(_usuario_id UUID, _movimiento_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_grupo UUID;
BEGIN
  -- Nivel: escribir (20261031200300; se conserva al recrearla aquí).
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  IF auth.uid() IS NOT NULL AND _usuario_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'El autor de la desconciliación tiene que ser quien la hace'
      USING ERRCODE = '42501';
  END IF;

  SELECT grupo INTO v_grupo FROM public.banco_conciliaciones
   WHERE movimiento_id = _movimiento_id LIMIT 1;
  IF v_grupo IS NULL THEN RETURN false; END IF;
  RETURN public.banco_desenlazar_como(_usuario_id, v_grupo) > 0;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Funciones que escriben: solo sobre lo de tu empresa (SEG-04)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.textil_pedido_entregar(_pedido_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r RECORD;
  v_n INT := 0;
  v_empresa UUID;
BEGIN
  -- Nivel: escribir (20261031200300; se conserva al recrearla aquí).
  PERFORM public.rol_exigir_quien(NULL, 'escribir');
  SELECT empresa_id INTO v_empresa FROM public.textil_pedidos WHERE id = _pedido_id;
  IF auth.uid() IS NOT NULL AND v_empresa IS NOT NULL
     AND NOT public.es_miembro_empresa(auth.uid(), v_empresa) THEN
    RAISE EXCEPTION 'Sin acceso a este pedido' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT empresa_id, stock_id, cantidad
      FROM public.textil_stock_reservas
     WHERE textil_pedido_id = _pedido_id
  LOOP
    -- Las reservas sueltas (sin pedido que las respalde) también se miran.
    IF auth.uid() IS NOT NULL AND NOT public.es_miembro_empresa(auth.uid(), r.empresa_id) THEN
      RAISE EXCEPTION 'Sin acceso a este pedido' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.textil_stock_movimientos
      (empresa_id, stock_id, motivo, cantidad, textil_pedido_id, nota)
    VALUES (r.empresa_id, r.stock_id, 'venta', -r.cantidad, _pedido_id,
            'Entrega del pedido');
    v_n := v_n + 1;
  END LOOP;

  DELETE FROM public.textil_stock_reservas WHERE textil_pedido_id = _pedido_id;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.textil_stock_retirar(_stock_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_movimientos INT;
  v_cantidad NUMERIC;
  v_empresa UUID;
BEGIN
  -- Nivel: borrar (20261031200300; se conserva al recrearla aquí).
  PERFORM public.rol_exigir_quien(NULL, 'borrar');
  SELECT cantidad, empresa_id INTO v_cantidad, v_empresa
    FROM public.textil_stock WHERE id = _stock_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'borrada';   -- ya no estaba (como antes)
  END IF;

  IF auth.uid() IS NOT NULL AND NOT public.es_miembro_empresa(auth.uid(), v_empresa) THEN
    RAISE EXCEPTION 'Sin acceso a esta variante' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_movimientos
    FROM public.textil_stock_movimientos WHERE stock_id = _stock_id;

  IF v_movimientos = 0 THEN
    DELETE FROM public.textil_stock WHERE id = _stock_id;
    RETURN 'borrada';
  END IF;

  IF v_cantidad <> 0 THEN
    RAISE EXCEPTION 'Esta variante tiene % unidades: para retirarla, anota antes una merma o un ajuste de inventario que la deje a 0, o fusiónala con la buena.',
      replace(trim_scale(v_cantidad)::TEXT, '.', ',') USING ERRCODE = 'restrict_violation';
  END IF;

  UPDATE public.textil_stock SET activa = false, updated_at = now() WHERE id = _stock_id;
  RETURN 'desactivada';
END;
$$;

CREATE OR REPLACE FUNCTION public.siguiente_numero(
  _empresa_id UUID, _ambito TEXT, _ejercicio INTEGER DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ejercicio INT := COALESCE(_ejercicio, EXTRACT(YEAR FROM CURRENT_DATE)::INT);
  v_numero INT;
BEGIN
  -- Nivel: escribir (20261031200300; se conserva al recrearla aquí).
  PERFORM public.rol_exigir_quien(NULL, 'escribir');
  IF auth.uid() IS NOT NULL AND NOT public.es_miembro_empresa(auth.uid(), _empresa_id) THEN
    RAISE EXCEPTION 'Sin acceso a los contadores de esta empresa' USING ERRCODE = '42501';
  END IF;

  -- Una sola sentencia: no hay hueco entre leer y escribir por el que se cuele
  -- otra sesión. El segundo que llegue espera al bloqueo de fila y se lleva el
  -- siguiente.
  INSERT INTO public.contadores AS c (empresa_id, ambito, ejercicio, ultimo)
  VALUES (_empresa_id, _ambito, v_ejercicio, 1)
  ON CONFLICT (empresa_id, ambito, ejercicio)
  DO UPDATE SET ultimo = c.ultimo + 1, updated_at = now()
  RETURNING c.ultimo INTO v_numero;

  RETURN v_numero;
END;
$$;

CREATE OR REPLACE FUNCTION public.plantillas_correo_sembrar(_tienda_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Nivel: escribir (20261031200300; se conserva al recrearla aquí).
  PERFORM public.rol_exigir_quien(NULL, 'escribir');
  IF auth.uid() IS NOT NULL AND NOT public.is_tienda_member(auth.uid(), _tienda_id) THEN
    RAISE EXCEPTION 'Sin acceso a esta tienda' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.tienda_plantillas_correo (empresa_id, tienda_id, clave, asunto, cuerpo)
  SELECT
    t.empresa_id,
    t.id,
    'pedido_enviado',
    'Tu pedido {{pedido_numero}} ya está en camino',
    E'Hola {{cliente_nombre}}:\n\nTu pedido {{pedido_numero}} ha salido de nuestras instalaciones.\n\nTransportista: {{transportista}}\nNúmero de seguimiento: {{codigo_seguimiento}}\nPuedes seguirlo aquí: {{seguimiento_url}}\n\nGracias por confiar en nosotros.\n\n{{tienda_nombre}}'
  FROM public.tiendas t
  WHERE t.id = _tienda_id AND t.empresa_id IS NOT NULL
  ON CONFLICT (tienda_id, clave) DO NOTHING;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Funciones que leen: solo lo de tu empresa o tu tienda (SEG-04)
-- ---------------------------------------------------------------------------
-- Pasan de sql a plpgsql solo donde hace falta un RAISE; las demás filtran.
CREATE OR REPLACE FUNCTION public.tienda_resumen_borrado(_tienda_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_tienda_member(auth.uid(), _tienda_id) THEN
    RAISE EXCEPTION 'Sin acceso a esta tienda' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'nombre',            (SELECT nombre FROM public.tiendas WHERE id = _tienda_id),
    'facturas_emitidas', (SELECT count(*) FROM public.facturas
                           WHERE tienda_id = _tienda_id AND estado <> 'borrador'),
    'facturas_borrador', (SELECT count(*) FROM public.facturas
                           WHERE tienda_id = _tienda_id AND estado = 'borrador'),
    'pedidos',           (SELECT count(*) FROM public.pedidos WHERE tienda_id = _tienda_id),
    'clientes',          (SELECT count(*) FROM public.clientes WHERE tienda_id = _tienda_id),
    'productos',         (SELECT count(*) FROM public.productos WHERE tienda_id = _tienda_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.smtp_estado(_tienda_id UUID DEFAULT NULL)
RETURNS TABLE(ambito TEXT, host TEXT, puerto INTEGER, usuario TEXT, tiene_clave BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN c.tienda_id IS NULL THEN 'general' ELSE 'tienda' END,
         c.host, c.puerto, c.usuario, c.clave_secret_id IS NOT NULL
    FROM public.smtp_config c
   WHERE ((_tienda_id IS NOT NULL
           AND (c.tienda_id = _tienda_id
                OR (c.tienda_id IS NULL
                    AND c.empresa_id = (SELECT t.empresa_id FROM public.tiendas t
                                         WHERE t.id = _tienda_id))))
       OR (_tienda_id IS NULL AND c.tienda_id IS NULL))
     AND (auth.uid() IS NULL OR public.es_miembro_empresa(auth.uid(), c.empresa_id))
   ORDER BY c.tienda_id NULLS LAST
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.serie_estado(
  _empresa_id UUID,
  _ejercicio INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
)
RETURNS TABLE(tipo public.factura_tipo, serie TEXT, ejercicio INTEGER, numero_inicial INTEGER,
              ultimo_numero INTEGER, proximo_numero INTEGER, emitidas BIGINT,
              se_puede_fijar BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH tipos AS (
    SELECT t.tipo, public.empresa_serie(_empresa_id, t.tipo) AS serie
      FROM (VALUES ('ordinaria'::public.factura_tipo),
                   ('rectificativa'::public.factura_tipo),
                   ('simplificada'::public.factura_tipo))
        AS t(tipo)
     -- Sin sesión (servidor), todo; con sesión, solo si es de la empresa.
     WHERE auth.uid() IS NULL OR public.es_miembro_empresa(auth.uid(), _empresa_id)
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

CREATE OR REPLACE FUNCTION public.stock_descuadres()
RETURNS TABLE(stock_id UUID, nombre TEXT, cache NUMERIC, libro NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, s.nombre, s.cantidad,
         COALESCE((SELECT sum(m.cantidad) FROM public.textil_stock_movimientos m
                    WHERE m.stock_id = s.id), 0)
  FROM public.textil_stock s
  WHERE s.cantidad IS DISTINCT FROM
        COALESCE((SELECT sum(m.cantidad) FROM public.textil_stock_movimientos m
                   WHERE m.stock_id = s.id), 0)
    AND (auth.uid() IS NULL OR public.es_miembro_empresa(auth.uid(), s.empresa_id));
$$;

CREATE OR REPLACE FUNCTION public.stock_reservas_descuadres()
RETURNS TABLE(stock_id UUID, nombre TEXT, cache NUMERIC, reservas NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, s.nombre, s.cantidad_reservada,
         COALESCE((SELECT sum(r.cantidad) FROM public.textil_stock_reservas r
                    WHERE r.stock_id = s.id), 0)
  FROM public.textil_stock s
  WHERE s.cantidad_reservada IS DISTINCT FROM
        COALESCE((SELECT sum(r.cantidad) FROM public.textil_stock_reservas r
                   WHERE r.stock_id = s.id), 0)
    AND (auth.uid() IS NULL OR public.es_miembro_empresa(auth.uid(), s.empresa_id));
$$;

CREATE OR REPLACE FUNCTION public.facturas_huecos_en_serie()
RETURNS TABLE(empresa_id UUID, serie TEXT, ejercicio INTEGER, numero_ausente INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  WHERE (auth.uid() IS NULL OR public.es_miembro_empresa(auth.uid(), s.empresa_id))
    AND NOT EXISTS (
    SELECT 1 FROM emitidas e
     WHERE e.empresa_id = s.empresa_id
       AND e.serie = s.serie
       AND e.ejercicio = s.ejercicio
       AND e.numero = g.n
  );
$$;

-- Diagnóstico que la aplicación no llama: fuera del alcance del navegador.
REVOKE EXECUTE ON FUNCTION public.auditoria_verificar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auditoria_verificar() TO service_role;
REVOKE EXECUTE ON FUNCTION public.serie_mayor_numero(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.serie_mayor_numero(UUID, TEXT, INTEGER) TO service_role;

-- Ninguna de las recreadas se deja a anon (los privilegios por defecto de
-- Supabase se la darían a una función nueva; a estas ya no, pero por si acaso).
REVOKE EXECUTE ON FUNCTION
  public.banco_conciliar(UUID, UUID, UUID, TEXT),
  public.banco_desconciliar(UUID, UUID),
  public.textil_pedido_entregar(UUID),
  public.textil_stock_retirar(UUID),
  public.siguiente_numero(UUID, TEXT, INTEGER),
  public.plantillas_correo_sembrar(UUID),
  public.tienda_resumen_borrado(UUID),
  public.smtp_estado(UUID),
  public.serie_estado(UUID, INTEGER),
  public.stock_descuadres(),
  public.stock_reservas_descuadres(),
  public.facturas_huecos_en_serie()
  FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- 5. TRUNCATE, TRIGGER y REFERENCES fuera del alcance de anon y authenticated
--    (SEG-10)
-- ---------------------------------------------------------------------------
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Límites de los buckets (SEG-07, la parte que no son políticas)
-- ---------------------------------------------------------------------------
UPDATE storage.buckets
   SET file_size_limit = 10 * 1024 * 1024,
       allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png',
                                  'image/webp', 'image/gif']
 WHERE id = 'compras';

UPDATE storage.buckets
   SET file_size_limit = 2 * 1024 * 1024,
       allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']
 WHERE id = 'logos';

NOTIFY pgrst, 'reload schema';
