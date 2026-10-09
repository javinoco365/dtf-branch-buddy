-- ============================================================================
-- Auditoría en las cinco tablas que escribían sin dejar rastro
-- ============================================================================
-- Prueba 20261023110000_auditoria_tablas_pendientes.sql. Se aplica otra vez,
-- dos veces (tiene que poder repetirse sin duplicar triggers).
--
-- Todo va dentro de una transacción que se deshace al final: la tienda, el
-- pedido, el autor y el ticket T2036/0001 que escribe la prueba no se quedan
-- en la base. Las filas de auditoría que generan sí se comprueban, antes de
-- deshacer: el punto 8 recorre la cadena entera con ellas dentro. El 9
-- comprueba, ya deshecha, que no ha quedado rastro.
BEGIN;
SET client_min_messages = warning;
\ir ../migrations/20261023110000_auditoria_tablas_pendientes.sql
\ir ../migrations/20261023110000_auditoria_tablas_pendientes.sql
RESET client_min_messages;

-- ---------------------------------------------------------------------------
-- 1. Un trigger, y uno solo, en cada tabla: AFTER INSERT OR UPDATE OR DELETE,
--    FOR EACH ROW, llamando a auditoria_registrar()
-- ---------------------------------------------------------------------------
-- tgtype: 1 = por fila, 4 = INSERT, 8 = DELETE, 16 = UPDATE; sin el 2
-- (BEFORE) ni el 64 (INSTEAD OF). 1 + 4 + 8 + 16 = 29.
SELECT CASE WHEN fallan IS NULL
            THEN 'BIEN  1. series_facturacion, cliente_tiendas, pedido_correos_enviados, '
                 'enlaces_seguimiento y tienda_seguimiento_config tienen su trigger de auditoría, uno solo'
            ELSE 'MAL   1. sin trigger de auditoría correcto (o repetido): ' || fallan END
  FROM (
    SELECT string_agg(t, ', ' ORDER BY t) AS fallan
      FROM unnest(ARRAY['series_facturacion', 'cliente_tiendas', 'pedido_correos_enviados',
                        'enlaces_seguimiento', 'tienda_seguimiento_config']) AS t
     WHERE (SELECT count(*) FROM pg_trigger g
             WHERE g.tgrelid = ('public.' || t)::regclass
               AND g.tgfoid = 'public.auditoria_registrar'::regproc
               AND NOT g.tgisinternal) <> 1
        OR NOT EXISTS (SELECT 1 FROM pg_trigger g
                        WHERE g.tgrelid = ('public.' || t)::regclass
                          AND g.tgfoid = 'public.auditoria_registrar'::regproc
                          AND g.tgname = t || '_auditoria'
                          AND (g.tgtype & 127) = 29)
  ) x;

-- ---------------------------------------------------------------------------
-- Escrituras con autor, como las hace una función de servidor que fija
-- app.usuario_id antes de escribir
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
VALUES ('c1200000-0000-4000-8000-000000000001', 'autor@c12.test')
ON CONFLICT (id) DO NOTHING;

SELECT set_config('c12.autor', 'c1200000-0000-4000-8000-000000000001', false);
SELECT set_config('c12.desde', (SELECT COALESCE(max(id), 0)::TEXT FROM public.auditoria), false);

SELECT set_config('app.usuario_id', current_setting('c12.autor'), true);
DO $$
DECLARE
  v_tienda UUID;
  v_empresa UUID;
  v_pedido UUID;
  v_cliente UUID;
  v_correo UUID;
  v_enlace UUID;
  v_config UUID;
