-- ============================================================================
-- Agenda: categorías, tareas e historial
-- ============================================================================
-- Prueba 20261116100000_agenda.sql:
--   1. la semilla deja las seis categorías;
--   2. un editor da de alta una tarea; la empresa es la de la categoría;
--   3. una tarea de categoría Pedido sin pedido se rechaza;
--   4. con hora, el fin tiene que ser posterior al inicio;
--   5. un visor no puede dar de alta una tarea;
--   6. nadie borra una tarea desde el navegador (no hay DELETE);
--   7. marcar hecha pone hecha_en; reabrir lo quita;
--   8. pasarla a otra persona deja vista_en en NULL y apunta «pasada» con quién;
--   9. al crearla queda «creada» en el historial;
--  10. con pedido, congela el texto del enlace;
--  11. borrar el pedido deja la tarea con su texto y sin error;
--  12. el historial no se escribe desde el navegador;
--  13. una categoría sin enlace quita cualquier enlace que llegue.
-- Todo va dentro de una transacción que se deshace al final.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000e2001', 'e2-editor@prueba.test'),
  ('00000000-0000-0000-0000-0000000e2002', 'e2-visor@prueba.test');
INSERT INTO public.user_roles (user_id, role, activo) VALUES
  ('00000000-0000-0000-0000-0000000e2001', 'editor', true),
  ('00000000-0000-0000-0000-0000000e2002', 'visor', true);

DO $$
DECLARE v_emp UUID; v_a UUID; v_b UUID; v_tienda UUID; v_cli UUID; v_ped UUID;
BEGIN
  SELECT id INTO v_emp FROM public.empresas ORDER BY created_at LIMIT 1;
  INSERT INTO public.caja_socios (empresa_id, nombre, orden) VALUES (v_emp, 'E2 Ana', 911) RETURNING id INTO v_a;
  INSERT INTO public.caja_socios (empresa_id, nombre, orden) VALUES (v_emp, 'E2 Berta', 912) RETURNING id INTO v_b;
  SELECT id INTO v_tienda FROM public.tiendas WHERE empresa_id = v_emp ORDER BY created_at LIMIT 1;
  IF v_tienda IS NULL THEN
    INSERT INTO public.tiendas (nombre, empresa_id) VALUES ('E2 tienda', v_emp) RETURNING id INTO v_tienda;
  END IF;
  INSERT INTO public.clientes (tienda_id, empresa_id, nombre) VALUES (v_tienda, v_emp, 'E2 Taller Ruiz') RETURNING id INTO v_cli;
  INSERT INTO public.pedidos (tienda_id, empresa_id, cliente_id, numero) VALUES (v_tienda, v_emp, v_cli, 'E2-1042') RETURNING id INTO v_ped;
  PERFORM set_config('e2.emp', v_emp::TEXT, true);
  PERFORM set_config('e2.a', v_a::TEXT, true);
  PERFORM set_config('e2.b', v_b::TEXT, true);
  PERFORM set_config('e2.ped', v_ped::TEXT, true);
  PERFORM set_config('e2.cli', v_cli::TEXT, true);
  PERFORM set_config('e2.cat_gestion', (SELECT id::TEXT FROM public.agenda_categorias WHERE empresa_id = v_emp AND nombre = 'Gestión'), true);
  PERFORM set_config('e2.cat_pedido', (SELECT id::TEXT FROM public.agenda_categorias WHERE empresa_id = v_emp AND nombre = 'Pedido'), true);
END $$;

