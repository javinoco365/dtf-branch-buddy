-- ============================================================================
-- Primer pedido de un cliente
-- ============================================================================
-- QUÉ HACE
--   La lista de pedidos marca con «1.er pedido» el primero de cada cliente, en
--   toda la empresa (todas las tiendas, los pedidos manuales y el textil). Esta
--   migración pone en la base la regla, que mira TODOS los pedidos y no solo los
--   que tiene cargados la pantalla, y dónde guardar lo que decida una persona en
--   los casos dudosos.
--
--   La regla (decisión de Javier, 28-10-2026). Un pedido NO es el primero si hay
--   un pedido anterior de la misma empresa, que no esté cancelado, con:
--     - la misma ficha de cliente (cliente_id), o
--     - el mismo email, o
--     - el mismo teléfono, o
--     - el mismo nombre Y, además, el mismo NIF o la misma dirección (calle y
--       código postal, de facturación, de envío o de la ficha).
--   El nombre solo no basta: si solo coincide el nombre, el pedido queda
--   «dudoso» y una persona decide si es cliente nuevo o no.
--
--   Los datos se comparan igualados: email en minúsculas y sin espacios;
--   teléfono solo con sus cifras y sin el 34 delante; nombre y dirección sin
--   mayúsculas, sin tildes y sin espacios de más. Un dato vacío no coincide con
--   nada.
--
--   1. pedidos.primer_pedido_decision y textil_pedidos.primer_pedido_decision:
--      'nuevo' (es su primer pedido) o 'repite' (ya era cliente). Vacío: manda
--      la regla. Se escriben por la política de UPDATE de cada tabla (nivel
--      editor o admin) y quedan en la auditoría con su autor.
--   2. cliente_norm_texto(), cliente_norm_email(), cliente_norm_telefono():
--      cómo se igualan los datos. IMMUTABLE.
--   3. Vista pedidos_huella_cliente (security_invoker): todos los pedidos de
--      tienda y de textil con sus datos igualados. Respeta la RLS de quien la
--      lee.
--   4. primer_pedido_resumen(_tienda, _textil): para los pedidos que enseña la
--      pantalla, si hay coincidencias fuertes anteriores, cuántos pedidos
--      anteriores coinciden solo de nombre, y la decisión guardada.
--   5. primer_pedido_parecidos(_origen, _id): los pedidos anteriores que se
--      parecen a uno, con el motivo, para que la persona decida.
--
--   Las dos funciones son SECURITY INVOKER: no ven más de lo que ve quien las
--   llama. No escriben nada.
--
-- REVERSIBLE
--   Sí: supabase/reversiones/20261103100000_primer_pedido.sql quita las
--   funciones, la vista y las dos columnas (se pierden las decisiones).
-- ============================================================================

