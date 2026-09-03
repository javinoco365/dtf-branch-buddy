-- ============================================================================
-- Plantillas de correo por tienda
-- ============================================================================

-- 1. Cada tienda arranca con su plantilla de "pedido enviado".
SELECT CASE WHEN count(*) = (SELECT count(*) FROM public.tiendas WHERE empresa_id IS NOT NULL)
            THEN 'BIEN  1. cada tienda arranca con su plantilla'
            ELSE 'MAL   1. ' || count(*) || ' plantillas para '
                 || (SELECT count(*) FROM public.tiendas WHERE empresa_id IS NOT NULL) || ' tiendas' END
FROM public.tienda_plantillas_correo WHERE clave = 'pedido_enviado';

-- 2. Una tienda no puede tener dos plantillas del mismo tipo.
DO $$
BEGIN
  INSERT INTO public.tienda_plantillas_correo (empresa_id, tienda_id, clave, asunto, cuerpo)
  SELECT empresa_id, tienda_id, clave, 'Duplicada', 'x'
  FROM public.tienda_plantillas_correo LIMIT 1;
  RAISE NOTICE 'MAL   2. dejó duplicar la plantilla de una tienda';
EXCEPTION WHEN unique_violation THEN
  RAISE NOTICE 'BIEN  2. una tienda no puede tener dos plantillas del mismo tipo';
END $$;

-- 3. Sembrar de nuevo no pisa lo que hayas escrito.
UPDATE public.tienda_plantillas_correo SET asunto = 'Mi asunto propio';

INSERT INTO public.tienda_plantillas_correo (empresa_id, tienda_id, clave, asunto, cuerpo)
SELECT t.empresa_id, t.id, 'pedido_enviado', 'Asunto de fábrica', 'x'
FROM public.tiendas t WHERE t.empresa_id IS NOT NULL
ON CONFLICT (tienda_id, clave) DO NOTHING;

SELECT CASE WHEN bool_and(asunto = 'Mi asunto propio')
            THEN 'BIEN  3. volver a sembrar no pisa lo ya escrito'
            ELSE 'MAL   3. se ha sobrescrito una plantilla editada' END
FROM public.tienda_plantillas_correo;

-- 4. La edición queda auditada y con autor.
BEGIN;
  SET LOCAL ROLE service_role;
  SELECT set_config('request.headers',
    '{"x-usuario-id":"11111111-1111-4111-8111-111111111111"}', true);
  UPDATE public.tienda_plantillas_correo SET cuerpo = cuerpo || ' (retocado)';
COMMIT;

SELECT CASE WHEN usuario_id = '11111111-1111-4111-8111-111111111111'
            THEN 'BIEN  4. cambiar una plantilla queda auditado y con autor'
            ELSE 'MAL   4. autor ' || COALESCE(usuario_id::TEXT, 'NULL') END
FROM public.auditoria
WHERE tabla = 'tienda_plantillas_correo' ORDER BY id DESC LIMIT 1;

-- 5. No hay política de borrado: una plantilla se desactiva, no se borra.
SELECT CASE WHEN count(*) = 0
            THEN 'BIEN  5. sin política de DELETE: se desactiva, no se borra'
            ELSE 'MAL   5. hay ' || count(*) || ' política(s) de borrado' END
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'tienda_plantillas_correo' AND cmd = 'DELETE';
