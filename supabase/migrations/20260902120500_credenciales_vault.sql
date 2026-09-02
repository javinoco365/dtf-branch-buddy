-- ============================================================================
-- CIMIENTOS 6/6 · Credenciales de WooCommerce en Vault
-- ============================================================================
--
-- QUÉ HACE
--   Añade a tienda_credenciales dos columnas con la referencia al secreto en
--   Supabase Vault, y dos funciones para guardar y leer las credenciales sin
--   que pasen nunca por una tabla en claro.
--
-- POR QUÉ
--   Hoy consumer_key y consumer_secret son columnas TEXT. La RLS está bien
--   puesta (ningún usuario autenticado las lee, solo el rol de servicio), pero
--   siguen en claro dentro de la base y, por tanto, dentro de cada copia de
--   seguridad y de cada volcado que alguien se lleve.
--
-- QUÉ NO HACE
--   No borra las columnas en claro. Primero hay que migrar los valores con
--   tienda_credenciales_guardar() y comprobar que la sincronización sigue
--   funcionando; la retirada de las columnas viejas va en una migración
--   posterior, y ese sí es un borrado de datos reales que tienes que aprobar
--   viendo que ya están en Vault.
--
-- DESPUÉS DE APLICAR ESTA MIGRACIÓN
--   1. Ejecuta el bloque de traslado del final (está comentado).
--   2. Comprueba que la sincronización de una tienda sigue funcionando.
--   3. ROTA LAS CLAVES EN WOOCOMMERCE. Han estado en claro en la base y en
--      todas las copias de seguridad: darlas por comprometidas es lo prudente.
--   4. Solo entonces se retiran las columnas viejas.
--
-- OJO, HAY UN FALLO VIVO QUE ESTO NO ARREGLA
--   getWooCreds() en src/lib/pedidos.functions.ts:49-54 selecciona
--   woo_consumer_key y woo_consumer_secret, columnas que NO EXISTEN: se llaman
--   consumer_key y consumer_secret. Esa función devuelve siempre null, así que
--   el empuje del estado del pedido a WooCommerce nunca ha funcionado. Se
--   arregla aparte.
--
-- REVERSIBLE
--   Sí. Nada se borra: se añaden columnas y funciones.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

ALTER TABLE public.tienda_credenciales
  ADD COLUMN IF NOT EXISTS consumer_key_secret_id UUID,
  ADD COLUMN IF NOT EXISTS consumer_secret_secret_id UUID;

COMMENT ON COLUMN public.tienda_credenciales.consumer_key_secret_id IS
  'Referencia al secreto en vault.secrets. El valor no vive aquí.';
COMMENT ON COLUMN public.tienda_credenciales.consumer_key IS
  'OBSOLETA. En claro. Migrar a Vault y retirar en una migración posterior.';
COMMENT ON COLUMN public.tienda_credenciales.consumer_secret IS
  'OBSOLETA. En claro. Migrar a Vault y retirar en una migración posterior.';

-- ---------------------------------------------------------------------------
-- Guardar
-- ---------------------------------------------------------------------------
-- Crea o actualiza los dos secretos de una tienda. Solo la ejecuta el rol de
-- servicio, desde una server function que ya ha comprobado que quien llama es
-- administrador.
CREATE OR REPLACE FUNCTION public.tienda_credenciales_guardar(
  _tienda_id UUID,
  _consumer_key TEXT,
  _consumer_secret TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id_key UUID;
  v_id_secret UUID;
BEGIN
  SELECT consumer_key_secret_id, consumer_secret_secret_id
    INTO v_id_key, v_id_secret
    FROM public.tienda_credenciales WHERE tienda_id = _tienda_id;

  IF v_id_key IS NULL THEN
    v_id_key := vault.create_secret(
      _consumer_key, 'woo_ck_' || _tienda_id::TEXT, 'Consumer key de WooCommerce');
  ELSE
    PERFORM vault.update_secret(v_id_key, _consumer_key);
  END IF;

  IF v_id_secret IS NULL THEN
    v_id_secret := vault.create_secret(
      _consumer_secret, 'woo_cs_' || _tienda_id::TEXT, 'Consumer secret de WooCommerce');
  ELSE
    PERFORM vault.update_secret(v_id_secret, _consumer_secret);
  END IF;

  INSERT INTO public.tienda_credenciales (
    tienda_id, consumer_key, consumer_secret,
    consumer_key_secret_id, consumer_secret_secret_id)
  VALUES (_tienda_id, '', '', v_id_key, v_id_secret)
  ON CONFLICT (tienda_id) DO UPDATE SET
    consumer_key_secret_id = EXCLUDED.consumer_key_secret_id,
    consumer_secret_secret_id = EXCLUDED.consumer_secret_secret_id,
    updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tienda_credenciales_guardar(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tienda_credenciales_guardar(UUID, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- Leer
-- ---------------------------------------------------------------------------
-- Devuelve las credenciales descifradas. Mientras dure la transición, cae a
-- las columnas en claro si la tienda todavía no está migrada.
CREATE OR REPLACE FUNCTION public.tienda_credenciales_leer(_tienda_id UUID)
RETURNS TABLE (consumer_key TEXT, consumer_secret TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fila RECORD;
BEGIN
  SELECT * INTO v_fila FROM public.tienda_credenciales tc WHERE tc.tienda_id = _tienda_id;
  IF NOT FOUND THEN RETURN; END IF;

  consumer_key := COALESCE(
    (SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds
      WHERE ds.id = v_fila.consumer_key_secret_id),
    NULLIF(v_fila.consumer_key, ''));

  consumer_secret := COALESCE(
    (SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds
      WHERE ds.id = v_fila.consumer_secret_secret_id),
    NULLIF(v_fila.consumer_secret, ''));

  IF consumer_key IS NULL OR consumer_secret IS NULL THEN RETURN; END IF;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tienda_credenciales_leer(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tienda_credenciales_leer(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- Traslado de lo que ya hay
-- ---------------------------------------------------------------------------
-- Descomenta y ejecuta esto DESPUÉS de aplicar la migración, cuando quieras
-- mover las credenciales existentes. Va aparte porque escribe en Vault y
-- conviene hacerlo mirando.
--
-- DO $$
-- DECLARE r RECORD;
-- BEGIN
--   FOR r IN
--     SELECT tienda_id, consumer_key, consumer_secret
--     FROM public.tienda_credenciales
--     WHERE consumer_key_secret_id IS NULL
--       AND COALESCE(consumer_key, '') <> ''
--   LOOP
--     PERFORM public.tienda_credenciales_guardar(
--       r.tienda_id, r.consumer_key, r.consumer_secret);
--     RAISE NOTICE 'Credenciales de la tienda % trasladadas a Vault', r.tienda_id;
--   END LOOP;
-- END $$;
