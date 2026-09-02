-- ============================================================================
-- CIMIENTOS 5/6 · Clientes globales por empresa
-- ============================================================================
--
-- QUÉ HACE
--   Crea la tabla puente cliente_tiendas, que es donde pasa a vivir la
--   identidad de WooCommerce, y una vista que enseña los clientes que se
--   fusionarían al aplicar la unicidad por correo.
--
-- QUÉ NO HACE, A PROPÓSITO
--   NO aplica todavía UNIQUE (empresa_id, email) ni fusiona clientes
--   duplicados. Fusionar dos fichas de cliente implica repuntar sus pedidos y
--   sus facturas y quedarse con unos datos fiscales y descartar otros: eso lo
--   decide una persona mirando la lista, no una migración. La vista
--   clientes_duplicados_por_email es esa lista.
--   La migración que aplica la unicidad va después, cuando la hayas revisado.
--
-- POR QUÉ
--   Hoy clientes tiene UNIQUE (tienda_id, woo_customer_id), es decir, la ficha
--   es por tienda. Un cliente B2B que compra en dos de tus tiendas son hoy dos
--   clientes: dos históricos, dos riesgos de crédito, dos direcciones fiscales
--   que pueden divergir. Y cuando en la fase de cobros haya que mirar el
--   vencido de un cliente, se mirará la mitad.
--
-- REVERSIBLE
--   Sí. Esta migración no borra ni modifica ninguna fila de clientes: solo
--   copia la referencia de WooCommerce a la tabla puente. Eliminar la tabla y
--   la vista lo deshace.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. La identidad externa sale de la ficha del cliente
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cliente_tiendas (
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  tienda_id UUID NOT NULL REFERENCES public.tiendas(id) ON DELETE CASCADE,
  woo_customer_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cliente_id, tienda_id),
  -- La clave de sincronización externa: todo upsert que venga de WooCommerce
  -- tiene que ser idempotente contra esto.
  UNIQUE (tienda_id, woo_customer_id)
);

COMMENT ON TABLE public.cliente_tiendas IS
  'Qué identidad tiene cada cliente en cada tienda WooCommerce. La ficha del cliente es única por empresa; esto es su reflejo en cada canal.';

CREATE INDEX IF NOT EXISTS cliente_tiendas_tienda_idx ON public.cliente_tiendas (tienda_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cliente_tiendas TO authenticated;
GRANT ALL ON public.cliente_tiendas TO service_role;

ALTER TABLE public.cliente_tiendas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cliente_tiendas por pertenencia" ON public.cliente_tiendas
  FOR ALL TO authenticated
  USING (public.is_tienda_member(auth.uid(), tienda_id))
  WITH CHECK (public.is_tienda_member(auth.uid(), tienda_id));

-- ---------------------------------------------------------------------------
-- 2. Trasladar lo que ya hay
-- ---------------------------------------------------------------------------
-- Se copia, no se mueve: clientes.woo_customer_id se queda donde está hasta
-- que la sincronización lea de la tabla puente.
INSERT INTO public.cliente_tiendas (cliente_id, tienda_id, woo_customer_id)
SELECT c.id, c.tienda_id, c.woo_customer_id
FROM public.clientes c
ON CONFLICT (cliente_id, tienda_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Qué se fusionaría
-- ---------------------------------------------------------------------------
-- Antes de aplicar UNIQUE (empresa_id, email) hay que saber qué choca.
-- Consulta esta vista y decide caso por caso:
--
--   SELECT * FROM public.clientes_duplicados_por_email;
--
-- Si devuelve cero filas, la unicidad se puede aplicar sin tocar nada.
CREATE OR REPLACE VIEW public.clientes_duplicados_por_email AS
SELECT
  c.empresa_id,
  lower(TRIM(c.email)) AS email,
  count(*) AS fichas,
  array_agg(c.id ORDER BY c.created_at) AS cliente_ids,
  array_agg(DISTINCT c.nombre) AS nombres,
  array_agg(DISTINCT c.nif) FILTER (WHERE c.nif IS NOT NULL) AS nifs,
  array_agg(DISTINCT t.nombre) AS tiendas,
  (SELECT count(*) FROM public.pedidos p
    WHERE p.cliente_id = ANY(array_agg(c.id))) AS pedidos_afectados,
  (SELECT count(*) FROM public.facturas f
    WHERE f.cliente_id = ANY(array_agg(c.id))) AS facturas_afectadas
FROM public.clientes c
LEFT JOIN public.tiendas t ON t.id = c.tienda_id
WHERE c.email IS NOT NULL AND TRIM(c.email) <> ''
GROUP BY c.empresa_id, lower(TRIM(c.email))
HAVING count(*) > 1;

COMMENT ON VIEW public.clientes_duplicados_por_email IS
  'Clientes que comparten correo dentro de una empresa. Revisar antes de aplicar UNIQUE (empresa_id, email): cada fila es una fusión que habría que decidir a mano.';

GRANT SELECT ON public.clientes_duplicados_por_email TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Índice de apoyo
-- ---------------------------------------------------------------------------
-- No es único todavía: solo acelera la búsqueda por correo, que es como se
-- busca a un cliente B2B en la práctica.
CREATE INDEX IF NOT EXISTS clientes_empresa_email_idx
  ON public.clientes (empresa_id, lower(TRIM(email)))
  WHERE email IS NOT NULL AND TRIM(email) <> '';