-- Ejecuta una sentencia como un usuario con sesión (RLS activa) y devuelve
-- 'ok' o el error.
CREATE FUNCTION pg_temp.e2_como(_usuario UUID, _sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _usuario::TEXT, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM set_config('request.jwt.claim.sub', '', true);
    RETURN 'error: ' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN 'ok';
END $$;

CREATE FUNCTION pg_temp.e2_alta(_titulo TEXT, _cat TEXT, _extra TEXT DEFAULT '') RETURNS TEXT
LANGUAGE sql AS $$
  SELECT format(
    'INSERT INTO public.agenda_tareas (titulo, categoria_id, inicio, de_socio_id, para_socio_id%s) '
    'VALUES (%L, %L, ''2026-11-20 00:00+01'', %L, %L%s)',
    CASE WHEN _extra = '' THEN '' ELSE ', ' || split_part(_extra, '=', 1) END,
    _titulo, _cat, current_setting('e2.a'), current_setting('e2.b'),
    CASE WHEN _extra = '' THEN '' ELSE ', ' || split_part(_extra, '=', 2) END)
$$;

-- 1. Semilla.
SELECT CASE WHEN (SELECT string_agg(nombre, ',' ORDER BY orden) FROM public.agenda_categorias
                   WHERE empresa_id = current_setting('e2.emp')::UUID)
                 = 'Pedido,Cliente,Gestión,Trabajo,Revisión,Otro'
             AND (SELECT enlace FROM public.agenda_categorias WHERE id = current_setting('e2.cat_pedido')::UUID) = 'pedido'
            THEN 'BIEN  1. la semilla deja las seis categorías'
            ELSE 'MAL   1. las categorías de la semilla no son las esperadas' END;

-- 2. Alta por un editor.
SELECT pg_temp.e2_como('00000000-0000-0000-0000-0000000e2001',
  pg_temp.e2_alta('E2 llamar a la gestoría', current_setting('e2.cat_gestion'))) AS r2 \gset
SELECT CASE WHEN :'r2' = 'ok' AND EXISTS (
         SELECT 1 FROM public.agenda_tareas WHERE titulo = 'E2 llamar a la gestoría'
            AND empresa_id = current_setting('e2.emp')::UUID AND estado = 'pendiente')
            THEN 'BIEN  2. un editor da de alta una tarea con la empresa de su categoría'
            ELSE 'MAL   2. el editor no ha podido dar de alta la tarea: ' || :'r2' END;

-- 3. Pedido sin pedido.
SELECT pg_temp.e2_como('00000000-0000-0000-0000-0000000e2001',
  pg_temp.e2_alta('E2 sin pedido', current_setting('e2.cat_pedido'))) AS r3 \gset
SELECT CASE WHEN :'r3' LIKE 'error:%tiene que llevar un pedido%'
            THEN 'BIEN  3. una tarea de categoría Pedido sin pedido se rechaza'
            ELSE 'MAL   3. se ha aceptado una tarea de Pedido sin pedido: ' || :'r3' END;

-- 4. Con hora, fin posterior al inicio.
SELECT pg_temp.e2_como('00000000-0000-0000-0000-0000000e2001',
  format('INSERT INTO public.agenda_tareas (titulo, categoria_id, todo_el_dia, inicio, fin, de_socio_id, para_socio_id) '
         'VALUES (''E2 horas'', %L, false, ''2026-11-20 10:00+01'', ''2026-11-20 09:00+01'', %L, %L)',
         current_setting('e2.cat_gestion'), current_setting('e2.a'), current_setting('e2.b'))) AS r4 \gset
SELECT CASE WHEN :'r4' LIKE 'error:%agenda_tarea_horas%'
            THEN 'BIEN  4. con hora, el fin tiene que ser posterior al inicio'
            ELSE 'MAL   4. se ha aceptado una tarea que acaba antes de empezar: ' || :'r4' END;

-- 5. Visor.
SELECT pg_temp.e2_como('00000000-0000-0000-0000-0000000e2002',
  pg_temp.e2_alta('E2 del visor', current_setting('e2.cat_gestion'))) AS r5 \gset
SELECT CASE WHEN :'r5' LIKE 'error:%' AND NOT EXISTS (SELECT 1 FROM public.agenda_tareas WHERE titulo = 'E2 del visor')
            THEN 'BIEN  5. un visor no puede dar de alta una tarea'
            ELSE 'MAL   5. un visor ha dado de alta una tarea' END;

-- 6. Sin DELETE.
SELECT pg_temp.e2_como('00000000-0000-0000-0000-0000000e2001',
  'DELETE FROM public.agenda_tareas WHERE titulo = ''E2 llamar a la gestoría''') AS r6 \gset
SELECT CASE WHEN :'r6' LIKE 'error:%' AND EXISTS (SELECT 1 FROM public.agenda_tareas WHERE titulo = 'E2 llamar a la gestoría')
            THEN 'BIEN  6. nadie borra una tarea desde el navegador'
            ELSE 'MAL   6. se ha podido borrar una tarea' END;

-- 7. Hecha y reabierta.
SELECT pg_temp.e2_como('00000000-0000-0000-0000-0000000e2001',
  format('UPDATE public.agenda_tareas SET estado = ''hecha'', cambio_socio_id = %L WHERE titulo = ''E2 llamar a la gestoría''',
         current_setting('e2.b'))) AS r7a \gset
SELECT (SELECT hecha_en IS NOT NULL FROM public.agenda_tareas WHERE titulo = 'E2 llamar a la gestoría') AS hecha7 \gset
SELECT pg_temp.e2_como('00000000-0000-0000-0000-0000000e2001',
  'UPDATE public.agenda_tareas SET estado = ''pendiente'' WHERE titulo = ''E2 llamar a la gestoría''') AS r7b \gset
SELECT CASE WHEN :'r7a' = 'ok' AND :'r7b' = 'ok' AND :'hecha7' = 't'
             AND (SELECT hecha_en IS NULL FROM public.agenda_tareas WHERE titulo = 'E2 llamar a la gestoría')
            THEN 'BIEN  7. marcar hecha pone hecha_en; reabrir lo quita'
            ELSE 'MAL   7. hecha_en no sigue al estado: ' || :'r7a' || ' / ' || :'r7b' END;

-- 8. Pasarla.
UPDATE public.agenda_tareas SET vista_en = now() WHERE titulo = 'E2 llamar a la gestoría';
SELECT pg_temp.e2_como('00000000-0000-0000-0000-0000000e2001',
  format('UPDATE public.agenda_tareas SET para_socio_id = %L, cambio_socio_id = %L WHERE titulo = ''E2 llamar a la gestoría''',
         current_setting('e2.a'), current_setting('e2.b'))) AS r8 \gset
SELECT CASE WHEN :'r8' = 'ok'
             AND (SELECT vista_en IS NULL FROM public.agenda_tareas WHERE titulo = 'E2 llamar a la gestoría')
             AND EXISTS (SELECT 1 FROM public.agenda_tarea_historial h JOIN public.agenda_tareas t ON t.id = h.tarea_id
                          WHERE t.titulo = 'E2 llamar a la gestoría' AND h.accion = 'pasada'
                            AND h.socio_id = current_setting('e2.b')::UUID
                            AND h.para_antes = current_setting('e2.b')::UUID
                            AND h.para_despues = current_setting('e2.a')::UUID)
            THEN 'BIEN  8. pasarla le sale como nueva al otro y queda en el historial con quién'
            ELSE 'MAL   8. pasar la tarea no ha dejado vista_en en NULL o no está en el historial: ' || :'r8' END;

-- 9. Historial completo de esa tarea.
SELECT CASE WHEN (SELECT string_agg(h.accion, ',' ORDER BY h.id) FROM public.agenda_tarea_historial h
                    JOIN public.agenda_tareas t ON t.id = h.tarea_id WHERE t.titulo = 'E2 llamar a la gestoría')
                 = 'creada,hecha,reabierta,pasada'
            THEN 'BIEN  9. el historial apunta creada, hecha, reabierta y pasada (marcar vista no)'
            ELSE 'MAL   9. historial inesperado: ' || COALESCE((SELECT string_agg(h.accion, ',' ORDER BY h.id)
                    FROM public.agenda_tarea_historial h JOIN public.agenda_tareas t ON t.id = h.tarea_id
                   WHERE t.titulo = 'E2 llamar a la gestoría'), '(nada)') END;

-- 10. Con pedido.
SELECT pg_temp.e2_como('00000000-0000-0000-0000-0000000e2001',
  pg_temp.e2_alta('E2 revisar arte', current_setting('e2.cat_pedido'),
                  'pedido_id=' || quote_literal(current_setting('e2.ped')))) AS r10 \gset
SELECT CASE WHEN :'r10' = 'ok'
             AND (SELECT enlace_texto FROM public.agenda_tareas WHERE titulo = 'E2 revisar arte') = 'Pedido E2-1042 · E2 Taller Ruiz'
            THEN 'BIEN 10. con pedido, congela el texto del enlace'
            ELSE 'MAL  10. el enlace del pedido no se ha guardado: ' || :'r10' END;

-- 11. Borrar el pedido.
DELETE FROM public.pedidos WHERE id = current_setting('e2.ped')::UUID;
SELECT CASE WHEN (SELECT pedido_id IS NULL AND enlace_texto = 'Pedido E2-1042 · E2 Taller Ruiz'
                    FROM public.agenda_tareas WHERE titulo = 'E2 revisar arte')
            THEN 'BIEN 11. borrar el pedido deja la tarea con su texto'
            ELSE 'MAL  11. la tarea ha perdido el texto del pedido borrado' END;

-- 12. Historial cerrado al navegador.
SELECT pg_temp.e2_como('00000000-0000-0000-0000-0000000e2001',
  format('INSERT INTO public.agenda_tarea_historial (empresa_id, tarea_id, accion) '
         'SELECT empresa_id, id, ''hecha'' FROM public.agenda_tareas WHERE titulo = ''E2 revisar arte''')) AS r12 \gset
SELECT CASE WHEN :'r12' LIKE 'error:%'
            THEN 'BIEN 12. el historial no se escribe desde el navegador'
            ELSE 'MAL  12. se ha escrito en el historial desde el navegador' END;

-- 13. Sin enlace quita el que llegue.
SELECT pg_temp.e2_como('00000000-0000-0000-0000-0000000e2001',
  pg_temp.e2_alta('E2 gestion con cliente', current_setting('e2.cat_gestion'),
                  'cliente_id=' || quote_literal(current_setting('e2.cli')))) AS r13 \gset
SELECT CASE WHEN :'r13' = 'ok' AND (SELECT cliente_id IS NULL AND enlace_texto IS NULL
                                       FROM public.agenda_tareas WHERE titulo = 'E2 gestion con cliente')
            THEN 'BIEN 13. una categoría sin enlace quita el enlace que llegue'
            ELSE 'MAL  13. una tarea sin enlace ha guardado un cliente: ' || :'r13' END;

ROLLBACK;
