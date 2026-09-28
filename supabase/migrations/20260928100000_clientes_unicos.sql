-- ============================================================================
-- CLIENTES · Una sola ficha por cliente en toda la empresa
-- ============================================================================
--
-- QUÉ RESUELVE
--   Hoy hay dos listas de clientes que no se hablan: `clientes`, cada uno
--   atado a una tienda, y `textil_clientes`, la del textil personalizado. El
--   mismo cliente que compra en una tienda y encarga camisetas son dos fichas
--   distintas, con datos que se desvían: un NIF corregido en una y no en la
--   otra, dos direcciones, dos historiales.
--
-- QUÉ HACE
--   1. `clientes` pasa a ser la ficha de la EMPRESA. `tienda_id` deja de ser
--      obligatorio: queda como «dónde se creó», no como dueño. Y borrar una
--      tienda ya no se lleva sus clientes por delante (ON DELETE SET NULL, antes
--      CASCADE): esos clientes también pueden tener pedidos en otra tienda o en
--      el textil.
--   2. Nueva columna `origen`: tienda, textil o general. Solo informa de dónde
--      se dio de alta; sirve para filtrar.
--   3. Copia cada cliente de `textil_clientes` a `clientes` CON EL MISMO ID. Por
--      eso los presupuestos, pedidos y facturas del textil no hay que tocarlos:
--      basta con que su clave ajena apunte ahora a `clientes`, y el id que ya
--      tienen sigue siendo válido.
--   4. `textil_clientes` se queda donde está, con sus filas, pero congelada:
--      nadie puede escribir en ella. No se borra: eso sería un DROP sobre datos
--      reales, y se decide aparte cuando todo esto lleve un tiempo funcionando.
--   5. La RLS de `clientes` pasa a ser por empresa y por operación. La de hoy
--      es un único FOR ALL por tienda, que CLAUDE.md prohíbe en tablas de
--      negocio, y que además dejaría invisibles a los clientes sin tienda.
--   6. Vista `clientes_posibles_duplicados`: fichas que comparten correo o NIF.
--
-- QUÉ NO HACE, A PROPÓSITO
--   No fusiona ningún duplicado. Juntar dos fichas es repuntar pedidos,
--   facturas y apuntes de caja y quedarse con unos datos fiscales y tirar
--   otros: lo decide una persona mirando la lista, no una migración. La
--   pantalla de Clientes enseña esa lista; la fusión va en un paso posterior.
--
-- ORDEN DE DESPLIEGUE
--   Aplicar esta migración y fusionar la PR que la acompaña a la vez. Con la
--   migración aplicada y el código viejo, el textil intentaría escribir en
--   `textil_clientes`, que ya no lo admite. Con el código nuevo y sin la
--   migración, un pedido textil apuntaría a un cliente que su clave ajena
--   todavía no reconoce.
--
-- REVERSIBLE
--   Casi entera. Las filas copiadas se pueden borrar de `clientes` (tienen
--   origen = 'textil'), las claves ajenas del textil se pueden devolver a
--   `textil_clientes` y la tabla descongelar. Lo único que no se deshace solo
--   es lo que se escriba DESPUÉS: un cliente nuevo creado en el textil ya solo
--   existirá en `clientes`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. La tienda deja de ser dueña del cliente
-- ---------------------------------------------------------------------------
ALTER TABLE public.clientes ALTER COLUMN tienda_id DROP NOT NULL;

-- La restricción se busca por su definición y no por su nombre: si alguna vez
-- se creó con otro nombre, un DROP por nombre fallaría o no haría nada.
DO $$
DECLARE v_nombre TEXT;
BEGIN
  FOR v_nombre IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'public.clientes'::regclass
       AND c.contype = 'f'
       AND c.confrelid = 'public.tiendas'::regclass
       AND a.attname = 'tienda_id'
  LOOP
    EXECUTE format('ALTER TABLE public.clientes DROP CONSTRAINT %I', v_nombre);
  END LOOP;
END $$;

