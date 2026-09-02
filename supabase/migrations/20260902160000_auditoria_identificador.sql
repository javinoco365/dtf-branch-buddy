-- ============================================================================
-- AUDITORÍA · La huella tiene que cubrir lo que de verdad se guarda
-- ============================================================================
--
-- EL FALLO
--   auditoria_registrar() sacaba el identificador de la fila así:
--
--     v_registro := (to_jsonb(NEW) ->> 'id');
--
--   y luego usaba DOS valores distintos para lo mismo:
--
--     COALESCE(v_registro, '')    -- lo que entraba en el hash
--     COALESCE(v_registro, '?')   -- lo que se guardaba en registro_id
--
--   En una tabla sin columna `id`, v_registro es NULL: la huella se calcula
--   sobre '' y se almacena '?'. auditoria_verificar() recalcula sobre lo
--   almacenado y nunca puede cuadrar.
--
-- POR QUÉ IMPORTA
--   Hay dos tablas auditadas sin columna `id`: tienda_credenciales (clave
--   primaria tienda_id) y tienda_usuarios (clave compuesta). Basta guardar
--   unas credenciales de WooCommerce o asignar un usuario a una tienda para
--   que la verificación empiece a denunciar la cadena, y no deje de hacerlo.
--
--   Una cadena rota es indistinguible de una manipulación. Un registro que
--   grita «alterado» por un fallo propio deja de servir para lo único que
--   sirve, que es demostrar que nadie lo tocó.
--
--   Y de paso, todas esas filas se guardaban con registro_id = '?', así que
--   tampoco se sabía a qué fila se referían.
--
-- EL ARREGLO
--   auditoria_identificador() saca el identificador de la clave primaria
--   cuando no hay columna `id`, y nunca devuelve NULL. El trigger guarda y
--   cifra exactamente el mismo valor, que era el error de fondo: dos
--   expresiones para una sola cosa.
--
-- LAS FILAS YA ESCRITAS
--   No se tocan. La tabla auditoria es append-only por diseño y reescribir
--   huellas para que cuadren es justo lo que un registro de auditoría existe
--   para impedir. Las filas afectadas seguirán señaladas; mira al final de
--   este fichero cómo contarlas y decidir.
--
-- REVERSIBLE
--   Sí. Son CREATE OR REPLACE. No toca datos ni estructura.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auditoria_identificador(_relid OID, _fila JSONB)
RETURNS TEXT
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_columnas TEXT[];
  v_columna TEXT;
  v_partes TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF _fila IS NULL THEN
    RETURN 'sin-fila';
  END IF;

  -- La mayoría de las tablas tienen columna id y ahí se acaba.
  IF _fila ? 'id' AND _fila ->> 'id' IS NOT NULL THEN
    RETURN _fila ->> 'id';
  END IF;

  -- Si no, la clave primaria, en el orden en que está declarada.
  SELECT array_agg(a.attname ORDER BY k.orden)
    INTO v_columnas
    FROM pg_index i
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, orden)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE i.indrelid = _relid AND i.indisprimary;

  IF v_columnas IS NULL THEN
    RETURN 'sin-clave';
  END IF;

  FOREACH v_columna IN ARRAY v_columnas LOOP
    v_partes := v_partes || COALESCE(_fila ->> v_columna, '');
  END LOOP;

  RETURN array_to_string(v_partes, '|');
END;
$$;

COMMENT ON FUNCTION public.auditoria_identificador(OID, JSONB) IS
  'A qué fila se refiere un registro de auditoría: la columna id si existe, si '
  'no la clave primaria. Nunca devuelve NULL, para que el hash y lo almacenado '
  'no puedan discrepar.';

REVOKE EXECUTE ON FUNCTION public.auditoria_identificador(OID, JSONB) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.auditoria_registrar()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_antes JSONB;
  v_despues JSONB;
  v_registro TEXT;
  v_empresa UUID;
  v_usuario UUID;
  v_hash_anterior TEXT;
  v_hash TEXT;
  v_momento TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- El encadenado exige un orden total: sin este cerrojo, dos transacciones
  -- simultáneas leerían el mismo hash anterior y la cadena se bifurcaría.
  PERFORM pg_advisory_xact_lock(hashtext('public.auditoria'));

  IF TG_OP = 'DELETE' THEN
    v_antes := public.auditoria_enmascarar(to_jsonb(OLD));
    v_registro := public.auditoria_identificador(TG_RELID, to_jsonb(OLD));
  ELSIF TG_OP = 'UPDATE' THEN
    v_antes := public.auditoria_enmascarar(to_jsonb(OLD));
    v_despues := public.auditoria_enmascarar(to_jsonb(NEW));
    v_registro := public.auditoria_identificador(TG_RELID, to_jsonb(NEW));
  ELSE
    v_despues := public.auditoria_enmascarar(to_jsonb(NEW));
    v_registro := public.auditoria_identificador(TG_RELID, to_jsonb(NEW));
  END IF;

  -- La empresa, si la fila la lleva.
  v_empresa := NULLIF(COALESCE(v_despues, v_antes) ->> 'empresa_id', '')::UUID;

  -- Quién. Ver auditoria_autor() para el orden y por qué es ese.
  v_usuario := public.auditoria_autor();

  SELECT a.hash INTO v_hash_anterior
    FROM public.auditoria a ORDER BY a.id DESC LIMIT 1;

  -- v_registro va tal cual en los dos sitios. Ese COALESCE distinto en cada
  -- uno era el fallo: dos expresiones para un solo valor.
  v_hash := encode(
    extensions.digest(
      COALESCE(v_hash_anterior, '') || '|' ||
      TG_TABLE_NAME || '|' || v_registro || '|' || TG_OP || '|' ||
      COALESCE(v_antes::TEXT, '') || '|' || COALESCE(v_despues::TEXT, '') || '|' ||
      COALESCE(v_usuario::TEXT, '') || '|' || v_momento::TEXT,
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.auditoria (
    empresa_id, tabla, registro_id, operacion,
    datos_antes, datos_despues, usuario_id, created_at, hash_anterior, hash
  ) VALUES (
    v_empresa, TG_TABLE_NAME, v_registro, TG_OP,
    v_antes, v_despues, v_usuario, v_momento, v_hash_anterior, v_hash
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auditoria_registrar() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Qué hacer con lo ya escrito
-- ---------------------------------------------------------------------------
-- Para saber si te afecta, cuenta las filas señaladas y de qué tabla son:
--
--   SELECT a.tabla, count(*)
--   FROM public.auditoria_verificar() v
--   JOIN public.auditoria a ON a.id = v.id
--   GROUP BY a.tabla;
--
-- Si solo salen tienda_credenciales y tienda_usuarios, y son de antes de esta
-- migración, es este fallo y no una manipulación. A partir de aquí no se
-- añaden más. No las reescribas: una tabla de auditoría que se puede retocar
-- para que cuadre no demuestra nada.
