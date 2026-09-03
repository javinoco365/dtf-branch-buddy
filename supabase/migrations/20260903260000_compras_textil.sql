-- ============================================================================
-- COMPRAS TEXTIL · La factura del proveedor entra en el stock
-- ============================================================================
--
-- QUÉ RESUELVE
--   Hoy el stock se da de alta a mano, variante a variante. Llega un albarán de
--   200 camisetas en cinco tallas y hay que teclear cinco veces cantidad y
--   coste. Se teclea mal y no se nota hasta el recuento.
--
-- CÓMO FUNCIONA
--   Se sube el PDF o la foto de la factura del proveedor, un modelo de lenguaje
--   la lee, y lo que lee se enseña PARA REVISAR. Nada entra en el stock hasta
--   que se confirma línea por línea contra una variante del catálogo.
--
--   Esto último no es cortesía: los movimientos de stock no se borran. Un «12»
--   leído como «120» quedaría anotado para siempre y solo se podría corregir
--   con un ajuste de inventario, dejando el rastro de un error que nunca
--   ocurrió. La IA propone; la persona firma.
--
-- LOS DOS ESTADOS
--   borrador    se puede editar y borrar entera. No ha tocado el stock.
--   registrada  ya generó movimientos de compra. Las líneas se congelan.
--
--   Una compra registrada no se «desregistra»: si algo estaba mal, se corrige
--   con un ajuste de inventario, que es lo que deja constancia de qué pasó.
--
-- REVERSIBLE
--   Sí. Dos tablas nuevas, un bucket y una función. No toca nada existente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- El fichero: privado, al contrario que los logos
-- ---------------------------------------------------------------------------
-- Una factura de un proveedor lleva sus precios, su NIF y a veces su cuenta
-- bancaria. No es un logo: no se sirve en abierto. Se lee con URL firmada.
INSERT INTO storage.buckets (id, name, public)
VALUES ('compras', 'compras', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "compras_lectura" ON storage.objects;
CREATE POLICY "compras_lectura"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'compras');

DROP POLICY IF EXISTS "compras_alta" ON storage.objects;
CREATE POLICY "compras_alta"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'compras' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "compras_borrado" ON storage.objects;
CREATE POLICY "compras_borrado"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'compras' AND public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- La compra
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.textil_compras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  proveedor TEXT,
  nif_proveedor TEXT,
  numero TEXT,
  fecha DATE,
  base NUMERIC NOT NULL DEFAULT 0,
  iva NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  fichero_ruta TEXT,
  -- Lo que leyó el modelo, tal cual. Se guarda para poder comparar después lo
  -- que dijo con lo que se corrigió a mano: es la única forma de saber si el
  -- lector sirve o hay que cambiarlo.
  lectura_ia JSONB,
  estado TEXT NOT NULL DEFAULT 'borrador',
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT compra_estado CHECK (estado IN ('borrador', 'registrada')),
  -- El mismo número del mismo proveedor no se registra dos veces. Es el freno
  -- contra subir el mismo albarán por segunda vez y doblar el stock.
  CONSTRAINT compra_unica UNIQUE (empresa_id, proveedor, numero)
);

COMMENT ON TABLE public.textil_compras IS
  'Facturas de compra de género. En borrador no han tocado el stock; al '
  'registrarlas generan movimientos de compra y se congelan.';

CREATE INDEX IF NOT EXISTS textil_compras_por_fecha
  ON public.textil_compras (fecha DESC);

CREATE TABLE IF NOT EXISTS public.textil_compra_lineas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id UUID NOT NULL REFERENCES public.textil_compras(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  cantidad NUMERIC NOT NULL,
  precio_unitario NUMERIC NOT NULL DEFAULT 0,
  importe NUMERIC NOT NULL DEFAULT 0,
  unidad TEXT,
  -- A qué variante del catálogo corresponde. NULL mientras no se haya casado:
  -- una línea sin casar no entra en el stock, pero tampoco se pierde.
  stock_id UUID REFERENCES public.textil_stock(id) ON DELETE SET NULL,
  orden INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT compra_linea_cantidad CHECK (cantidad > 0)
);

CREATE INDEX IF NOT EXISTS textil_compra_lineas_por_compra
  ON public.textil_compra_lineas (compra_id, orden);

