-- ============================================================================
-- TEXTIL · Cobros de los pedidos, también parciales
-- ============================================================================
--
-- QUÉ RESUELVE
--   Un pedido textil tenía un total y un «método de pago» de texto libre, pero
--   ningún sitio donde apuntar lo que el cliente ha pagado de verdad. Y a
--   menudo no lo paga de una vez: paga el textil al encargarlo y la
--   personalización al recogerlo. Hoy eso no se puede reflejar.
--
-- QUÉ HACE
--   1. textil_cobros: cada fila es un cobro contra un pedido textil, con su
--      importe, su fecha y su método (efectivo, tarjeta o transferencia). Un
--      pedido puede tener varios. Lo pendiente es total − cobrado.
--   2. textil_registrar_cobro(): registra un cobro. Si es en efectivo, crea en
--      la misma transacción el apunte de ingreso en Caja y los deja enlazados.
--      Si es con tarjeta o transferencia, no crea nada más: la Facturación
--      Consolidada lee directamente estos cobros.
--   3. textil_borrar_cobro(): borra un cobro y, si lo tenía, su apunte de caja,
--      también en una sola transacción.
--
-- POR QUÉ UNA FUNCIÓN Y NO DOS ESCRITURAS DESDE LA APLICACIÓN
--   Cobro y apunte de caja van juntos o no van. Con dos escrituras sueltas, un
--   fallo entre la primera y la segunda deja un pedido cobrado sin el dinero en
--   caja, o dinero en caja que no consta como cobro de nada. Aquí es una sola
--   transacción: o las dos filas, o ninguna.
--
--   Además la función bloquea el pedido (FOR UPDATE) antes de sumar lo ya
--   cobrado. Sin eso, dos cobros registrados a la vez podrían pasar los dos la
--   comprobación de «no cobrar más que el total» y entre los dos pasarse.
--
-- REGLAS QUE VIVEN EN LA BASE
--   - El importe es positivo y nunca deja cobrado más que el total del pedido.
--   - Un pedido cancelado no admite cobros.
--   - El cobro en efectivo exige un concepto de caja de INGRESO. El trigger de
--     caja pone la categoría que diga el concepto, así que un concepto de gasto
--     convertiría el cobro en un gasto sin que nadie lo notara: se comprueba
--     antes.
--   - El cobro con tarjeta o transferencia no lleva apunte de caja: la caja es
--     el efectivo, y ese dinero no pasa por ella.
--   - Un cobro no se edita: se borra y se registra de nuevo. Así el apunte de
--     caja que arrastra nunca se queda desfasado del cobro.
--   - Un pedido con cobros no se borra (ON DELETE RESTRICT), ni el apunte de
--     caja que viene de un cobro se borra desde Caja: el dinero entró y tiene
--     que seguir constando. Primero se borra el cobro.
--
-- REVERSIBLE
--   Sí. Una tabla, un tipo y dos funciones nuevas. No toca nada existente.
--   DROP TABLE textil_cobros se llevaría los cobros apuntados; los apuntes de
--   caja que crearon se quedan en Caja.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE public.textil_cobro_metodo AS ENUM ('efectivo', 'tarjeta', 'transferencia');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'El tipo public.textil_cobro_metodo ya existe, se omite';
END $$;

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.textil_cobros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  pedido_id UUID NOT NULL REFERENCES public.textil_pedidos(id) ON DELETE RESTRICT,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  importe NUMERIC(12,2) NOT NULL,
  metodo public.textil_cobro_metodo NOT NULL,
  -- Solo en efectivo. RESTRICT: el apunte no se borra desde Caja mientras el
  -- cobro exista; se borra el cobro y la función se lleva el apunte.
  caja_movimiento_id UUID REFERENCES public.caja_movimientos(id) ON DELETE RESTRICT,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT textil_cobro_importe_positivo CHECK (importe > 0),
  CONSTRAINT textil_cobro_caja_solo_efectivo CHECK (
    (metodo = 'efectivo' AND caja_movimiento_id IS NOT NULL)
    OR
    (metodo <> 'efectivo' AND caja_movimiento_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS textil_cobros_por_pedido
  ON public.textil_cobros (pedido_id);
CREATE INDEX IF NOT EXISTS textil_cobros_por_fecha
  ON public.textil_cobros (empresa_id, fecha DESC);
CREATE UNIQUE INDEX IF NOT EXISTS textil_cobros_un_apunte_por_cobro
  ON public.textil_cobros (caja_movimiento_id) WHERE caja_movimiento_id IS NOT NULL;

COMMENT ON TABLE public.textil_cobros IS
  'Cobros de los pedidos textil. Varios por pedido: lo pendiente es total − '
  'cobrado. Se escriben solo con textil_registrar_cobro() y textil_borrar_cobro().';
COMMENT ON COLUMN public.textil_cobros.importe IS
  'Lo cobrado, IVA incluido. Siempre positivo.';
COMMENT ON COLUMN public.textil_cobros.caja_movimiento_id IS
  'El apunte de ingreso en Caja, solo si el cobro fue en efectivo.';

-- ---------------------------------------------------------------------------
-- 2. Registrar un cobro
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.textil_registrar_cobro(
  _pedido_id UUID,
  _fecha DATE,
  _importe NUMERIC,
  _metodo public.textil_cobro_metodo,
  _concepto_caja_id UUID DEFAULT NULL,
  _notas TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_pedido RECORD;
  v_cobrado NUMERIC;
  v_concepto RECORD;
  v_caja_id UUID;
  v_cobro_id UUID;
BEGIN
  IF _importe IS NULL OR _importe <= 0 THEN
    RAISE EXCEPTION 'El importe tiene que ser mayor que cero';
  END IF;

  -- El bloqueo es lo que impide que dos cobros a la vez se pasen del total.
  SELECT p.id, p.numero, p.empresa_id, p.total, p.estado, p.cliente_nombre
    INTO v_pedido
    FROM public.textil_pedidos p
   WHERE p.id = _pedido_id
     FOR UPDATE;

  IF v_pedido.id IS NULL THEN
    RAISE EXCEPTION 'El pedido % no existe', _pedido_id;
  END IF;
  IF v_pedido.estado = 'cancelado' THEN
    RAISE EXCEPTION 'El pedido % está cancelado y no admite cobros', v_pedido.numero;
  END IF;

  SELECT COALESCE(sum(c.importe), 0) INTO v_cobrado
    FROM public.textil_cobros c WHERE c.pedido_id = _pedido_id;

  -- Comparación en céntimos: total y cobros son NUMERIC, pero el total de un
  -- pedido viejo puede traer más de dos decimales.
  IF round(v_cobrado + _importe, 2) > round(v_pedido.total, 2) THEN
    RAISE EXCEPTION 'El pedido % solo tiene % € pendientes: no se pueden cobrar % €',
      v_pedido.numero, round(v_pedido.total - v_cobrado, 2), _importe;
  END IF;

  IF _metodo = 'efectivo' THEN
    IF _concepto_caja_id IS NULL THEN
      RAISE EXCEPTION 'Un cobro en efectivo necesita un concepto de caja';
    END IF;

    SELECT cc.categoria, cc.nombre INTO v_concepto
      FROM public.caja_conceptos cc WHERE cc.id = _concepto_caja_id;
    IF v_concepto.nombre IS NULL THEN
      RAISE EXCEPTION 'El concepto de caja % no existe', _concepto_caja_id;
    END IF;
    -- El trigger de caja le pondría la categoría del concepto: un concepto de
    -- gasto convertiría el cobro en un gasto sin que nadie lo notara.
    IF v_concepto.categoria <> 'ingreso' THEN
      RAISE EXCEPTION '«%» es un concepto de gasto: un cobro va en un concepto de ingreso',
        v_concepto.nombre;
    END IF;

    -- categoria y concepto_nombre los sobrescribe el trigger de caja; van
    -- porque las columnas son NOT NULL. El cliente textil no es un cliente de
    -- las tiendas, así que va como nombre suelto, sin cliente_id.
    INSERT INTO public.caja_movimientos
      (empresa_id, fecha, categoria, concepto_id, concepto_nombre,
       cliente_nombre, importe, observaciones)
    VALUES
      (v_pedido.empresa_id, _fecha, 'ingreso', _concepto_caja_id, '',
       v_pedido.cliente_nombre, _importe,
       'Cobro del pedido textil ' || v_pedido.numero)
    RETURNING id INTO v_caja_id;
  ELSIF _concepto_caja_id IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el cobro en efectivo va a caja: sobra el concepto de caja';
  END IF;

  INSERT INTO public.textil_cobros
    (empresa_id, pedido_id, fecha, importe, metodo, caja_movimiento_id, notas)
  VALUES
    (v_pedido.empresa_id, _pedido_id, _fecha, _importe, _metodo, v_caja_id,
     NULLIF(TRIM(COALESCE(_notas, '')), ''))
  RETURNING id INTO v_cobro_id;

  RETURN v_cobro_id;
END;
$$;

COMMENT ON FUNCTION public.textil_registrar_cobro IS
  'Registra un cobro de un pedido textil. En efectivo, crea también el apunte '
  'de ingreso en Caja, en la misma transacción.';

-- ---------------------------------------------------------------------------
-- 3. Borrar un cobro
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.textil_borrar_cobro(_cobro_id UUID)
RETURNS VOID
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_caja_id UUID;
BEGIN
  DELETE FROM public.textil_cobros
   WHERE id = _cobro_id
  RETURNING caja_movimiento_id INTO v_caja_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cobro % no existe', _cobro_id;
  END IF;

  -- Primero el cobro, que es quien apunta al apunte: al revés, el RESTRICT lo
  -- impediría.
  IF v_caja_id IS NOT NULL THEN
    DELETE FROM public.caja_movimientos WHERE id = v_caja_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.textil_borrar_cobro IS
  'Borra un cobro textil y, si fue en efectivo, su apunte de Caja.';

-- Las dos funciones las llama la aplicación desde el servidor, con el rol de
-- servicio. No se exponen a quien entra con la clave pública.
REVOKE ALL ON FUNCTION public.textil_registrar_cobro FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.textil_borrar_cobro FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.textil_registrar_cobro TO service_role;
GRANT EXECUTE ON FUNCTION public.textil_borrar_cobro TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Permisos, RLS y auditoría
-- ---------------------------------------------------------------------------
-- Se lee desde el navegador (la Facturación Consolidada y la lista de
-- pedidos); se escribe solo por las funciones de arriba. Sin UPDATE: un cobro
-- no se edita, se borra y se vuelve a registrar.
GRANT SELECT ON public.textil_cobros TO authenticated;
GRANT ALL ON public.textil_cobros TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.textil_cobros FROM authenticated, anon;

ALTER TABLE public.textil_cobros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "textil_cobros lectura" ON public.textil_cobros;
CREATE POLICY "textil_cobros lectura" ON public.textil_cobros
  FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP TRIGGER IF EXISTS textil_cobros_auditoria ON public.textil_cobros;
CREATE TRIGGER textil_cobros_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.textil_cobros
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();
