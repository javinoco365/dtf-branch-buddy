-- ============================================================================
-- Credenciales de WooCommerce: que salgan de la tabla en claro
-- ============================================================================

-- Una tienda con credenciales en claro, como estaban antes del traslado.
DO $$
DECLARE v_empresa UUID; v_tienda UUID;
BEGIN
  SELECT id INTO v_empresa FROM public.empresas LIMIT 1;
  INSERT INTO public.tiendas (nombre, woo_url, sync_enabled, empresa_id)
  VALUES ('Tienda de prueba', 'https://ejemplo.test', true, v_empresa)
  RETURNING id INTO v_tienda;

  INSERT INTO public.tienda_credenciales (tienda_id, consumer_key, consumer_secret)
  VALUES (v_tienda, 'ck_en_claro_viejo', 'cs_en_claro_viejo');

  PERFORM set_config('prueba.tienda', v_tienda::TEXT, false);
END $$;

-- 1. Antes del traslado se lee de la columna en claro (el respaldo funciona).
SELECT CASE WHEN consumer_key = 'ck_en_claro_viejo' THEN 'BIEN  1. sin trasladar, se lee de la columna vieja'
            ELSE 'MAL   1. leyó ' || COALESCE(consumer_key, 'NULL') END
FROM public.tienda_credenciales_leer(current_setting('prueba.tienda')::UUID);

-- 2. El traslado copia a Vault sin tocar la columna en claro.
DO $traslado$
DECLARE r RECORD; v_id_key UUID; v_id_secret UUID;
BEGIN
  FOR r IN
    SELECT tienda_id, consumer_key, consumer_secret FROM public.tienda_credenciales
    WHERE consumer_key_secret_id IS NULL AND COALESCE(consumer_key, '') <> ''
  LOOP
    v_id_key := vault.create_secret(r.consumer_key, 'woo_ck_' || r.tienda_id::TEXT, 'ck');
    v_id_secret := vault.create_secret(r.consumer_secret, 'woo_cs_' || r.tienda_id::TEXT, 'cs');
    UPDATE public.tienda_credenciales
      SET consumer_key_secret_id = v_id_key, consumer_secret_secret_id = v_id_secret
      WHERE tienda_id = r.tienda_id;
  END LOOP;
END
$traslado$;

SELECT CASE WHEN consumer_key_secret_id IS NOT NULL AND consumer_key = 'ck_en_claro_viejo'
            THEN 'BIEN  2. traslado: copia a Vault y no borra el camino de vuelta'
            ELSE 'MAL   2. el traslado no dejó las cosas como debía' END
FROM public.tienda_credenciales WHERE tienda_id = current_setting('prueba.tienda')::UUID;

-- 3. Ya trasladada, se lee de Vault y no de la columna.
UPDATE public.tienda_credenciales
  SET consumer_key = 'NO_DEBE_LEERSE', consumer_secret = 'NO_DEBE_LEERSE'
  WHERE tienda_id = current_setting('prueba.tienda')::UUID;

SELECT CASE WHEN consumer_key = 'ck_en_claro_viejo' THEN 'BIEN  3. trasladada, se lee de Vault'
            ELSE 'MAL   3. leyó ' || COALESCE(consumer_key, 'NULL') END
FROM public.tienda_credenciales_leer(current_setting('prueba.tienda')::UUID);

-- 4. Guardar credenciales nuevas no deja la anterior en claro.
--    Es el fallo que arregla 20260902150000: antes, cambiar la clave dejaba la
--    vieja tirada en la tabla para siempre.
SELECT public.tienda_credenciales_guardar(
  current_setting('prueba.tienda')::UUID, 'ck_nueva', 'cs_nueva');

SELECT CASE WHEN COALESCE(consumer_key, '') = '' AND COALESCE(consumer_secret, '') = ''
            THEN 'BIEN  4. guardar deja las columnas en claro vacías'
            ELSE 'MAL   4. quedó en claro: ' || consumer_key END
FROM public.tienda_credenciales WHERE tienda_id = current_setting('prueba.tienda')::UUID;

-- 5. ...y lo nuevo se lee bien.
SELECT CASE WHEN consumer_key = 'ck_nueva' AND consumer_secret = 'cs_nueva'
            THEN 'BIEN  5. las credenciales nuevas se leen desde Vault'
            ELSE 'MAL   5. leyó ' || COALESCE(consumer_key, 'NULL') END
FROM public.tienda_credenciales_leer(current_setting('prueba.tienda')::UUID);

-- 6. El traslado es idempotente: repetirlo no duplica ni pisa.
DO $repetir$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tienda_id, consumer_key, consumer_secret FROM public.tienda_credenciales
    WHERE consumer_key_secret_id IS NULL AND COALESCE(consumer_key, '') <> ''
  LOOP
    RAISE NOTICE 'MAL 6. el traslado volvería a tocar la tienda %', r.tienda_id;
  END LOOP;
  RAISE NOTICE 'BIEN  6. repetir el traslado no toca nada';
END
$repetir$;

-- 7. La auditoría no filtra el secreto.
SELECT CASE
  WHEN bool_and(
    (datos_despues ->> 'consumer_key') IS DISTINCT FROM 'ck_en_claro_viejo'
    AND (datos_despues ->> 'consumer_secret') IS DISTINCT FROM 'cs_en_claro_viejo'
    AND (datos_antes ->> 'consumer_key') IS DISTINCT FROM 'ck_en_claro_viejo')
  THEN 'BIEN  7. la auditoría enmascara las credenciales'
  ELSE 'MAL   7. hay una credencial en claro en el registro de auditoría' END
FROM public.auditoria WHERE tabla = 'tienda_credenciales';

-- ---------------------------------------------------------------------------
-- 8-10. El identificador de fila en tablas sin columna "id"
-- ---------------------------------------------------------------------------
-- Regresión de 20260902160000: el hash se calculaba con '' y se guardaba '?',
-- así que toda escritura en una tabla sin columna id rompía la verificación
-- para siempre.
SELECT CASE WHEN registro_id = current_setting('prueba.tienda')
            THEN 'BIEN  8. tabla con clave propia: registro_id es la clave, no ''?'''
            ELSE 'MAL   8. registro_id salió ' || registro_id END
FROM public.auditoria
WHERE tabla = 'tienda_credenciales' ORDER BY id DESC LIMIT 1;

-- Clave compuesta: las dos partes, unidas.
DO $$
DECLARE v_usuario UUID := '11111111-1111-1111-1111-111111111111';
BEGIN
  INSERT INTO public.tienda_usuarios (tienda_id, user_id)
  VALUES (current_setting('prueba.tienda')::UUID, v_usuario);
END $$;

SELECT CASE WHEN registro_id = current_setting('prueba.tienda')
                              || '|11111111-1111-1111-1111-111111111111'
            THEN 'BIEN  9. clave compuesta: las dos partes en el identificador'
            ELSE 'MAL   9. registro_id salió ' || registro_id END
FROM public.auditoria
WHERE tabla = 'tienda_usuarios' ORDER BY id DESC LIMIT 1;

SELECT CASE WHEN count(*) = 0
            THEN 'BIEN 10. escribir en tablas sin id no rompe la cadena'
            ELSE 'MAL  10. ' || count(*) || ' eslabón(es) rotos' END
FROM public.auditoria_verificar();