ALTER TABLE public.clientes
  ADD CONSTRAINT clientes_tienda_origen_fkey
  FOREIGN KEY (tienda_id) REFERENCES public.tiendas(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.clientes.tienda_id IS
  'La tienda donde se dio de alta, si fue en una. No es la dueña: el cliente es '
  'de la empresa y puede comprar en cualquier tienda o en el textil.';

-- ---------------------------------------------------------------------------
-- 2. De dónde viene cada ficha
-- ---------------------------------------------------------------------------
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'tienda';

DO $$ BEGIN
  ALTER TABLE public.clientes
    ADD CONSTRAINT clientes_origen_valido CHECK (origen IN ('tienda', 'textil', 'general'));
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'La restricción clientes_origen_valido ya existe, se omite';
END $$;

COMMENT ON COLUMN public.clientes.origen IS
  'Dónde se dio de alta: tienda, textil o general (la pantalla de Clientes). '
  'Solo informa; no limita dónde puede comprar.';

-- ---------------------------------------------------------------------------
-- 3. Los clientes del textil entran en la ficha única, con su mismo id
-- ---------------------------------------------------------------------------
INSERT INTO public.clientes
  (id, empresa_id, tienda_id, origen, nombre, email, telefono, direccion, nif, notas,
   created_at, updated_at)
SELECT tc.id, tc.empresa_id, NULL, 'textil', tc.nombre, tc.email, tc.telefono,
       tc.direccion, tc.nif, tc.notas, tc.created_at, tc.updated_at
  FROM public.textil_clientes tc
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Presupuestos, pedidos y facturas del textil apuntan a la ficha única
-- ---------------------------------------------------------------------------
-- Solo se cambia la restricción, no las filas: el id que ya guardan es el
-- mismo en las dos tablas. Validarla recorre las filas pero no las modifica,
-- así que las facturas emitidas, que no se tocan, no se tocan.
DO $$
DECLARE
  v_tabla TEXT;
  v_nombre TEXT;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['textil_presupuestos', 'textil_pedidos', 'textil_facturas'] LOOP
    FOR v_nombre IN
      SELECT c.conname
        FROM pg_constraint c
       WHERE c.conrelid = format('public.%I', v_tabla)::regclass
         AND c.contype = 'f'
         AND c.confrelid = 'public.textil_clientes'::regclass
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_tabla, v_nombre);
    END LOOP;

    -- La nueva, si ya existía, fuera también: así la migración se puede
    -- aplicar dos veces sin fallar.
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
      v_tabla, v_tabla || '_cliente_fkey');
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I '
      'FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL',
      v_tabla, v_tabla || '_cliente_fkey');
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. textil_clientes queda congelada
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.textil_clientes FROM authenticated, anon;

COMMENT ON TABLE public.textil_clientes IS
  'OBSOLETA desde 20260928100000_clientes_unicos. Sus filas se copiaron a '
  'clientes con el mismo id y ya no se escribe en ella. Se conserva hasta que se '
  'decida retirarla.';

-- ---------------------------------------------------------------------------
-- 6. RLS de clientes: por empresa y por operación
-- ---------------------------------------------------------------------------
-- Antes: un FOR ALL por tienda. Un cliente sin tienda no lo vería nadie que no
-- fuera administrador, y FOR ALL es justo lo que CLAUDE.md prohíbe.
DROP POLICY IF EXISTS "clientes member access" ON public.clientes;

DROP POLICY IF EXISTS "clientes lectura" ON public.clientes;
CREATE POLICY "clientes lectura" ON public.clientes
  FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "clientes alta" ON public.clientes;
CREATE POLICY "clientes alta" ON public.clientes
  FOR INSERT TO authenticated
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "clientes edicion" ON public.clientes;
CREATE POLICY "clientes edicion" ON public.clientes
  FOR UPDATE TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id))
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

-- Borrar una ficha no borra su historial: pedidos, facturas, apuntes de caja y
-- documentos del textil llevan ON DELETE SET NULL y conservan el nombre
-- congelado.
DROP POLICY IF EXISTS "clientes baja" ON public.clientes;
CREATE POLICY "clientes baja" ON public.clientes
  FOR DELETE TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

-- ---------------------------------------------------------------------------
-- 7. Posibles duplicados, para revisarlos antes de fusionar nada
-- ---------------------------------------------------------------------------
-- Un grupo por cada correo o NIF que aparece en más de una ficha. El NIF se
-- compara sin espacios, guiones ni puntos y en mayúsculas: «b-12.345.678» y
-- «B12345678» son el mismo.
--
-- security_invoker: la vista se lee con los permisos de quien consulta, así
-- que respeta la RLS de clientes. Sin eso, una vista se lee con los permisos
-- de su dueño y saltaría la RLS.
CREATE OR REPLACE VIEW public.clientes_posibles_duplicados
WITH (security_invoker = true) AS
WITH claves AS (
  SELECT c.id, c.empresa_id, 'email'::TEXT AS motivo, lower(TRIM(c.email)) AS clave
    FROM public.clientes c
   WHERE c.email IS NOT NULL AND TRIM(c.email) <> ''
  UNION ALL
  SELECT c.id, c.empresa_id, 'nif'::TEXT,
         upper(regexp_replace(c.nif, '[\s\.\-]', '', 'g'))
    FROM public.clientes c
   WHERE c.nif IS NOT NULL AND regexp_replace(c.nif, '[\s\.\-]', '', 'g') <> ''
)
SELECT
  k.empresa_id,
  k.motivo,
  k.clave,
  count(*) AS fichas,
  array_agg(k.id ORDER BY k.id) AS cliente_ids
FROM claves k
GROUP BY k.empresa_id, k.motivo, k.clave
HAVING count(*) > 1;

COMMENT ON VIEW public.clientes_posibles_duplicados IS
  'Fichas de cliente que comparten correo o NIF. Es la lista a revisar antes de '
  'fusionar: cada fila es una posible fusión que decide una persona.';

GRANT SELECT ON public.clientes_posibles_duplicados TO authenticated;