BEGIN
  INSERT INTO public.tiendas (nombre, slug) VALUES ('Tienda C12', 'tienda-c12')
    RETURNING id, empresa_id INTO v_tienda, v_empresa;
  -- El autor es de la tienda: emitir_factura() lo comprueba en el punto 7.
  INSERT INTO public.tienda_usuarios (tienda_id, user_id)
  VALUES (v_tienda, current_setting('c12.autor')::UUID);
  INSERT INTO public.pedidos (tienda_id, numero) VALUES (v_tienda, 'C12-1') RETURNING id INTO v_pedido;
  INSERT INTO public.clientes (nombre) VALUES ('Cliente C12') RETURNING id INTO v_cliente;

  INSERT INTO public.cliente_tiendas (cliente_id, tienda_id, woo_customer_id) VALUES (v_cliente, v_tienda, 1201);
  UPDATE public.cliente_tiendas SET woo_customer_id = 1202 WHERE cliente_id = v_cliente AND tienda_id = v_tienda;
  DELETE FROM public.cliente_tiendas WHERE cliente_id = v_cliente AND tienda_id = v_tienda;

  INSERT INTO public.pedido_correos_enviados (empresa_id, pedido_id, clave, destinatario, asunto)
  VALUES (v_empresa, v_pedido, 'pedido_enviado', 'cliente@c12.test', 'Tu pedido C12 va de camino')
  RETURNING id INTO v_correo;
  UPDATE public.pedido_correos_enviados SET estado = 'fallido', error = 'C12' WHERE id = v_correo;
  DELETE FROM public.pedido_correos_enviados WHERE id = v_correo;

  INSERT INTO public.enlaces_seguimiento (pedido_id, codigo_seguimiento) VALUES (v_pedido, 'C12-SEG')
  RETURNING id INTO v_enlace;
  UPDATE public.enlaces_seguimiento SET estado = 'entregado' WHERE id = v_enlace;
  DELETE FROM public.enlaces_seguimiento WHERE id = v_enlace;

  INSERT INTO public.tienda_seguimiento_config (tienda_id, transportista, codigo_cuenta, api_key_ref)
  VALUES (v_tienda, 'C12', 'C12-CUENTA', 'clave-c12-que-no-debe-verse')
  RETURNING id INTO v_config;
  UPDATE public.tienda_seguimiento_config SET activo = true WHERE id = v_config;
  DELETE FROM public.tienda_seguimiento_config WHERE id = v_config;

  PERFORM set_config('c12.tienda', v_tienda::TEXT, false);
  PERFORM set_config('c12.empresa', v_empresa::TEXT, false);
  PERFORM set_config('c12.ct', v_cliente::TEXT || '|' || v_tienda::TEXT, false);
  PERFORM set_config('c12.correo', v_correo::TEXT, false);
  PERFORM set_config('c12.enlace', v_enlace::TEXT, false);
  PERFORM set_config('c12.config', v_config::TEXT, false);
END $$;
-- Fin de las escrituras con autor. Sin el COMMIT que lo soltaba, se quita a
-- mano: el punto 7 tiene que ver el autor que pone emitir_factura(), no este.
SELECT set_config('app.usuario_id', '', true);

-- Las tres operaciones de una fila, registradas y con el autor de la escritura.
CREATE OR REPLACE FUNCTION pg_temp.tres_operaciones(_tabla TEXT, _registro TEXT)
RETURNS BOOLEAN LANGUAGE sql AS $$
  SELECT array_agg(a.operacion ORDER BY a.id) = ARRAY['INSERT', 'UPDATE', 'DELETE']
     AND bool_and(a.usuario_id = current_setting('c12.autor')::UUID)
    FROM public.auditoria a
   WHERE a.id > current_setting('c12.desde')::BIGINT
     AND a.tabla = _tabla
     AND a.registro_id = _registro
$$;

-- ---------------------------------------------------------------------------
-- 2-5. Cada tabla deja alta, cambio y baja, con autor
-- ---------------------------------------------------------------------------
SELECT CASE WHEN pg_temp.tres_operaciones('cliente_tiendas', current_setting('c12.ct'))
            THEN 'BIEN  2. cliente_tiendas: alta, cambio y baja registrados con autor; la fila se identifica por (cliente_id, tienda_id)'
            ELSE 'MAL   2. cliente_tiendas no deja las tres operaciones con autor bajo ' || current_setting('c12.ct') END;

SELECT CASE WHEN pg_temp.tres_operaciones('pedido_correos_enviados', current_setting('c12.correo'))
             AND NOT EXISTS (SELECT 1 FROM public.auditoria a
                              WHERE a.id > current_setting('c12.desde')::BIGINT
                                AND a.tabla = 'pedido_correos_enviados'
                                AND a.empresa_id IS DISTINCT FROM current_setting('c12.empresa')::UUID)
            THEN 'BIEN  3. pedido_correos_enviados: alta, cambio y baja registrados con autor y empresa'
            ELSE 'MAL   3. pedido_correos_enviados no deja las tres operaciones con autor y empresa' END;

SELECT CASE WHEN pg_temp.tres_operaciones('enlaces_seguimiento', current_setting('c12.enlace'))
            THEN 'BIEN  4. enlaces_seguimiento: alta, cambio y baja registrados con autor'
            ELSE 'MAL   4. enlaces_seguimiento no deja las tres operaciones con autor' END;

SELECT CASE WHEN pg_temp.tres_operaciones('tienda_seguimiento_config', current_setting('c12.config'))
            THEN 'BIEN  5. tienda_seguimiento_config: alta, cambio y baja registrados con autor'
            ELSE 'MAL   5. tienda_seguimiento_config no deja las tres operaciones con autor' END;