-- 1. La decisión en los casos dudosos -----------------------------------------
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS primer_pedido_decision TEXT;
ALTER TABLE public.textil_pedidos
  ADD COLUMN IF NOT EXISTS primer_pedido_decision TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'pedidos_primer_pedido_decision_valida') THEN
    ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_primer_pedido_decision_valida
      CHECK (primer_pedido_decision IS NULL OR primer_pedido_decision IN ('nuevo', 'repite'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'textil_pedidos_primer_pedido_decision_valida') THEN
    ALTER TABLE public.textil_pedidos ADD CONSTRAINT textil_pedidos_primer_pedido_decision_valida
      CHECK (primer_pedido_decision IS NULL OR primer_pedido_decision IN ('nuevo', 'repite'));
  END IF;
END $$;

COMMENT ON COLUMN public.pedidos.primer_pedido_decision IS
  'Lo que decidió una persona cuando la regla del primer pedido dudaba: nuevo o repite. Vacío: manda la regla (primer_pedido_resumen).';
COMMENT ON COLUMN public.textil_pedidos.primer_pedido_decision IS
  'Lo que decidió una persona cuando la regla del primer pedido dudaba: nuevo o repite. Vacío: manda la regla (primer_pedido_resumen).';

-- 2. Cómo se igualan los datos -------------------------------------------------
CREATE OR REPLACE FUNCTION public.cliente_norm_texto(_t TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT COALESCE(
    btrim(regexp_replace(
      translate(lower(_t), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
      '\s+', ' ', 'g')),
    '')
$$;

CREATE OR REPLACE FUNCTION public.cliente_norm_email(_t TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT COALESCE(lower(regexp_replace(_t, '\s+', '', 'g')), '')
$$;

-- Solo las cifras; sin el prefijo de España (34 o 0034) si lo que queda tiene
-- nueve cifras, que es un número español.
CREATE OR REPLACE FUNCTION public.cliente_norm_telefono(_t TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT CASE
    WHEN d ~ '^0034[0-9]{9}$' THEN substr(d, 5)
    WHEN d ~ '^34[0-9]{9}$' THEN substr(d, 3)
    ELSE d
  END
  FROM (SELECT COALESCE(regexp_replace(_t, '[^0-9]', '', 'g'), '') AS d) s
$$;

-- 3. Todos los pedidos, con sus datos igualados --------------------------------
-- Una dirección cuenta solo si tiene calle y código postal: «calle|cp».
CREATE OR REPLACE VIEW public.pedidos_huella_cliente
WITH (security_invoker = true) AS
SELECT
  'tienda'::TEXT AS origen,
  p.id,
  t.empresa_id,
  p.tienda_id,
  t.nombre AS procedencia,
  p.numero,
  p.fecha_pedido AS fecha,
  p.created_at,
  p.estado::TEXT <> 'cancelado' AS valido,
  p.primer_pedido_decision AS decision,
  p.cliente_id,
  p.cliente_nombre AS nombre,
  COALESCE(NULLIF(btrim(p.cliente_email), ''), c.email) AS email,
  COALESCE(NULLIF(btrim(p.cliente_telefono), ''), c.telefono) AS telefono,
  public.cliente_norm_texto(COALESCE(NULLIF(btrim(p.cliente_nombre), ''), c.nombre)) AS nombre_n,
  ARRAY(SELECT DISTINCT e FROM unnest(ARRAY[
          public.cliente_norm_email(p.cliente_email),
          public.cliente_norm_email(p.direccion_facturacion->>'email'),
          public.cliente_norm_email(p.direccion_envio->>'email'),
          public.cliente_norm_email(c.email)]) e WHERE e <> '') AS emails_n,
  ARRAY(SELECT DISTINCT e FROM unnest(ARRAY[
          public.cliente_norm_telefono(p.cliente_telefono),
          public.cliente_norm_telefono(p.direccion_facturacion->>'telefono'),
          public.cliente_norm_telefono(p.direccion_envio->>'telefono'),
          public.cliente_norm_telefono(c.telefono)]) e WHERE e <> '') AS telefonos_n,
  public.cliente_norm_texto(regexp_replace(COALESCE(c.nif, ''), '[^0-9A-Za-z]', '', 'g')) AS nif_n,
  ARRAY(SELECT DISTINCT d FROM unnest(ARRAY[
          CASE WHEN public.cliente_norm_texto(p.direccion_facturacion->>'direccion') <> ''
                AND public.cliente_norm_texto(p.direccion_facturacion->>'codigo_postal') <> ''
               THEN public.cliente_norm_texto(p.direccion_facturacion->>'direccion') || '|'
                 || public.cliente_norm_texto(p.direccion_facturacion->>'codigo_postal') END,
          CASE WHEN public.cliente_norm_texto(p.direccion_envio->>'direccion') <> ''
                AND public.cliente_norm_texto(p.direccion_envio->>'codigo_postal') <> ''
               THEN public.cliente_norm_texto(p.direccion_envio->>'direccion') || '|'
                 || public.cliente_norm_texto(p.direccion_envio->>'codigo_postal') END,
          CASE WHEN public.cliente_norm_texto(c.direccion) <> ''
                AND public.cliente_norm_texto(c.codigo_postal) <> ''
               THEN public.cliente_norm_texto(c.direccion) || '|'
                 || public.cliente_norm_texto(c.codigo_postal) END]) d
        WHERE d IS NOT NULL) AS direcciones_n
FROM public.pedidos p
JOIN public.tiendas t ON t.id = p.tienda_id
LEFT JOIN public.clientes c ON c.id = p.cliente_id
UNION ALL
SELECT
  'textil'::TEXT,
  tp.id,
  tp.empresa_id,
  NULL::UUID,
  'Textil personalizado'::TEXT,
  tp.numero,
  (tp.fecha::TIMESTAMP AT TIME ZONE 'Europe/Madrid'),
  tp.created_at,
  tp.estado <> 'cancelado',
  tp.primer_pedido_decision,
  tp.cliente_id,
  tp.cliente_nombre,
  COALESCE(NULLIF(btrim(tp.cliente_email), ''), c.email),
  c.telefono,
  public.cliente_norm_texto(COALESCE(NULLIF(btrim(tp.cliente_nombre), ''), c.nombre)),
  ARRAY(SELECT DISTINCT e FROM unnest(ARRAY[
          public.cliente_norm_email(tp.cliente_email),
          public.cliente_norm_email(c.email)]) e WHERE e <> ''),
  ARRAY(SELECT DISTINCT e FROM unnest(ARRAY[
          public.cliente_norm_telefono(c.telefono)]) e WHERE e <> ''),
  public.cliente_norm_texto(regexp_replace(COALESCE(c.nif, ''), '[^0-9A-Za-z]', '', 'g')),
  ARRAY(SELECT d FROM unnest(ARRAY[
          CASE WHEN public.cliente_norm_texto(c.direccion) <> ''
                AND public.cliente_norm_texto(c.codigo_postal) <> ''
               THEN public.cliente_norm_texto(c.direccion) || '|'
                 || public.cliente_norm_texto(c.codigo_postal) END]) d
        WHERE d IS NOT NULL)
FROM public.textil_pedidos tp
LEFT JOIN public.clientes c ON c.id = tp.cliente_id;

COMMENT ON VIEW public.pedidos_huella_cliente IS
  'Todos los pedidos (tiendas y textil) con los datos del cliente igualados para compararlos: la base de primer_pedido_resumen y primer_pedido_parecidos. security_invoker: respeta la RLS de quien la lee.';

REVOKE ALL ON public.pedidos_huella_cliente FROM anon;
GRANT SELECT ON public.pedidos_huella_cliente TO authenticated;

-- 4. Resumen para la lista -----------------------------------------------------
-- Por cada pedido pedido: si tiene algún dato con que comparar, si está
-- cancelado, cuántos pedidos anteriores válidos coinciden de verdad (ficha,
-- email, teléfono, o nombre más NIF o dirección), cuántos coinciden solo de
-- nombre, y la decisión guardada. La etiqueta la pone la aplicación
-- (src/dominio/primer-pedido.ts).
CREATE OR REPLACE FUNCTION public.primer_pedido_resumen(
  _tienda UUID[] DEFAULT '{}',
  _textil UUID[] DEFAULT '{}'
)
RETURNS TABLE (
  origen TEXT,
  id UUID,
  tiene_datos BOOLEAN,
  cancelado BOOLEAN,
  fuertes INTEGER,
  solo_nombre INTEGER,
  decision TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH objetivo AS MATERIALIZED (
    SELECT h.*
      FROM public.pedidos_huella_cliente h
     WHERE (h.origen = 'tienda' AND h.id = ANY(COALESCE(_tienda, '{}')))
        OR (h.origen = 'textil' AND h.id = ANY(COALESCE(_textil, '{}')))
  ),
  anteriores AS MATERIALIZED (
    SELECT h.*
      FROM public.pedidos_huella_cliente h
     WHERE h.valido
       AND h.empresa_id IN (SELECT o.empresa_id FROM objetivo o)
  ),
  cruce AS (
    SELECT o.origen, o.id,
           -- COALESCE: una ficha vacía (NULL) no puede dejar el cruce en NULL,
           -- que no contaría ni como fuerte ni como solo de nombre.
           COALESCE((o.cliente_id IS NOT NULL AND a.cliente_id = o.cliente_id)
             OR (a.emails_n && o.emails_n)
             OR (a.telefonos_n && o.telefonos_n)
             OR (o.nombre_n <> '' AND a.nombre_n = o.nombre_n
                 AND ((o.nif_n <> '' AND a.nif_n = o.nif_n)
                      OR (a.direcciones_n && o.direcciones_n))), false) AS fuerte,
           COALESCE(o.nombre_n <> '' AND a.nombre_n = o.nombre_n, false) AS mismo_nombre
      FROM objetivo o
      JOIN anteriores a
        ON a.empresa_id = o.empresa_id
       AND NOT (a.origen = o.origen AND a.id = o.id)
       AND (a.fecha, a.created_at, a.origen, a.id) < (o.fecha, o.created_at, o.origen, o.id)
       AND ((o.cliente_id IS NOT NULL AND a.cliente_id = o.cliente_id)
            OR a.emails_n && o.emails_n
            OR a.telefonos_n && o.telefonos_n
            OR (o.nombre_n <> '' AND a.nombre_n = o.nombre_n))
  )
  SELECT o.origen,
         o.id,
         (o.cliente_id IS NOT NULL OR o.nombre_n <> ''
          OR cardinality(o.emails_n) > 0 OR cardinality(o.telefonos_n) > 0),
         NOT o.valido,
         COALESCE((SELECT count(*) FROM cruce c
                    WHERE c.origen = o.origen AND c.id = o.id AND c.fuerte), 0)::INTEGER,
         COALESCE((SELECT count(*) FROM cruce c
                    WHERE c.origen = o.origen AND c.id = o.id
                      AND c.mismo_nombre AND NOT c.fuerte), 0)::INTEGER,
         o.decision
    FROM objetivo o
$$;

COMMENT ON FUNCTION public.primer_pedido_resumen(UUID[], UUID[]) IS
  'Para la etiqueta «1.er pedido»: por cada pedido, coincidencias con pedidos anteriores válidos de toda la empresa (fuertes y solo de nombre) y la decisión guardada.';

-- 5. Los parecidos de un pedido, para decidir ---------------------------------
CREATE OR REPLACE FUNCTION public.primer_pedido_parecidos(_origen TEXT, _id UUID)
RETURNS TABLE (
  origen TEXT,
  id UUID,
  procedencia TEXT,
  numero TEXT,
  fecha TIMESTAMPTZ,
  nombre TEXT,
  email TEXT,
  telefono TEXT,
  motivos TEXT[],
  fuerte BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH o AS (
    SELECT h.* FROM public.pedidos_huella_cliente h
     WHERE h.origen = _origen AND h.id = _id
  ),
  m AS (
    SELECT a.*,
           ARRAY_REMOVE(ARRAY[
             CASE WHEN o.cliente_id IS NOT NULL AND a.cliente_id = o.cliente_id THEN 'ficha' END,
             CASE WHEN a.emails_n && o.emails_n THEN 'email' END,
             CASE WHEN a.telefonos_n && o.telefonos_n THEN 'telefono' END,
             CASE WHEN o.nombre_n <> '' AND a.nombre_n = o.nombre_n THEN 'nombre' END,
             CASE WHEN o.nif_n <> '' AND a.nif_n = o.nif_n THEN 'nif' END,
             CASE WHEN a.direcciones_n && o.direcciones_n THEN 'direccion' END
           ], NULL) AS motivos
      FROM o
      JOIN public.pedidos_huella_cliente a
        ON a.empresa_id = o.empresa_id
       AND a.valido
       AND NOT (a.origen = o.origen AND a.id = o.id)
       AND (a.fecha, a.created_at, a.origen, a.id) < (o.fecha, o.created_at, o.origen, o.id)
  )
  SELECT m.origen, m.id, m.procedencia, m.numero, m.fecha, m.nombre, m.email, m.telefono,
         m.motivos,
         (m.motivos && ARRAY['ficha', 'email', 'telefono']
          OR ('nombre' = ANY(m.motivos) AND m.motivos && ARRAY['nif', 'direccion']))
    FROM m
   WHERE m.motivos && ARRAY['ficha', 'email', 'telefono', 'nombre']
   ORDER BY m.fecha DESC, m.numero
   LIMIT 50
$$;

COMMENT ON FUNCTION public.primer_pedido_parecidos(TEXT, UUID) IS
  'Los pedidos anteriores válidos que se parecen a uno (ficha, email, teléfono o nombre), con el motivo: lo que enseña la ventana para decidir si es cliente nuevo.';

REVOKE ALL ON FUNCTION public.primer_pedido_resumen(UUID[], UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.primer_pedido_parecidos(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.primer_pedido_resumen(UUID[], UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.primer_pedido_parecidos(TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
