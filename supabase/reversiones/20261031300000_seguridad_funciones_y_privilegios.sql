-- ============================================================================
-- REVERSIÓN de 20261031300000_seguridad_funciones_y_privilegios.sql
-- ============================================================================
-- Repone las definiciones de antes de las funciones recreadas, la vista sin
-- security_invoker y los permisos que Supabase da por defecto. No toca datos.
--
-- OJO: deshacer esto vuelve a abrir los fallos SEG-01, SEG-02, SEG-04 y SEG-10
-- (la vista legible con la clave pública, conciliar firmando como otro socio,
-- funciones que escriben en empresas ajenas y TRUNCATE para anon). Solo con
-- autorización expresa de Javier.
-- ============================================================================

ALTER VIEW public.clientes_duplicados_por_email RESET (security_invoker);
GRANT ALL ON public.clientes_duplicados_por_email, public.clientes_posibles_duplicados,
  public.pedidos_pendientes_cobro TO anon;
GRANT ALL ON public.clientes_duplicados_por_email, public.clientes_posibles_duplicados,
  public.pedidos_pendientes_cobro TO authenticated;

GRANT EXECUTE ON FUNCTION public.auditoria_verificar() TO authenticated;
GRANT EXECUTE ON FUNCTION public.serie_mayor_numero(UUID, TEXT, INTEGER) TO authenticated;

GRANT TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT TRUNCATE, TRIGGER, REFERENCES ON TABLES TO anon, authenticated;

UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL
 WHERE id IN ('compras', 'logos');

