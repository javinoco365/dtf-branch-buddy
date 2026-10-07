-- ============================================================================
-- REVERSIÓN de 20261017100000_conciliacion_motor.sql
-- ============================================================================
-- Devuelve la conciliación a «un ingreso ↔ una factura emitida».
--
-- No borra nada: si hay enlaces que el esquema anterior no sabe guardar
-- (facturas recibidas, textil, grupos de varios, «revisar») o traspasos
-- marcados, se niega y hay que deshacerlos antes desde la pantalla.
-- ============================================================================

BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.banco_conciliaciones
              WHERE compra_id IS NOT NULL OR textil_factura_id IS NOT NULL OR estado <> 'conciliada')
     OR EXISTS (SELECT 1 FROM public.banco_conciliaciones GROUP BY grupo HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM public.banco_movimientos WHERE traspaso_con IS NOT NULL) THEN
    RAISE EXCEPTION 'Hay enlaces o traspasos que el esquema anterior no sabe guardar: '
                    'deshazlos antes de revertir.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.banco_enlazar(UUID[], JSONB, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.banco_enlazar_como(UUID, UUID[], JSONB, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.banco_confirmar(UUID);
DROP FUNCTION IF EXISTS public.banco_desenlazar(UUID);
DROP FUNCTION IF EXISTS public.banco_desenlazar_como(UUID, UUID);
DROP FUNCTION IF EXISTS public.banco_aplicar_efectos(UUID, UUID);
DROP FUNCTION IF EXISTS public.banco_marcar_traspaso(UUID, UUID);
DROP FUNCTION IF EXISTS public.banco_desmarcar_traspaso(UUID);

ALTER TABLE public.banco_movimientos DROP COLUMN IF EXISTS traspaso_con;

DROP INDEX IF EXISTS public.conciliacion_par_factura;
DROP INDEX IF EXISTS public.conciliacion_par_compra;
DROP INDEX IF EXISTS public.conciliacion_par_textil;
DROP INDEX IF EXISTS public.conciliacion_por_movimiento;
DROP INDEX IF EXISTS public.conciliacion_por_factura;
DROP INDEX IF EXISTS public.conciliacion_por_compra;
DROP INDEX IF EXISTS public.conciliacion_por_textil;
DROP INDEX IF EXISTS public.conciliacion_por_grupo;

ALTER TABLE public.banco_conciliaciones
  DROP CONSTRAINT IF EXISTS conciliacion_un_documento,
  DROP CONSTRAINT IF EXISTS conciliacion_estado,
  DROP COLUMN IF EXISTS compra_id,
  DROP COLUMN IF EXISTS textil_factura_id,
  DROP COLUMN IF EXISTS estado,
  DROP COLUMN IF EXISTS grupo,
  DROP COLUMN IF EXISTS importe,
  DROP COLUMN IF EXISTS marco_pagada,
  ALTER COLUMN factura_id SET NOT NULL,
  ADD CONSTRAINT conciliacion_movimiento_unico UNIQUE (movimiento_id),
  ADD CONSTRAINT conciliacion_factura_unica UNIQUE (factura_id);

COMMENT ON TABLE public.banco_conciliaciones IS
  'Qué ingreso paga qué factura. Uno a uno por construcción.';

GRANT INSERT, DELETE ON public.banco_conciliaciones TO authenticated;
DROP POLICY IF EXISTS "conciliaciones baja" ON public.banco_conciliaciones;
CREATE POLICY "conciliaciones baja" ON public.banco_conciliaciones
  FOR DELETE TO authenticated USING (true);

-- Las dos funciones como estaban (20261003100000).
CREATE OR REPLACE FUNCTION public.banco_conciliar(
  _usuario_id UUID,
  _movimiento_id UUID,
  _factura_id UUID,
  _motivo TEXT DEFAULT 'importe'
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mov RECORD;
  v_fac RECORD;
  v_id UUID;
BEGIN
  SELECT * INTO v_mov FROM public.banco_movimientos WHERE id = _movimiento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El movimiento no existe'; END IF;

  SELECT * INTO v_fac FROM public.facturas WHERE id = _factura_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La factura no existe'; END IF;

  IF v_fac.estado = 'borrador' THEN
    RAISE EXCEPTION 'La factura todavía es un borrador: emítela antes de darla por cobrada.';
  END IF;
  IF v_mov.importe <= 0 THEN
    RAISE EXCEPTION 'Un cargo no paga una factura.';
  END IF;

  INSERT INTO public.banco_conciliaciones
    (movimiento_id, factura_id, motivo, diferencia, conciliado_por)
  VALUES (_movimiento_id, _factura_id, _motivo,
          round(v_mov.importe - v_fac.total, 2), _usuario_id)
  RETURNING id INTO v_id;

  PERFORM public.factura_cambiar_estado_cobro(_usuario_id, _factura_id, 'pagada');

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.banco_desconciliar(_usuario_id UUID, _movimiento_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_factura UUID;
BEGIN
  DELETE FROM public.banco_conciliaciones
   WHERE movimiento_id = _movimiento_id
   RETURNING factura_id INTO v_factura;

  IF v_factura IS NULL THEN RETURN false; END IF;

  PERFORM public.factura_cambiar_estado_cobro(_usuario_id, v_factura, 'emitida');
  RETURN true;
END;
$$;

COMMIT;
