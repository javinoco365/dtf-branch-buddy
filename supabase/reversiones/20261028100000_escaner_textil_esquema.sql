-- ============================================================================
-- REVERSIÓN de 20261028100000_escaner_textil_esquema.sql
-- ============================================================================
-- La última de las tres reversiones del escáner textil: después de las de
-- 20261028100200 y 20261028100100. Solo con autorización expresa de Javier:
-- borra tablas y columnas.
--
-- Repone las políticas USING (true) de textil_compras y textil_compra_lineas
-- (copiadas de 20260903260000_compras_textil.sql); quita las columnas nuevas
-- (antes que las funciones de normalización de las que dependen sus columnas
-- generadas), la CHECK stock_linea_con_compra, la restricción
-- compra_linea_id_compra, las tablas textil_referencias_proveedor,
-- textil_productos y proveedores, y las cuatro funciones de normalización.
--
-- Qué se pierde: el catálogo de productos y proveedores, la memoria, el tipo,
-- la referencia, el color, la talla y el EAN de las líneas, el enlace
-- movimiento → compra, la fecha de los movimientos y el coste congelado de las
-- líneas de presupuesto y pedido. Qué NO se pierde: las unidades y el coste
-- medio del stock, los movimientos y las compras registradas. Las filas de
-- auditoría que se hayan escrito se quedan: la tabla es append-only.
-- ============================================================================

BEGIN;

-- Políticas de antes, copiadas de 20260903260000_compras_textil.sql.
DROP POLICY IF EXISTS "compras lectura" ON public.textil_compras;
CREATE POLICY "compras lectura" ON public.textil_compras
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "compras alta" ON public.textil_compras;
CREATE POLICY "compras alta" ON public.textil_compras
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "compras edicion" ON public.textil_compras;
CREATE POLICY "compras edicion" ON public.textil_compras
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "compras baja" ON public.textil_compras;
CREATE POLICY "compras baja" ON public.textil_compras
  FOR DELETE TO authenticated USING (estado = 'borrador');

DROP POLICY IF EXISTS "compra lineas lectura" ON public.textil_compra_lineas;
CREATE POLICY "compra lineas lectura" ON public.textil_compra_lineas
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "compra lineas alta" ON public.textil_compra_lineas;
CREATE POLICY "compra lineas alta" ON public.textil_compra_lineas
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "compra lineas edicion" ON public.textil_compra_lineas;
CREATE POLICY "compra lineas edicion" ON public.textil_compra_lineas
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "compra lineas baja" ON public.textil_compra_lineas;
CREATE POLICY "compra lineas baja" ON public.textil_compra_lineas
  FOR DELETE TO authenticated USING (true);

-- Movimientos: primero el enlace a la línea (la FK compuesta depende de la
-- restricción compra_linea_id_compra).
ALTER TABLE public.textil_stock_movimientos
  DROP CONSTRAINT IF EXISTS stock_mov_linea_de_su_compra,
  DROP CONSTRAINT IF EXISTS stock_linea_con_compra;
DROP INDEX IF EXISTS public.textil_stock_mov_por_compra;
DROP INDEX IF EXISTS public.textil_stock_mov_por_fecha;
ALTER TABLE public.textil_stock_movimientos
  DROP COLUMN IF EXISTS compra_linea_id,
  DROP COLUMN IF EXISTS compra_id,
  DROP COLUMN IF EXISTS fecha;

-- Líneas de compra.
ALTER TABLE public.textil_compra_lineas DROP CONSTRAINT IF EXISTS compra_linea_id_compra;
ALTER TABLE public.textil_compra_lineas
  DROP COLUMN IF EXISTS casado_metodo,
  DROP COLUMN IF EXISTS coste_unitario_entrada,
  DROP COLUMN IF EXISTS coste_total_entrada,
  DROP COLUMN IF EXISTS unidades_stock,
  DROP COLUMN IF EXISTS unidades_por_pack,
  DROP COLUMN IF EXISTS ean,
  DROP COLUMN IF EXISTS talla,
  DROP COLUMN IF EXISTS color,
  DROP COLUMN IF EXISTS modelo,
  DROP COLUMN IF EXISTS marca,
  DROP COLUMN IF EXISTS referencia,
  DROP COLUMN IF EXISTS tipo;

-- Coste congelado de presupuestos y pedidos textil.
ALTER TABLE public.textil_presupuesto_items DROP COLUMN IF EXISTS coste_unit_snapshot;
ALTER TABLE public.textil_pedido_items DROP COLUMN IF EXISTS coste_unit_snapshot;

-- La memoria apunta a proveedores, variantes y compras: se va antes.
DROP TABLE IF EXISTS public.textil_referencias_proveedor;

-- Compras: el enlace al proveedor.
DROP INDEX IF EXISTS public.textil_compras_por_proveedor;
ALTER TABLE public.textil_compras DROP COLUMN IF EXISTS proveedor_id;

-- Variantes.
DROP INDEX IF EXISTS public.textil_stock_por_producto;
ALTER TABLE public.textil_stock DROP CONSTRAINT IF EXISTS textil_stock_ean_formato;
ALTER TABLE public.textil_stock
  DROP COLUMN IF EXISTS fusionada_en,
  DROP COLUMN IF EXISTS talla_clave,
  DROP COLUMN IF EXISTS color_clave,
  DROP COLUMN IF EXISTS repetida,
  DROP COLUMN IF EXISTS ean,
  DROP COLUMN IF EXISTS producto_id;

DROP TABLE IF EXISTS public.textil_productos;
DROP TABLE IF EXISTS public.proveedores;

DROP FUNCTION IF EXISTS public.textil_clave_memoria(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.nif_clave(TEXT);
DROP FUNCTION IF EXISTS public.textil_clave_talla(TEXT);
DROP FUNCTION IF EXISTS public.textil_clave(TEXT);

NOTIFY pgrst, 'reload schema';

COMMIT;
