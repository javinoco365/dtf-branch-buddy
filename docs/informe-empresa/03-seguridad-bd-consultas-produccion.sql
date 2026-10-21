-- ============================================================================
-- Informe 03 · Seguridad de la base de datos: consultas para producción
-- ============================================================================
-- SOLO LECTURA. Ninguna cambia nada. Pensadas para pegarlas, una a una, en el
-- SQL Editor de Supabase y leer el resultado. Están probadas sobre el banco
-- local (PostgreSQL 16 + todas las migraciones), no sobre producción: el
-- auditor no tiene acceso a producción.
--
-- Ninguna devuelve secretos: donde hay credenciales solo dicen si la columna
-- tiene algo (true/false).
-- ============================================================================

-- P1. Vistas del esquema public que se saltan la RLS (sin security_invoker) y
--     quién puede leerlas. Una fila con anon = true es una fuga sin sesión.
--     Esperado tras arreglar: ninguna fila con invoker = false.
SELECT c.relname AS vista,
       COALESCE('security_invoker=true' = ANY (c.reloptions)
                OR 'security_invoker=on' = ANY (c.reloptions), false) AS invoker,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm')
 ORDER BY 2, 1;

-- P2. Políticas abiertas o FOR ALL en public y storage (punto pendiente de
--     docs/pendiente_auditoria.md: «ninguna política abierta en las tablas de
--     dinero»). Esperado tras arreglar: ninguna fila salvo logos_lectura_publica.
SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
  FROM pg_policies
 WHERE schemaname IN ('public', 'storage')
   AND (cmd = 'ALL' OR qual = 'true' OR with_check = 'true'
        OR qual IN ('(bucket_id = ''compras''::text)'))
 ORDER BY 1, 2, 4;

-- P3. Funciones SECURITY DEFINER que un usuario con sesión (authenticated) o
--     sin ella (anon) puede llamar por /rest/v1/rpc. Las de trigger no cuentan.
SELECT p.oid::regprocedure AS funcion,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       p.proconfig
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
   AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype)
   AND (has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
 ORDER BY 2 DESC, 1;

-- P4. Cuentas que no son de nadie: ni rol ni tienda. Si sale alguna que no
--     reconocéis, alguien se ha dado de alta solo (registro público abierto).
SELECT u.id, u.email, u.created_at, u.last_sign_in_at
  FROM auth.users u
 WHERE NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM public.tienda_usuarios t WHERE t.user_id = u.id)
 ORDER BY u.created_at DESC;

-- P5. Usuarios con acceso y sus factores de doble autenticación (MFA).
SELECT u.email,
       EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'admin') AS admin,
       (SELECT count(*) FROM auth.mfa_factors f WHERE f.user_id = u.id AND f.status = 'verified') AS factores_mfa
  FROM auth.users u
 ORDER BY 2 DESC, 1;

-- P6. Credenciales de WooCommerce todavía en claro (solo dice si hay algo).
SELECT t.nombre AS tienda,
       COALESCE(tc.consumer_key, '') <> '' AS clave_en_claro,
       COALESCE(tc.consumer_secret, '') <> '' AS secreto_en_claro,
       tc.consumer_key_secret_id IS NOT NULL AS clave_en_vault,
       tc.consumer_secret_secret_id IS NOT NULL AS secreto_en_vault
  FROM public.tienda_credenciales tc
  JOIN public.tiendas t ON t.id = tc.tienda_id
 ORDER BY 1;

-- P7. Privilegios de tabla que la RLS no controla: TRUNCATE salta la RLS y los
--     triggers de fila (y con ellos la auditoría). PostgREST no lo expone, pero
--     no hace falta que estén.
SELECT c.relname,
       has_table_privilege('anon', c.oid, 'TRUNCATE') AS anon_truncate,
       has_table_privilege('authenticated', c.oid, 'TRUNCATE') AS auth_truncate
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
   AND (has_table_privilege('anon', c.oid, 'TRUNCATE')
        OR has_table_privilege('authenticated', c.oid, 'TRUNCATE'))
 ORDER BY 1;

-- P8. Buckets: públicos, límite de tamaño y tipos admitidos.
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY 1;

-- P9. Ancla de la cadena de auditoría: anotad este hash FUERA de Supabase
--     (correo a los tres socios, por ejemplo). Si mañana auditoria_verificar()
--     da 0 pero este hash ya no está en la tabla, la cadena se ha reescrito.
SELECT id, created_at, hash FROM public.auditoria ORDER BY id DESC LIMIT 1;
SELECT count(*) AS eslabones_rotos FROM public.auditoria_verificar();

-- P10. Cambios auditados sin autor en los últimos 90 días, por tabla. Los de
--      la sincronización de WooCommerce y los webhooks son legítimos; el resto
--      es una escritura con supabaseAdmin sin adminComoUsuario().
SELECT tabla, operacion, count(*) AS cambios_sin_autor
  FROM public.auditoria
 WHERE usuario_id IS NULL AND created_at > now() - interval '90 days'
 GROUP BY 1, 2 ORDER BY 3 DESC;
