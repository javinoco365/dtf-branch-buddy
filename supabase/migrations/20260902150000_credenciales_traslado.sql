-- ============================================================================
-- CREDENCIALES · Traslado a Vault de lo que ya hay
-- ============================================================================
--
-- QUÉ HACE
--   1. Corrige tienda_credenciales_guardar(): al guardar, deja vacías las
--      columnas en claro de esa tienda.
--   2. Traslada a Vault las credenciales que hoy están en claro.
--
-- POR QUÉ EL PUNTO 1
--   La versión anterior guardaba el secreto en Vault pero no tocaba las
--   columnas viejas. Resultado: cada vez que alguien cambiara las credenciales
--   desde Ajustes, la clave ANTERIOR se quedaba en claro en la tabla para
--   siempre. Guardar una credencial nueva no puede dejar la vieja tirada.
--
--   Vaciar esas dos columnas no pierde nada: el valor acaba de escribirse en
--   Vault en la misma transacción, y tienda_credenciales_leer() mira Vault
--   primero.
--
-- QUÉ NO HACE, A PROPÓSITO
--   No vacía las columnas de las filas que traslada en el punto 2, y no
--   retira las columnas. El traslado masivo es una copia y nada más, para que
--   el camino de vuelta siga existiendo mientras compruebas que la
--   sincronización lee bien desde Vault. La limpieza va aparte y la apruebas tú
--   viendo que funciona.
--
-- QUÉ TIENES QUE HACER DESPUÉS
--   1. Aplicar esta migración.
--   2. Sincronizar una tienda y ver que sigue funcionando: eso demuestra que
--      se está leyendo desde Vault.
--   3. ROTAR LAS CLAVES EN WOOCOMMERCE. Han estado en claro en la base y en
--      todas las copias de seguridad. Darlas por comprometidas es lo prudente,
--      y rotarlas es lo único que arregla eso de verdad.
--   4. Entonces, y solo entonces, vaciar las columnas y retirarlas.
--
-- REVERSIBLE
--   El traslado sí: no borra nada, solo copia a Vault. El cambio de la función
--   es un CREATE OR REPLACE.
-- ============================================================================

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

  -- El valor ya está en Vault. Las columnas en claro se quedan vacías: si no,
  -- cambiar las credenciales dejaría las anteriores tiradas en la tabla.
  INSERT INTO public.tienda_credenciales (
    tienda_id, consumer_key, consumer_secret,
    consumer_key_secret_id, consumer_secret_secret_id)
  VALUES (_tienda_id, '', '', v_id_key, v_id_secret)
  ON CONFLICT (tienda_id) DO UPDATE SET
    consumer_key = '',
    consumer_secret = '',
    consumer_key_secret_id = EXCLUDED.consumer_key_secret_id,
    consumer_secret_secret_id = EXCLUDED.consumer_secret_secret_id,
    updated_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tienda_credenciales_guardar(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tienda_credenciales_guardar(UUID, TEXT, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- El traslado
-- ---------------------------------------------------------------------------
-- Idempotente: solo toca las tiendas que todavía no tienen referencia a Vault.
-- Volver a ejecutarlo no duplica secretos ni pisa nada.
--
-- Copia el valor a Vault y deja la columna en claro donde está. La copia se
-- hace fuera de tienda_credenciales_guardar() precisamente para no vaciarla:
-- mientras no compruebes que la sincronización lee bien desde Vault, quieres
-- el camino de vuelta.
DO $traslado$
DECLARE
  r RECORD;
  v_id_key UUID;
  v_id_secret UUID;
  v_total INT := 0;
BEGIN
  FOR r IN
    SELECT tienda_id, consumer_key, consumer_secret
    FROM public.tienda_credenciales
    WHERE consumer_key_secret_id IS NULL
      AND COALESCE(consumer_key, '') <> ''
  LOOP
    v_id_key := vault.create_secret(
      r.consumer_key, 'woo_ck_' || r.tienda_id::TEXT, 'Consumer key de WooCommerce');
    v_id_secret := vault.create_secret(
      r.consumer_secret, 'woo_cs_' || r.tienda_id::TEXT, 'Consumer secret de WooCommerce');

    UPDATE public.tienda_credenciales
      SET consumer_key_secret_id = v_id_key,
          consumer_secret_secret_id = v_id_secret
      WHERE tienda_id = r.tienda_id;

    v_total := v_total + 1;
    RAISE NOTICE 'Tienda %: credenciales copiadas a Vault', r.tienda_id;
  END LOOP;

  IF v_total = 0 THEN
    RAISE NOTICE 'No había credenciales en claro que trasladar.';
  ELSE
    RAISE NOTICE '% tienda(s) trasladada(s). Las columnas en claro siguen ahí a propósito.', v_total;
  END IF;
END
$traslado$;
