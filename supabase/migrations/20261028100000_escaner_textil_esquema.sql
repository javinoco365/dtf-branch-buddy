-- ============================================================================
-- ESCÁNER TEXTIL (1 de 3) · Esquema: proveedores, productos, memoria y enlaces
-- ============================================================================
--
-- QUÉ RESUELVE
--   Hoy una variante de stock es una fila suelta (nombre, color y talla en
--   texto libre), el proveedor es el texto que trae la factura, y la entrada
--   de stock de una compra solo se enlaza con su factura por la nota. Cada
--   factura se casa a mano, línea a línea, y los portes y descuentos no llegan
--   al coste. Además, la RLS de textil_compras y textil_compra_lineas es
--   USING (true): no filtra por empresa.
--
-- QUÉ CAMBIA
--   Funciones de normalización (puras, IMMUTABLE; el dominio las replica
--   carácter a carácter en src/dominio/normalizar-textil.ts):
--     textil_clave, textil_clave_talla, nif_clave, textil_clave_memoria.
--   Tablas nuevas, con empresa_id, RLS por operación y auditoría:
--     proveedores                   uno por NIF normalizado (o, sin NIF, por
--                                   nombre normalizado) y empresa.
--     textil_productos              el modelo de prenda: marca de la prenda,
--                                   referencia del fabricante, nombre.
--     textil_referencias_proveedor  la memoria del escáner: «lo que este
--                                   proveedor llama X es esta variante».
--   Columnas nuevas (todas admiten nulo o tienen valor por defecto):
--     textil_stock          producto_id, ean, repetida, color_clave,
--                           talla_clave, fusionada_en.
--     textil_compras        proveedor_id (se conservan proveedor y
--                           nif_proveedor: el texto de la factura).
--     textil_compra_lineas  tipo, referencia, marca, modelo, color, talla, ean,
--                           unidades_por_pack, unidades_stock,
--                           coste_total_entrada, coste_unitario_entrada,
--                           casado_metodo; y UNIQUE (id, compra_id).
--     textil_stock_movimientos  compra_id, compra_linea_id (FK compuesta a la
--                           línea de SU compra) y fecha.
--     textil_presupuesto_items, textil_pedido_items  coste_unit_snapshot. No
--                           se rellena hacia atrás: las líneas viejas se quedan
--                           sin coste (no se recalcula leyendo el maestro).
--   RLS de textil_compras y textil_compra_lineas por empresa y por operación
--   (mismos nombres de política que hoy; ninguna FOR ALL).
--
-- EXCEPCIÓN A «timestamptz siempre»
--   textil_stock_movimientos.fecha es DATE: es una fecha contable de
--   calendario (la de la factura en las compras), del mismo tipo que
--   textil_compras.fecha; no es un instante. El instante sigue en created_at.
--   Las filas viejas quedan en nulo y se leen por su created_at (hora de
--   Madrid); las nuevas las rellena el trigger (20261028100200).
--
-- NO TOCA NINGUNA FILA EXISTENTE (añadir columnas no reescribe el libro de
-- movimientos). Se puede aplicar dos veces sin cambiar nada.
--
-- REVERSIBLE
--   Sí: supabase/reversiones/20261028100000_escaner_textil_esquema.sql, después
--   de las reversiones de 20261028100200 y 20261028100100. Se pierden el
--   catálogo de productos y proveedores, la memoria y los datos nuevos de las
--   líneas y movimientos; no se pierden unidades, coste medio, movimientos ni
--   compras.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Funciones de normalización (exactas: contrato 1.1.1)
-- ---------------------------------------------------------------------------
-- Primero se quitan los acentos, luego todo lo que no sea [A-Za-z0-9], y solo
-- después se pasa a minúsculas o mayúsculas: así el resultado no depende de la
-- configuración regional de la base. No se revoca EXECUTE: las usan columnas
-- generadas.
CREATE OR REPLACE FUNCTION public.textil_clave(_t TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT lower(regexp_replace(
           translate(coalesce(_t, ''),
             'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
             'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'),
           '[^A-Za-z0-9]', '', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.textil_clave_talla(_t TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT CASE s
           WHEN 'XXS' THEN '2XS'  WHEN 'XXXS' THEN '3XS'
           WHEN 'XXL' THEN '2XL'  WHEN 'XXXL' THEN '3XL'
           WHEN 'XXXXL' THEN '4XL' WHEN 'XXXXXL' THEN '5XL'
           WHEN 'U' THEN 'UNICA' WHEN 'TU' THEN 'UNICA'
           WHEN 'ONESIZE' THEN 'UNICA' WHEN 'OS' THEN 'UNICA'
           ELSE s END
    FROM (SELECT regexp_replace(regexp_replace(
                   upper(regexp_replace(
                     translate(coalesce(_t, ''),
                       'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                       'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'),
                     '[^A-Za-z0-9]', '', 'g')),
                   '^TALLA', ''), '(ANOS|YEARS)$', '') AS s) x
$$;

CREATE OR REPLACE FUNCTION public.nif_clave(_t TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT CASE WHEN s ~ '^ES[0-9A-Z][0-9]{7}[0-9A-Z]$' THEN substr(s, 3) ELSE s END
    FROM (SELECT upper(regexp_replace(coalesce(_t, ''), '[^A-Za-z0-9]', '', 'g')) AS s) x
$$;

CREATE OR REPLACE FUNCTION public.textil_clave_memoria(
  _referencia TEXT, _color TEXT, _talla TEXT, _descripcion TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT CASE
    WHEN public.textil_clave(_referencia) <> '' THEN
      'r:' || public.textil_clave(_referencia) || '|' || public.textil_clave(_color)
           || '|' || public.textil_clave_talla(_talla)
    WHEN public.textil_clave(_descripcion) <> '' THEN
      'd:' || public.textil_clave(_descripcion)
           || CASE WHEN public.textil_clave(_color) <> '' OR public.textil_clave_talla(_talla) <> ''
                   THEN '|' || public.textil_clave(_color) || '|' || public.textil_clave_talla(_talla)
                   ELSE '' END
    ELSE '' END
$$;

COMMENT ON FUNCTION public.textil_clave(TEXT) IS
  'Clave de texto: sin acentos, solo letras y cifras, en minúsculas. = claveTexto del dominio.';
COMMENT ON FUNCTION public.textil_clave_talla(TEXT) IS
  'Clave de talla: XXL → 2XL, «Talla M» → M, «3-4 años» → 34, T.U. → UNICA. = claveTalla del dominio.';
COMMENT ON FUNCTION public.nif_clave(TEXT) IS
  'NIF normalizado: solo letras y cifras, en mayúsculas y sin el prefijo ES. = claveNif del dominio.';
COMMENT ON FUNCTION public.textil_clave_memoria(TEXT, TEXT, TEXT, TEXT) IS
  'Clave de la memoria del escáner: r:referencia|color|talla o d:descripción[|color|talla]. = claveMemoria del dominio.';

-- ---------------------------------------------------------------------------
-- 2. Proveedores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.proveedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL DEFAULT public.empresa_por_defecto()
    REFERENCES public.empresas(id) ON DELETE RESTRICT,
  nombre TEXT NOT NULL,
  nif TEXT,
  nif_clave TEXT GENERATED ALWAYS AS (public.nif_clave(nif)) STORED,
  nombre_clave TEXT GENERATED ALWAYS AS (public.textil_clave(nombre)) STORED,
  email TEXT,
  telefono TEXT,
  notas TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  origen TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT proveedor_nombre CHECK (btrim(nombre) <> ''),
  CONSTRAINT proveedor_origen CHECK (origen IN ('manual', 'migracion', 'escaner'))
);

COMMENT ON TABLE public.proveedores IS
  'Proveedores de la empresa. Únicos por NIF normalizado o, sin NIF, por nombre normalizado. '
  'Las compras apuntan a su proveedor y conservan el texto de su factura.';
COMMENT ON COLUMN public.proveedores.nif_clave IS 'nif_clave(nif): '''' si no hay NIF.';

CREATE UNIQUE INDEX IF NOT EXISTS proveedores_nif_unico
  ON public.proveedores (empresa_id, nif_clave) WHERE nif_clave <> '';
CREATE UNIQUE INDEX IF NOT EXISTS proveedores_nombre_unico
  ON public.proveedores (empresa_id, nombre_clave) WHERE nif_clave = '';

-- ---------------------------------------------------------------------------
-- 3. Productos (el modelo de prenda)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.textil_productos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL DEFAULT public.empresa_por_defecto()
    REFERENCES public.empresas(id) ON DELETE RESTRICT,
  marca TEXT,
  referencia TEXT,
  nombre TEXT NOT NULL,
  categoria TEXT,
  notas TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  origen TEXT NOT NULL DEFAULT 'manual',
  marca_clave TEXT GENERATED ALWAYS AS (public.textil_clave(marca)) STORED,
  referencia_clave TEXT GENERATED ALWAYS AS (public.textil_clave(referencia)) STORED,
  nombre_clave TEXT GENERATED ALWAYS AS (public.textil_clave(nombre)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT producto_nombre CHECK (btrim(nombre) <> ''),
  CONSTRAINT producto_origen CHECK (origen IN ('manual', 'migracion', 'escaner'))
);

COMMENT ON TABLE public.textil_productos IS
  'Modelo de prenda: marca de la prenda + referencia del fabricante + nombre. Sus variantes '
  '(color × talla) son filas de textil_stock.';
COMMENT ON COLUMN public.textil_productos.marca IS
  'Marca de la PRENDA (Gildan, B&C…). No es textil_marcas, que es la marca comercial propia.';

CREATE UNIQUE INDEX IF NOT EXISTS textil_productos_referencia_unica
  ON public.textil_productos (empresa_id, marca_clave, referencia_clave)
  WHERE referencia_clave <> '';
CREATE UNIQUE INDEX IF NOT EXISTS textil_productos_nombre_unico
  ON public.textil_productos (empresa_id, marca_clave, nombre_clave)
  WHERE referencia_clave = '';

-- ---------------------------------------------------------------------------
-- 4. textil_stock: la fila pasa a ser la variante de un producto
-- ---------------------------------------------------------------------------
ALTER TABLE public.textil_stock
  ADD COLUMN IF NOT EXISTS producto_id UUID
    REFERENCES public.textil_productos(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS ean TEXT,
  ADD COLUMN IF NOT EXISTS repetida BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS color_clave TEXT
    GENERATED ALWAYS AS (public.textil_clave(color)) STORED,
  ADD COLUMN IF NOT EXISTS talla_clave TEXT
    GENERATED ALWAYS AS (public.textil_clave_talla(talla)) STORED,
  ADD COLUMN IF NOT EXISTS fusionada_en UUID
    REFERENCES public.textil_stock(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.textil_stock
    ADD CONSTRAINT textil_stock_ean_formato CHECK (ean IS NULL OR ean ~ '^([0-9]{8}|[0-9]{12,14})$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS textil_stock_por_producto ON public.textil_stock (producto_id);

COMMENT ON COLUMN public.textil_stock.producto_id IS 'Producto (modelo) del que esta fila es una variante.';
COMMENT ON COLUMN public.textil_stock.ean IS 'EAN/GTIN normalizado (8, 13 o 14 cifras). Único por empresa.';
COMMENT ON COLUMN public.textil_stock.repetida IS
  'Duplicado heredado de otra variante activa: no se casa ni se vende; se fusiona.';
COMMENT ON COLUMN public.textil_stock.fusionada_en IS 'Variante en la que se fusionó esta; nulo si no.';

-- ---------------------------------------------------------------------------
-- 5. Memoria del escáner
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.textil_referencias_proveedor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL DEFAULT public.empresa_por_defecto()
    REFERENCES public.empresas(id) ON DELETE RESTRICT,
  proveedor_id UUID NOT NULL REFERENCES public.proveedores(id) ON DELETE CASCADE,
  clave TEXT NOT NULL,
  stock_id UUID NOT NULL REFERENCES public.textil_stock(id) ON DELETE CASCADE,
  unidades_por_pack NUMERIC NOT NULL DEFAULT 1,
  veces INT NOT NULL DEFAULT 1,
  ultima_compra_id UUID REFERENCES public.textil_compras(id) ON DELETE SET NULL,
  origen TEXT NOT NULL DEFAULT 'escaner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memoria_clave CHECK (clave <> ''),
  CONSTRAINT memoria_pack CHECK (unidades_por_pack > 0),
  CONSTRAINT memoria_veces CHECK (veces >= 1),
  CONSTRAINT memoria_origen CHECK (origen IN ('escaner', 'migracion', 'manual'))
);

COMMENT ON TABLE public.textil_referencias_proveedor IS
  'Memoria del escáner: lo que este proveedor llama «clave» es esta variante. Aprende al '
  'registrar cada compra textil.';
COMMENT ON COLUMN public.textil_referencias_proveedor.veces IS
  'Cuántas facturas seguidas confirmaron esta variante para esta clave.';

CREATE UNIQUE INDEX IF NOT EXISTS textil_referencias_proveedor_clave_unica
  ON public.textil_referencias_proveedor (empresa_id, proveedor_id, clave);
CREATE INDEX IF NOT EXISTS textil_referencias_proveedor_por_stock
  ON public.textil_referencias_proveedor (stock_id);

-- ---------------------------------------------------------------------------
-- 6. Compras y sus líneas
-- ---------------------------------------------------------------------------
ALTER TABLE public.textil_compras
  ADD COLUMN IF NOT EXISTS proveedor_id UUID
    REFERENCES public.proveedores(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS textil_compras_por_proveedor
  ON public.textil_compras (proveedor_id) WHERE proveedor_id IS NOT NULL;

COMMENT ON COLUMN public.textil_compras.proveedor_id IS
  'Proveedor de la ficha. proveedor y nif_proveedor siguen siendo el texto de la factura.';

ALTER TABLE public.textil_compra_lineas
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'articulo',
  ADD COLUMN IF NOT EXISTS referencia TEXT,
  ADD COLUMN IF NOT EXISTS marca TEXT,
  ADD COLUMN IF NOT EXISTS modelo TEXT,
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS talla TEXT,
  ADD COLUMN IF NOT EXISTS ean TEXT,
  ADD COLUMN IF NOT EXISTS unidades_por_pack NUMERIC NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unidades_stock NUMERIC,
  ADD COLUMN IF NOT EXISTS coste_total_entrada NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS coste_unitario_entrada NUMERIC,
  ADD COLUMN IF NOT EXISTS casado_metodo TEXT;

DO $$ BEGIN
  ALTER TABLE public.textil_compra_lineas
    ADD CONSTRAINT compra_linea_tipo CHECK (tipo IN ('articulo', 'porte', 'descuento', 'otro'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.textil_compra_lineas
    ADD CONSTRAINT compra_linea_pack CHECK (unidades_por_pack > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.textil_compra_lineas
    ADD CONSTRAINT compra_linea_casado CHECK (
      casado_metodo IS NULL
      OR casado_metodo IN ('memoria', 'ean', 'referencia', 'sugerencia', 'manual', 'nueva'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- La necesita la FK compuesta de los movimientos. Volver a añadir una UNIQUE
-- da duplicate_table (crea un índice con ese nombre), no duplicate_object: se
-- comprueba antes en pg_constraint.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.textil_compra_lineas'::regclass
                    AND conname = 'compra_linea_id_compra') THEN
    ALTER TABLE public.textil_compra_lineas
      ADD CONSTRAINT compra_linea_id_compra UNIQUE (id, compra_id);
  END IF;
END $$;

COMMENT ON COLUMN public.textil_compra_lineas.tipo IS 'articulo, porte, descuento u otro (cargo).';
COMMENT ON COLUMN public.textil_compra_lineas.unidades_stock IS
  'cantidad × unidades_por_pack: las prendas que entran. Lo escribe el registro.';
COMMENT ON COLUMN public.textil_compra_lineas.coste_total_entrada IS
  'Importe de la línea más su parte de portes, descuentos y otros cargos. Lo escribe el registro.';
COMMENT ON COLUMN public.textil_compra_lineas.coste_unitario_entrada IS
  'coste_total_entrada / unidades_stock (8 decimales): el coste al que entra cada prenda.';
COMMENT ON COLUMN public.textil_compra_lineas.casado_metodo IS
  'Cómo se casó con su variante: memoria, ean, referencia, sugerencia, manual o nueva.';

-- ---------------------------------------------------------------------------
-- 7. Movimientos de stock: enlace a su factura y fecha contable
-- ---------------------------------------------------------------------------
ALTER TABLE public.textil_stock_movimientos
  ADD COLUMN IF NOT EXISTS compra_id UUID REFERENCES public.textil_compras(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS compra_linea_id UUID,
  ADD COLUMN IF NOT EXISTS fecha DATE;

DO $$ BEGIN
  ALTER TABLE public.textil_stock_movimientos
    ADD CONSTRAINT stock_mov_linea_de_su_compra
      FOREIGN KEY (compra_linea_id, compra_id)
      REFERENCES public.textil_compra_lineas (id, compra_id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Con MATCH SIMPLE, una línea con compra_id nulo se saltaría la FK entera.
DO $$ BEGIN
  ALTER TABLE public.textil_stock_movimientos
    ADD CONSTRAINT stock_linea_con_compra CHECK (compra_linea_id IS NULL OR compra_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS textil_stock_mov_por_compra
  ON public.textil_stock_movimientos (compra_id) WHERE compra_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS textil_stock_mov_por_fecha
  ON public.textil_stock_movimientos (empresa_id, fecha);

COMMENT ON COLUMN public.textil_stock_movimientos.compra_id IS
  'Factura de compra de la que viene (entradas por compra y devoluciones a proveedor).';
COMMENT ON COLUMN public.textil_stock_movimientos.compra_linea_id IS
  'Línea de esa factura (FK compuesta: tiene que ser de la misma compra).';
COMMENT ON COLUMN public.textil_stock_movimientos.fecha IS
  'Fecha contable (DATE: la de la factura en las compras). Nula en los movimientos viejos: '
  'se toma el día de created_at en hora de Madrid.';

-- ---------------------------------------------------------------------------
-- 8. Coste congelado en las líneas de presupuesto y pedido textil
-- ---------------------------------------------------------------------------
ALTER TABLE public.textil_presupuesto_items
  ADD COLUMN IF NOT EXISTS coste_unit_snapshot NUMERIC(12,4);
ALTER TABLE public.textil_pedido_items
  ADD COLUMN IF NOT EXISTS coste_unit_snapshot NUMERIC(12,4);

COMMENT ON COLUMN public.textil_presupuesto_items.coste_unit_snapshot IS
  'Coste medio de la variante al crear la línea. Nulo = sin coste conocido. No se recalcula.';
COMMENT ON COLUMN public.textil_pedido_items.coste_unit_snapshot IS
  'Coste medio de la variante al crear la línea. Nulo = sin coste conocido. No se recalcula.';

-- ---------------------------------------------------------------------------
-- 9. Permisos, RLS, updated_at y auditoría de las tablas nuevas
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_tabla TEXT;
BEGIN
  FOREACH v_tabla IN ARRAY ARRAY['proveedores', 'textil_productos', 'textil_referencias_proveedor']
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', v_tabla);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', v_tabla);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tabla);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_tabla || ' lectura', v_tabla);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
                   'USING (public.es_miembro_empresa(auth.uid(), empresa_id))',
                   v_tabla || ' lectura', v_tabla);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_tabla || ' alta', v_tabla);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated '
                   'WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id))',
                   v_tabla || ' alta', v_tabla);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_tabla || ' edicion', v_tabla);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
                   'USING (public.es_miembro_empresa(auth.uid(), empresa_id)) '
                   'WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id))',
                   v_tabla || ' edicion', v_tabla);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_tabla || ' baja', v_tabla);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated '
                   'USING (public.es_miembro_empresa(auth.uid(), empresa_id))',
                   v_tabla || ' baja', v_tabla);

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_tabla || '_touch', v_tabla);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
                   v_tabla || '_touch', v_tabla);

    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_tabla || '_auditoria', v_tabla);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar()',
                   v_tabla || '_auditoria', v_tabla);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 10. textil_compras y textil_compra_lineas: por empresa y por operación
-- ---------------------------------------------------------------------------
-- Mismos nombres que las políticas USING (true) que sustituyen. Lo que no
-- cambia en una compra registrada lo protegen los triggers (20261028100200 y
-- compra_registrada_inmutable()), no la política.
DROP POLICY IF EXISTS "compras lectura" ON public.textil_compras;
CREATE POLICY "compras lectura" ON public.textil_compras
  FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "compras alta" ON public.textil_compras;
CREATE POLICY "compras alta" ON public.textil_compras
  FOR INSERT TO authenticated
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id) AND estado = 'borrador');

DROP POLICY IF EXISTS "compras edicion" ON public.textil_compras;
CREATE POLICY "compras edicion" ON public.textil_compras
  FOR UPDATE TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id))
  WITH CHECK (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP POLICY IF EXISTS "compras baja" ON public.textil_compras;
CREATE POLICY "compras baja" ON public.textil_compras
  FOR DELETE TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id) AND estado = 'borrador');

DROP POLICY IF EXISTS "compra lineas lectura" ON public.textil_compra_lineas;
CREATE POLICY "compra lineas lectura" ON public.textil_compra_lineas
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.textil_compras c
                  WHERE c.id = textil_compra_lineas.compra_id
                    AND public.es_miembro_empresa(auth.uid(), c.empresa_id)));

DROP POLICY IF EXISTS "compra lineas alta" ON public.textil_compra_lineas;
CREATE POLICY "compra lineas alta" ON public.textil_compra_lineas
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.textil_compras c
                       WHERE c.id = textil_compra_lineas.compra_id
                         AND public.es_miembro_empresa(auth.uid(), c.empresa_id)));

DROP POLICY IF EXISTS "compra lineas edicion" ON public.textil_compra_lineas;
CREATE POLICY "compra lineas edicion" ON public.textil_compra_lineas
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.textil_compras c
                  WHERE c.id = textil_compra_lineas.compra_id
                    AND public.es_miembro_empresa(auth.uid(), c.empresa_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.textil_compras c
                       WHERE c.id = textil_compra_lineas.compra_id
                         AND public.es_miembro_empresa(auth.uid(), c.empresa_id)));

DROP POLICY IF EXISTS "compra lineas baja" ON public.textil_compra_lineas;
CREATE POLICY "compra lineas baja" ON public.textil_compra_lineas
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.textil_compras c
                  WHERE c.id = textil_compra_lineas.compra_id
                    AND public.es_miembro_empresa(auth.uid(), c.empresa_id)));

-- Que la API vea las tablas y columnas nuevas sin esperar.
NOTIFY pgrst, 'reload schema';