DROP TRIGGER IF EXISTS textil_compras_touch ON public.textil_compras;
CREATE TRIGGER textil_compras_touch
  BEFORE UPDATE ON public.textil_compras
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Una compra registrada ya no se toca
-- ---------------------------------------------------------------------------
-- Sus líneas generaron movimientos, y los movimientos no se borran. Cambiar la
-- línea después dejaría el libro contando una historia y la compra otra.
CREATE OR REPLACE FUNCTION public.compra_registrada_inmutable()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_estado TEXT;
BEGIN
  SELECT estado INTO v_estado FROM public.textil_compras
   WHERE id = COALESCE(NEW.compra_id, OLD.compra_id);

  IF v_estado = 'registrada' THEN
    RAISE EXCEPTION
      'La compra ya está registrada y sus líneas movieron stock. Para corregir, '
      'haz un ajuste de inventario.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS textil_compra_lineas_inmutables ON public.textil_compra_lineas;
CREATE TRIGGER textil_compra_lineas_inmutables
  BEFORE INSERT OR UPDATE OR DELETE ON public.textil_compra_lineas
  FOR EACH ROW EXECUTE FUNCTION public.compra_registrada_inmutable();

-- ---------------------------------------------------------------------------
-- Registrar: las líneas casadas entran en el libro
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.textil_compra_registrar(_compra_id UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_compra RECORD;
  v_sin_casar INT;
  r RECORD;
  v_n INT := 0;
BEGIN
  SELECT * INTO v_compra FROM public.textil_compras WHERE id = _compra_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La compra no existe';
  END IF;
  IF v_compra.estado = 'registrada' THEN
    RAISE EXCEPTION 'La compra % ya estaba registrada', COALESCE(v_compra.numero, '(sin número)')
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT count(*) INTO v_sin_casar
    FROM public.textil_compra_lineas WHERE compra_id = _compra_id AND stock_id IS NULL;
  IF v_sin_casar > 0 THEN
    RAISE EXCEPTION
      'Hay % línea(s) sin asignar a una variante del catálogo. Asígnalas o '
      'bórralas antes de registrar.', v_sin_casar
      USING ERRCODE = 'restrict_violation';
  END IF;

  FOR r IN
    SELECT stock_id, cantidad, precio_unitario
      FROM public.textil_compra_lineas WHERE compra_id = _compra_id ORDER BY orden
  LOOP
    INSERT INTO public.textil_stock_movimientos
      (empresa_id, stock_id, motivo, cantidad, coste_unitario, nota)
    VALUES (v_compra.empresa_id, r.stock_id, 'compra', r.cantidad, r.precio_unitario,
            'Compra ' || COALESCE(v_compra.numero, '(sin número)') ||
            COALESCE(' de ' || v_compra.proveedor, ''));
    v_n := v_n + 1;
  END LOOP;

  UPDATE public.textil_compras SET estado = 'registrada' WHERE id = _compra_id;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.textil_compra_registrar(UUID) IS
  'Convierte las líneas de una compra en entradas de stock al coste de la '
  'factura. Falla si alguna línea no está casada con una variante, y falla si '
  'la compra ya estaba registrada: el mismo albarán no entra dos veces.';

REVOKE EXECUTE ON FUNCTION public.textil_compra_registrar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.textil_compra_registrar(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Permisos, RLS y auditoría
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.textil_compras TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.textil_compra_lineas TO authenticated;
GRANT ALL ON public.textil_compras TO service_role;
GRANT ALL ON public.textil_compra_lineas TO service_role;

ALTER TABLE public.textil_compras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.textil_compra_lineas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "compras lectura" ON public.textil_compras;
CREATE POLICY "compras lectura" ON public.textil_compras
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "compras alta" ON public.textil_compras;
CREATE POLICY "compras alta" ON public.textil_compras
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "compras edicion" ON public.textil_compras;
CREATE POLICY "compras edicion" ON public.textil_compras
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Solo se borra un borrador. Una registrada movió stock: se queda como
-- justificante de por qué entró ese género.
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

DROP TRIGGER IF EXISTS textil_compras_auditoria ON public.textil_compras;
CREATE TRIGGER textil_compras_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.textil_compras
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

DROP TRIGGER IF EXISTS textil_compra_lineas_auditoria ON public.textil_compra_lineas;
CREATE TRIGGER textil_compra_lineas_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.textil_compra_lineas
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();