-- Definiciones de antes, tal cual estaban.
CREATE OR REPLACE FUNCTION public.banco_conciliar(_usuario_id uuid, _movimiento_id uuid, _factura_id uuid, _motivo text DEFAULT 'importe'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grupo UUID;
  v_id UUID;
BEGIN
  -- Nivel: escribir (20261031200300; la reversión vuelve al cuerpo de 20261031200300, no al de antes de los niveles).
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  v_grupo := public.banco_enlazar_como(
    _usuario_id, ARRAY[_movimiento_id],
    jsonb_build_array(jsonb_build_object('tipo', 'factura', 'id', _factura_id)),
    'conciliada', _motivo);
  SELECT id INTO v_id FROM public.banco_conciliaciones WHERE grupo = v_grupo;
  RETURN v_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.banco_desconciliar(_usuario_id uuid, _movimiento_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grupo UUID;
BEGIN
  -- Nivel: escribir (20261031200300; la reversión vuelve al cuerpo de 20261031200300, no al de antes de los niveles).
  PERFORM public.rol_exigir_quien(_usuario_id, 'escribir');
  SELECT grupo INTO v_grupo FROM public.banco_conciliaciones
   WHERE movimiento_id = _movimiento_id LIMIT 1;
  IF v_grupo IS NULL THEN RETURN false; END IF;
  RETURN public.banco_desenlazar_como(_usuario_id, v_grupo) > 0;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.facturas_huecos_en_serie()
 RETURNS TABLE(empresa_id uuid, serie text, ejercicio integer, numero_ausente integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.plantillas_correo_sembrar(_tienda_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Nivel: escribir (20261031200300; la reversión vuelve al cuerpo de 20261031200300, no al de antes de los niveles).
  PERFORM public.rol_exigir_quien(NULL, 'escribir');
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
$function$
;
CREATE OR REPLACE FUNCTION public.serie_estado(_empresa_id uuid, _ejercicio integer DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer)
 RETURNS TABLE(tipo factura_tipo, serie text, ejercicio integer, numero_inicial integer, ultimo_numero integer, proximo_numero integer, emitidas bigint, se_puede_fijar boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH tipos AS (
    SELECT t.tipo, public.empresa_serie(_empresa_id, t.tipo) AS serie
      FROM (VALUES ('ordinaria'::public.factura_tipo),
                   ('rectificativa'::public.factura_tipo),
                   ('simplificada'::public.factura_tipo))
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
$function$
;
CREATE OR REPLACE FUNCTION public.siguiente_numero(_empresa_id uuid, _ambito text, _ejercicio integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ejercicio INT := COALESCE(_ejercicio, EXTRACT(YEAR FROM CURRENT_DATE)::INT);
  v_numero INT;
BEGIN
  -- Nivel: escribir (20261031200300; la reversión vuelve al cuerpo de 20261031200300, no al de antes de los niveles).
  PERFORM public.rol_exigir_quien(NULL, 'escribir');
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
$function$
;
CREATE OR REPLACE FUNCTION public.smtp_estado(_tienda_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(ambito text, host text, puerto integer, usuario text, tiene_clave boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN c.tienda_id IS NULL THEN 'general' ELSE 'tienda' END,
         c.host, c.puerto, c.usuario, c.clave_secret_id IS NOT NULL
    FROM public.smtp_config c
   WHERE (_tienda_id IS NOT NULL
          AND (c.tienda_id = _tienda_id
               OR (c.tienda_id IS NULL
                   AND c.empresa_id = (SELECT t.empresa_id FROM public.tiendas t
                                        WHERE t.id = _tienda_id))))
      OR (_tienda_id IS NULL AND c.tienda_id IS NULL)
   ORDER BY c.tienda_id NULLS LAST
   LIMIT 1;
$function$
;
CREATE OR REPLACE FUNCTION public.stock_descuadres()
 RETURNS TABLE(stock_id uuid, nombre text, cache numeric, libro numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.id, s.nombre, s.cantidad,
         COALESCE((SELECT sum(m.cantidad) FROM public.textil_stock_movimientos m
                    WHERE m.stock_id = s.id), 0)
  FROM public.textil_stock s
  WHERE s.cantidad IS DISTINCT FROM
        COALESCE((SELECT sum(m.cantidad) FROM public.textil_stock_movimientos m
                   WHERE m.stock_id = s.id), 0);
$function$
;
CREATE OR REPLACE FUNCTION public.stock_reservas_descuadres()
 RETURNS TABLE(stock_id uuid, nombre text, cache numeric, reservas numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.id, s.nombre, s.cantidad_reservada,
         COALESCE((SELECT sum(r.cantidad) FROM public.textil_stock_reservas r
                    WHERE r.stock_id = s.id), 0)
  FROM public.textil_stock s
  WHERE s.cantidad_reservada IS DISTINCT FROM
        COALESCE((SELECT sum(r.cantidad) FROM public.textil_stock_reservas r
                   WHERE r.stock_id = s.id), 0);
$function$
;
CREATE OR REPLACE FUNCTION public.textil_pedido_entregar(_pedido_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_n INT := 0;
BEGIN
  -- Nivel: escribir (20261031200300; la reversión vuelve al cuerpo de 20261031200300, no al de antes de los niveles).
  PERFORM public.rol_exigir_quien(NULL, 'escribir');
  FOR r IN
    SELECT empresa_id, stock_id, cantidad
      FROM public.textil_stock_reservas
     WHERE textil_pedido_id = _pedido_id
  LOOP
    INSERT INTO public.textil_stock_movimientos
      (empresa_id, stock_id, motivo, cantidad, textil_pedido_id, nota)
    VALUES (r.empresa_id, r.stock_id, 'venta', -r.cantidad, _pedido_id,
            'Entrega del pedido');
    v_n := v_n + 1;
  END LOOP;

  DELETE FROM public.textil_stock_reservas WHERE textil_pedido_id = _pedido_id;
  RETURN v_n;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.textil_stock_retirar(_stock_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_movimientos INT;
  v_cantidad NUMERIC;
BEGIN
  -- Nivel: borrar (20261031200300; la reversión vuelve al cuerpo de 20261031200300, no al de antes de los niveles).
  PERFORM public.rol_exigir_quien(NULL, 'borrar');
  SELECT cantidad INTO v_cantidad FROM public.textil_stock WHERE id = _stock_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'borrada';   -- ya no estaba (como antes)
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
$function$
;
CREATE OR REPLACE FUNCTION public.tienda_resumen_borrado(_tienda_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'nombre',            (SELECT nombre FROM public.tiendas WHERE id = _tienda_id),
    'facturas_emitidas', (SELECT count(*) FROM public.facturas
                           WHERE tienda_id = _tienda_id AND estado <> 'borrador'),
    'facturas_borrador', (SELECT count(*) FROM public.facturas
                           WHERE tienda_id = _tienda_id AND estado = 'borrador'),
    'pedidos',           (SELECT count(*) FROM public.pedidos WHERE tienda_id = _tienda_id),
    'clientes',          (SELECT count(*) FROM public.clientes WHERE tienda_id = _tienda_id),
    'productos',         (SELECT count(*) FROM public.productos WHERE tienda_id = _tienda_id)
  );
$function$
;

NOTIFY pgrst, 'reload schema';