-- ---------------------------------------------------------------------------
-- 6. api_key_ref no llega al registro en claro; el resto de la fila, sí
-- ---------------------------------------------------------------------------
SELECT CASE WHEN count(*) = 4
             AND bool_and(v ->> 'api_key_ref' = '«oculto»')
             AND bool_and(v ->> 'codigo_cuenta' = 'C12-CUENTA')
             AND NOT bool_or(v::TEXT LIKE '%clave-c12-que-no-debe-verse%')
            THEN 'BIEN  6. tienda_seguimiento_config: api_key_ref sale «oculto» en el registro; codigo_cuenta se ve'
            ELSE 'MAL   6. api_key_ref se ha guardado en claro en la auditoría, o falta alguna versión de la fila' END
  FROM public.auditoria a
 CROSS JOIN LATERAL (VALUES (a.datos_antes), (a.datos_despues)) AS d(v)
 WHERE a.id > current_setting('c12.desde')::BIGINT
   AND a.tabla = 'tienda_seguimiento_config'
   AND d.v IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. El contador de la serie: emitir deja rastro, con el autor de la emisión
-- ---------------------------------------------------------------------------
SELECT set_config('c12.desde_emision', (SELECT max(id)::TEXT FROM public.auditoria), false);

DO $$
DECLARE
  v_factura UUID;
  v_serie UUID;
  v_ops TEXT[];
  v_autores BOOLEAN;
  v_ultimo TEXT;
BEGIN
  v_factura := (public.emitir_factura(
    _usuario_id   => current_setting('c12.autor')::UUID,
    _tienda_id    => current_setting('c12.tienda')::UUID,
    _receptor     => '{"nombre":"Cliente C12","nif":"12345678Z"}'::jsonb,
    _lineas       => '[{"descripcion":"x","cantidad":1,"unidad":"ud","precio_unitario":10,"iva_rate":21}]'::jsonb,
    _fecha        => DATE '2036-03-02',
    _simplificada => true) ->> 'id')::UUID;

  SELECT s.id INTO v_serie
    FROM public.series_facturacion s
    JOIN public.facturas f ON f.empresa_id = s.empresa_id AND f.serie = s.serie AND f.ejercicio = s.ejercicio
   WHERE f.id = v_factura;

  SELECT array_agg(a.operacion ORDER BY a.id),
         bool_and(a.usuario_id = current_setting('c12.autor')::UUID),
         (array_agg(a.datos_despues ->> 'ultimo_numero' ORDER BY a.id DESC))[1]
    INTO v_ops, v_autores, v_ultimo
    FROM public.auditoria a
   WHERE a.id > current_setting('c12.desde_emision')::BIGINT
     AND a.tabla = 'series_facturacion'
     AND a.registro_id = v_serie::TEXT;

  IF v_ops = ARRAY['INSERT', 'UPDATE'] AND v_autores AND v_ultimo = '1' THEN
    RAISE NOTICE 'BIEN  7. series_facturacion: la serie nueva de 2036 queda registrada al crearse y al pasar a 1, con el autor de la emisión';
  ELSE
    RAISE WARNING 'MAL   7. series_facturacion: operaciones %, autor correcto %, último número %',
      v_ops, v_autores, v_ultimo;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'MAL   7. la emisión falló: %', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- 8. La cadena sigue intacta con las filas nuevas
-- ---------------------------------------------------------------------------
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.auditoria_verificar())
            THEN 'BIEN  8. la cadena de auditoría sigue intacta'
            ELSE 'MAL   8. la cadena de auditoría está rota: '
                 || (SELECT string_agg(id || ' ' || motivo, '; ') FROM public.auditoria_verificar()) END;

ROLLBACK;

-- ---------------------------------------------------------------------------
-- 9. Deshecha la transacción, no queda nada de la prueba
-- ---------------------------------------------------------------------------
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.tiendas WHERE slug = 'tienda-c12')
             AND NOT EXISTS (SELECT 1 FROM public.clientes WHERE nombre = 'Cliente C12')
             AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = 'c1200000-0000-4000-8000-000000000001')
             AND NOT EXISTS (SELECT 1 FROM public.facturas WHERE ejercicio = 2036)
             AND NOT EXISTS (SELECT 1 FROM public.series_facturacion WHERE ejercicio = 2036)
             AND NOT EXISTS (SELECT 1 FROM public.auditoria
                              WHERE datos_despues ->> 'slug' = 'tienda-c12'
                                 OR datos_despues ->> 'codigo_cuenta' = 'C12-CUENTA')
            THEN 'BIEN  9. deshecha la prueba, no queda ni la tienda C12, ni el autor, ni el ticket de 2036, ni su auditoría'
            ELSE 'MAL   9. la prueba ha dejado datos en la base' END;
