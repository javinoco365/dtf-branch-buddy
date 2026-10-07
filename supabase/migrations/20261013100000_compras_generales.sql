-- ============================================================================
-- FACTURAS DE COMPRA DE TODO EL NEGOCIO (NO SOLO TEXTIL)
-- ============================================================================
--
-- QUÉ RESUELVE
--   Hasta ahora las facturas de compra eran solo del textil: cada línea tenía
--   que casar con una prenda del stock. Las demás compras (tinta, film,
--   mensajería, publicidad, una impresora…) no tenían dónde apuntarse, y su
--   IVA no llegaba al 303.
--
-- QUÉ CAMBIA
--   textil_compras (el nombre se queda para no romper nada; ahora guarda
--   todas las compras):
--     - categoria: qué se compra. Decide cómo cuenta en Gerencia:
--         textil            → entra en el stock; cuesta al venderse la prenda.
--         consumibles,envios→ solo IVA; Gerencia lo compara con el coste por
--                             metro y con los envíos de los pedidos.
--         maquinaria        → se amortiza: 12 % al año.
--         informatica       → se amortiza: 25 % al año.
--         el resto          → coste del día de la factura.
--       Las compras de antes son todas textil: quedan como «textil».
--     - irpf: la retención que lleva la factura (alquiler, profesionales). La
--       cuenta pasa a ser base + IVA − IRPF = total.
--     - gasto_id: el gasto fijo al que corresponde la factura (el alquiler de
--       marzo, la gestoría del trimestre). Ese periodo cuenta la factura real
--       en vez de la estimación del gasto fijo: no se cuenta dos veces.
--   textil_compra_registrar: solo las compras de textil necesitan casar sus
--   líneas con el stock; las demás se registran sin tocar el stock.
--
-- REVERSIBLE
--   Sí: quitar las tres columnas y volver a crear la función de
--   20260903260000_compras_textil.sql. Se puede aplicar dos veces sin cambiar
--   nada.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columnas nuevas
-- ---------------------------------------------------------------------------
ALTER TABLE public.textil_compras
  ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'textil',
  ADD COLUMN IF NOT EXISTS irpf NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gasto_id UUID
    REFERENCES public.gerencia_gastos_fijos(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE public.textil_compras
    ADD CONSTRAINT compra_categoria
      CHECK (categoria IN ('textil', 'consumibles', 'envios', 'maquinaria', 'informatica',
                           'publicidad', 'material', 'reparaciones', 'suministros',
                           'servicios', 'otros'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.textil_compras
    ADD CONSTRAINT compra_irpf CHECK (irpf >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- El textil va al stock: no sustituye a ningún gasto fijo.
DO $$ BEGIN
  ALTER TABLE public.textil_compras
    ADD CONSTRAINT compra_textil_sin_gasto CHECK (categoria <> 'textil' OR gasto_id IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS textil_compras_por_gasto
  ON public.textil_compras (gasto_id) WHERE gasto_id IS NOT NULL;

COMMENT ON COLUMN public.textil_compras.categoria IS
  'Qué se compra: textil (al stock), consumibles, envios, maquinaria, informatica, publicidad, '
  'material, reparaciones, suministros, servicios u otros. Decide cómo cuenta en Gerencia.';
COMMENT ON COLUMN public.textil_compras.irpf IS
  'Retención de IRPF de la factura, en euros. base + iva − irpf = total.';
COMMENT ON COLUMN public.textil_compras.gasto_id IS
  'Gasto fijo al que corresponde: en su periodo cuenta esta factura en vez de la estimación.';

-- ---------------------------------------------------------------------------
-- 2. Registrar: solo el textil toca el stock
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

  IF v_compra.categoria = 'textil' THEN
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
  END IF;

  UPDATE public.textil_compras SET estado = 'registrada' WHERE id = _compra_id;
  RETURN v_n;
END;
$$;

COMMENT ON FUNCTION public.textil_compra_registrar(UUID) IS
  'Registra una compra. Si es de textil, convierte sus líneas en entradas de stock al coste de '
  'la factura y falla si alguna no está casada con una variante. Falla si la compra ya estaba '
  'registrada: la misma factura no entra dos veces.';

REVOKE EXECUTE ON FUNCTION public.textil_compra_registrar(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.textil_compra_registrar(UUID) TO authenticated, service_role;
