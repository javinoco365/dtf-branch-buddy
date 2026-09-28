-- ============================================================================
-- COBROS · Una sola tabla para lo cobrado, de las tiendas y del textil
-- ============================================================================
--
-- QUÉ RESUELVE
--   Los cobros solo existían en el textil (textil_cobros). Un pedido de tienda
--   no tenía dónde apuntar lo que el cliente ha pagado: ni un anticipo, ni el
--   resto al recoger, ni una propina. Y la Facturación Consolidada sumaba el
--   total de los pedidos, cobrados o no.
--
-- QUÉ HACE
--   1. cobros: cada fila es dinero recibido contra un pedido de tienda o un
--      pedido textil (uno de los dos, nunca ninguno ni ambos). Guarda aparte
--      lo que se aplica al pedido (importe) y lo que es propina.
--   2. registrar_cobro(): registra un cobro. Si lo recibido supera lo
--      pendiente, exige que se marque como propina y separa el exceso. En
--      efectivo, crea el apunte de ingreso en Caja —importe más propina— en
--      la misma transacción.
--   3. borrar_cobro(): borra un cobro y, si lo tenía, su apunte de caja.
--   4. Cobro «web» automático: un pedido de WooCommerce pagado lleva un cobro
--      por su total con método web. Lo mantiene un trigger sobre pedidos: se
--      crea al llegar pagado, se ajusta si cambia el total y se quita si el
--      pedido se cancela o se reembolsa.
--   5. Lo ya cobrado entra como «previo» (sin presupuesto detrás):
--        - los cobros textil que ya había, copiados con su mismo id;
--        - los pedidos de WooCommerce ya pagados, con su cobro web;
--        - los pedidos manuales de tienda que constan como pagados, con un
--          cobro «sin especificar» por su total (no se sabe cómo se cobró).
--   6. textil_cobros queda OBSOLETA: no se borra ni se vacía, pero deja de
--      escribirse y suelta sus claves foráneas para no bloquear el borrado de
--      los cobros y apuntes que ahora gobierna la tabla nueva.
--
-- REGLAS QUE VIVEN EN LA BASE
--   - Un cobro nunca aplica al pedido más que lo pendiente. Lo que sobra es
--     propina, y solo si se marca expresamente: si no, se rechaza.
--   - El pedido se bloquea (FOR UPDATE) antes de sumar lo cobrado: dos cobros
--     a la vez no pueden pasarse del total entre los dos.
--   - Un pedido cancelado no admite cobros. Un pedido de WooCommerce tampoco
--     admite cobros a mano: se cobra en la web y su cobro lo pone el trigger.
--   - El efectivo exige un concepto de caja de INGRESO: el trigger de caja
--     pone la categoría del concepto, y uno de gasto convertiría el cobro en
--     un gasto sin que nadie lo notara.
--   - Solo el efectivo lleva apunte de caja, y todo efectivo lo lleva.
--   - Un cobro no se edita: se borra y se registra de nuevo.
--   - Un pedido con cobros hechos a mano no se borra (ON DELETE RESTRICT); los
--     automáticos (web y los previos creados aquí) se van con el pedido.
--   - Una tienda con cobros hechos a mano no se borra: se desactiva.
--
-- LO QUE NO TOCA
--   estado_pago de los pedidos no cambia. La Facturación Consolidada todavía
--   no lee esta tabla para las tiendas: eso es la fase siguiente.
--
-- REVERSIBLE
--   En su mayor parte. DROP TABLE cobros se llevaría los cobros de tienda
--   registrados después; los textil anteriores siguen en textil_cobros. Para
--   volver atrás del todo habría que restaurar las dos claves foráneas de
--   textil_cobros y sus dos funciones (20260927100000_textil_cobros.sql).
--
-- ANTES DE APLICAR, cuántos cobros «previo» va a crear:
--   SELECT origen, count(*), sum(total) FROM public.pedidos
--    WHERE cancelado_en IS NULL AND estado_pago IN ('pagado', 'parcial')
--      AND total > 0 GROUP BY origen;
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE public.cobro_metodo AS ENUM (
    'efectivo',
    'tarjeta',
    'transferencia',
    'web',             -- pagado en la tienda online; lo crea la sincronización
    'sin_especificar'  -- cobros previos de los que no consta el método
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'El tipo public.cobro_metodo ya existe, se omite';
END $$;

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cobros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  pedido_id UUID REFERENCES public.pedidos(id) ON DELETE RESTRICT,
  textil_pedido_id UUID REFERENCES public.textil_pedidos(id) ON DELETE RESTRICT,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  importe NUMERIC(12,2) NOT NULL,
  propina NUMERIC(12,2) NOT NULL DEFAULT 0,
  metodo public.cobro_metodo NOT NULL,
  -- Solo en efectivo. RESTRICT: el apunte no se borra desde Caja mientras el
  -- cobro exista; se borra el cobro y la función se lleva el apunte.
  caja_movimiento_id UUID REFERENCES public.caja_movimientos(id) ON DELETE RESTRICT,
  previo BOOLEAN NOT NULL DEFAULT false,
  automatico BOOLEAN NOT NULL DEFAULT false,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT cobro_de_un_solo_pedido CHECK (num_nonnulls(pedido_id, textil_pedido_id) = 1),
  CONSTRAINT cobro_importe_no_negativo CHECK (importe >= 0),
  CONSTRAINT cobro_propina_no_negativa CHECK (propina >= 0),
  CONSTRAINT cobro_no_vacio CHECK (importe + propina > 0),
  CONSTRAINT cobro_caja_solo_efectivo CHECK (
    (metodo = 'efectivo') = (caja_movimiento_id IS NOT NULL)
  ),
  CONSTRAINT cobro_web_solo_automatico CHECK (
    metodo <> 'web' OR (automatico AND pedido_id IS NOT NULL AND propina = 0)
  )
);

CREATE INDEX IF NOT EXISTS cobros_por_pedido
  ON public.cobros (pedido_id) WHERE pedido_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cobros_por_pedido_textil
  ON public.cobros (textil_pedido_id) WHERE textil_pedido_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cobros_por_fecha
  ON public.cobros (empresa_id, fecha DESC);
CREATE UNIQUE INDEX IF NOT EXISTS cobros_un_apunte_por_cobro
  ON public.cobros (caja_movimiento_id) WHERE caja_movimiento_id IS NOT NULL;
-- La clave del upsert del cobro web: uno por pedido, nunca dos.
CREATE UNIQUE INDEX IF NOT EXISTS cobros_un_web_por_pedido
  ON public.cobros (pedido_id) WHERE metodo = 'web';

COMMENT ON TABLE public.cobros IS
  'Dinero recibido por pedidos de tienda y textil. Varios por pedido: lo '
  'pendiente es total − suma(importe). Se escribe con registrar_cobro(), '
  'borrar_cobro() y el trigger de cobro web de pedidos.';
COMMENT ON COLUMN public.cobros.importe IS
  'Lo que se aplica al pedido, IVA incluido. Nunca deja cobrado más que el total.';
COMMENT ON COLUMN public.cobros.propina IS
  'Lo recibido de más, marcado como propina. No reduce lo pendiente.';
COMMENT ON COLUMN public.cobros.previo IS
  'Cobrado antes de que existiera esta tabla, sin presupuesto detrás.';
COMMENT ON COLUMN public.cobros.automatico IS
  'Lo creó el sistema, no una persona: el cobro web y los previos de tienda. '
  'Se va con el pedido si el pedido se borra.';

-- ---------------------------------------------------------------------------
-- 2. Permisos, RLS y auditoría
-- ---------------------------------------------------------------------------
-- Antes de rellenar nada, para que los cobros «previo» también queden en la
-- auditoría. Se lee desde el navegador; se escribe solo por las funciones de
-- abajo y los triggers de pedidos. Sin
-- UPDATE: un cobro no se edita, se borra y se vuelve a registrar.
GRANT SELECT ON public.cobros TO authenticated;
GRANT ALL ON public.cobros TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.cobros FROM authenticated, anon;

ALTER TABLE public.cobros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cobros lectura" ON public.cobros;
CREATE POLICY "cobros lectura" ON public.cobros
  FOR SELECT TO authenticated
  USING (public.es_miembro_empresa(auth.uid(), empresa_id));

DROP TRIGGER IF EXISTS cobros_auditoria ON public.cobros;
CREATE TRIGGER cobros_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON public.cobros
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_registrar();

-- ---------------------------------------------------------------------------
-- 3. Lo ya cobrado, como «previo»
-- ---------------------------------------------------------------------------
-- a) Los cobros textil que ya había, con su mismo id: así el apunte de caja
--    que arrastran sigue enlazado al mismo cobro.
INSERT INTO public.cobros
  (id, empresa_id, textil_pedido_id, fecha, importe, propina, metodo,
   caja_movimiento_id, previo, automatico, notas, created_at)
SELECT tc.id, tc.empresa_id, tc.pedido_id, tc.fecha, tc.importe, 0,
       tc.metodo::TEXT::public.cobro_metodo, tc.caja_movimiento_id, true, false,
       tc.notas, tc.created_at
  FROM public.textil_cobros tc
ON CONFLICT (id) DO NOTHING;

-- b) Los pedidos de WooCommerce ya pagados: su cobro web.
INSERT INTO public.cobros
  (empresa_id, pedido_id, fecha, importe, metodo, previo, automatico)
SELECT p.empresa_id, p.id, (p.fecha_pedido AT TIME ZONE 'Europe/Madrid')::DATE,
       round(p.total, 2), 'web', true, true
  FROM public.pedidos p
 WHERE p.origen = 'woocommerce'
   AND p.cancelado_en IS NULL
   AND p.estado_pago IN ('pagado', 'parcial')
   AND p.total > 0
ON CONFLICT (pedido_id) WHERE metodo = 'web' DO NOTHING;

-- c) Los pedidos manuales de tienda que constan como pagados: un cobro por su
--    total, sin método, porque no consta cómo se cobró. Sin apunte de caja: si
--    fue en efectivo, ya se apuntó en Caja a mano en su día o no se apuntó,
--    pero duplicarlo ahora sería peor.
INSERT INTO public.cobros
  (empresa_id, pedido_id, fecha, importe, metodo, previo, automatico, notas)
SELECT p.empresa_id, p.id, (p.fecha_pedido AT TIME ZONE 'Europe/Madrid')::DATE,
       round(p.total, 2), 'sin_especificar', true, true,
       'Cobrado antes de registrar cobros'
  FROM public.pedidos p
 WHERE p.origen IS DISTINCT FROM 'woocommerce'
   AND p.cancelado_en IS NULL
   AND p.estado_pago IN ('pagado', 'parcial')
   AND p.total > 0
   AND NOT EXISTS (SELECT 1 FROM public.cobros c WHERE c.pedido_id = p.id);

-- ---------------------------------------------------------------------------
-- 4. textil_cobros queda obsoleta
-- ---------------------------------------------------------------------------
-- Sin claves foráneas: si no, al borrar desde la tabla nueva un cobro textil
-- en efectivo, su apunte de caja no se podría borrar (lo seguiría apuntando
-- la fila vieja), ni el pedido textil una vez sin cobros. Los datos se quedan.
ALTER TABLE public.textil_cobros
  DROP CONSTRAINT IF EXISTS textil_cobros_pedido_id_fkey,
  DROP CONSTRAINT IF EXISTS textil_cobros_caja_movimiento_id_fkey;

REVOKE INSERT, UPDATE, DELETE ON public.textil_cobros FROM authenticated, anon;

COMMENT ON TABLE public.textil_cobros IS
  'OBSOLETA desde 20260929100000_cobros. Copiada a public.cobros con los '
  'mismos ids. No se escribe; se conserva como estaba.';

DROP FUNCTION IF EXISTS public.textil_registrar_cobro(
  UUID, DATE, NUMERIC, public.textil_cobro_metodo, UUID, TEXT);
DROP FUNCTION IF EXISTS public.textil_borrar_cobro(UUID);

-- ---------------------------------------------------------------------------
-- 5. Registrar un cobro
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_cobro(
  _pedido_id UUID,
  _textil_pedido_id UUID,
  _fecha DATE,
  _recibido NUMERIC,
  _metodo public.cobro_metodo,
  _es_propina BOOLEAN DEFAULT false,
  _concepto_caja_id UUID DEFAULT NULL,
  _notas TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_empresa UUID;
  v_numero TEXT;
  v_total NUMERIC;
  v_cancelado BOOLEAN;
  v_origen TEXT;
  v_cliente_id UUID;
  v_cliente_nombre TEXT;
  v_recibido NUMERIC;
  v_cobrado NUMERIC;
  v_pendiente NUMERIC;
  v_importe NUMERIC;
  v_propina NUMERIC;
  v_concepto RECORD;
  v_caja_id UUID;
  v_cobro_id UUID;
BEGIN
  IF num_nonnulls(_pedido_id, _textil_pedido_id) <> 1 THEN
    RAISE EXCEPTION 'Un cobro es de un pedido de tienda o de un pedido textil, de uno solo';
  END IF;

  v_recibido := round(COALESCE(_recibido, 0), 2);
  IF v_recibido <= 0 THEN
    RAISE EXCEPTION 'El importe tiene que ser mayor que cero';
  END IF;

  IF _metodo NOT IN ('efectivo', 'tarjeta', 'transferencia') THEN
    RAISE EXCEPTION 'Un cobro a mano es en efectivo, con tarjeta o por transferencia';
  END IF;

  -- El bloqueo es lo que impide que dos cobros a la vez se pasen del total.
  IF _pedido_id IS NOT NULL THEN
    SELECT p.empresa_id, p.numero, p.total, p.cancelado_en IS NOT NULL, p.origen,
           p.cliente_id, p.cliente_nombre
      INTO v_empresa, v_numero, v_total, v_cancelado, v_origen,
           v_cliente_id, v_cliente_nombre
      FROM public.pedidos p
     WHERE p.id = _pedido_id
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El pedido % no existe', _pedido_id;
    END IF;
    IF v_origen = 'woocommerce' THEN
      RAISE EXCEPTION 'El pedido % es de la web: se cobra en la web y su cobro llega al sincronizar',
        v_numero;
    END IF;
    SELECT COALESCE(sum(c.importe), 0) INTO v_cobrado
      FROM public.cobros c WHERE c.pedido_id = _pedido_id;
  ELSE
    SELECT p.empresa_id, p.numero, p.total, p.estado = 'cancelado',
           p.cliente_id, p.cliente_nombre
      INTO v_empresa, v_numero, v_total, v_cancelado, v_cliente_id, v_cliente_nombre
      FROM public.textil_pedidos p
     WHERE p.id = _textil_pedido_id
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El pedido textil % no existe', _textil_pedido_id;
    END IF;
    SELECT COALESCE(sum(c.importe), 0) INTO v_cobrado
      FROM public.cobros c WHERE c.textil_pedido_id = _textil_pedido_id;
  END IF;

  IF v_cancelado THEN
    RAISE EXCEPTION 'El pedido % está cancelado y no admite cobros', v_numero;
  END IF;

  -- En céntimos: el total de un pedido viejo puede traer más de dos decimales.
  v_pendiente := greatest(round(v_total, 2) - v_cobrado, 0);
  v_importe := least(v_recibido, v_pendiente);
  v_propina := v_recibido - v_importe;

  IF v_propina > 0 AND NOT COALESCE(_es_propina, false) THEN
    RAISE EXCEPTION 'El pedido % solo tiene % € pendientes. Para cobrar % €, marca «propina»: los % € de más se apuntan como propina',
      v_numero, v_pendiente, v_recibido, v_propina;
  END IF;
  IF v_propina = 0 AND COALESCE(_es_propina, false) THEN
    RAISE EXCEPTION 'No sobra nada: el cobro no supera lo pendiente (% €) y no hay propina',
      v_pendiente;
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
    IF v_concepto.categoria <> 'ingreso' THEN
      RAISE EXCEPTION '«%» es un concepto de gasto: un cobro va en un concepto de ingreso',
        v_concepto.nombre;
    END IF;

    -- A caja entra todo el efectivo recibido, propina incluida. categoria y
    -- concepto_nombre los sobrescribe el trigger de caja; van porque las
    -- columnas son NOT NULL. El cliente es ya la ficha única, así que va
    -- enlazado; el nombre suelto solo si el pedido no tiene ficha.
    INSERT INTO public.caja_movimientos
      (empresa_id, fecha, categoria, concepto_id, concepto_nombre,
       cliente_id, cliente_nombre, importe, observaciones)
    VALUES
      (v_empresa, _fecha, 'ingreso', _concepto_caja_id, '',
       v_cliente_id, CASE WHEN v_cliente_id IS NULL THEN v_cliente_nombre END,
       v_recibido,
       'Cobro del pedido ' || CASE WHEN _textil_pedido_id IS NOT NULL THEN 'textil ' ELSE '' END
         || v_numero
         || CASE WHEN v_propina > 0 THEN ' (incluye ' || v_propina || ' € de propina)' ELSE '' END)
    RETURNING id INTO v_caja_id;
  ELSIF _concepto_caja_id IS NOT NULL THEN
    RAISE EXCEPTION 'Solo el cobro en efectivo va a caja: sobra el concepto de caja';
  END IF;

  INSERT INTO public.cobros
    (empresa_id, pedido_id, textil_pedido_id, fecha, importe, propina, metodo,
     caja_movimiento_id, notas)
  VALUES
    (v_empresa, _pedido_id, _textil_pedido_id, _fecha, v_importe, v_propina, _metodo,
     v_caja_id, NULLIF(TRIM(COALESCE(_notas, '')), ''))
  RETURNING id INTO v_cobro_id;

  RETURN v_cobro_id;
END;
$$;

COMMENT ON FUNCTION public.registrar_cobro IS
  'Registra un cobro de un pedido de tienda o textil. Lo que exceda lo '
  'pendiente es propina y hay que marcarlo. En efectivo, crea también el '
  'apunte de ingreso en Caja, en la misma transacción.';

-- ---------------------------------------------------------------------------
-- 6. Borrar un cobro
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.borrar_cobro(_cobro_id UUID)
RETURNS VOID
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_metodo public.cobro_metodo;
  v_caja_id UUID;
BEGIN
  SELECT c.metodo INTO v_metodo FROM public.cobros c WHERE c.id = _cobro_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cobro % no existe', _cobro_id;
  END IF;
  IF v_metodo = 'web' THEN
    RAISE EXCEPTION 'El cobro web lo pone la sincronización con la tienda online: no se borra a mano';
  END IF;

  -- Primero el cobro, que es quien apunta al apunte: al revés, el RESTRICT lo
  -- impediría.
  DELETE FROM public.cobros WHERE id = _cobro_id
  RETURNING caja_movimiento_id INTO v_caja_id;

  IF v_caja_id IS NOT NULL THEN
    DELETE FROM public.caja_movimientos WHERE id = v_caja_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.borrar_cobro IS
  'Borra un cobro y, si fue en efectivo, su apunte de Caja. El cobro web no.';

-- Las llama la aplicación desde el servidor, con el rol de servicio.
REVOKE ALL ON FUNCTION public.registrar_cobro FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.borrar_cobro FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_cobro TO service_role;
GRANT EXECUTE ON FUNCTION public.borrar_cobro TO service_role;

-- ---------------------------------------------------------------------------
-- 7. El cobro web, al día con el pedido
-- ---------------------------------------------------------------------------
-- La sincronización hace upsert de los pedidos en cada pasada. El cobro web
-- sigue al pedido: pagado y vivo, cobro por su total; cancelado, reembolsado
-- o todavía sin pagar (pendiente de pago o en espera de la transferencia),
-- sin cobro. Solo se escribe si algo cambió, para no llenar la auditoría con
-- una fila por pedido y sincronización.
--
-- SECURITY DEFINER porque quien escribe el pedido no puede escribir en
-- cobros: authenticated solo lee.
CREATE OR REPLACE FUNCTION public.pedido_cobro_web()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.origen = 'woocommerce'
     AND NEW.cancelado_en IS NULL
     AND NEW.estado_pago IN ('pagado', 'parcial')
     AND NEW.total > 0
  THEN
    INSERT INTO public.cobros
      (empresa_id, pedido_id, fecha, importe, metodo, automatico)
    VALUES
      (NEW.empresa_id, NEW.id, (NEW.fecha_pedido AT TIME ZONE 'Europe/Madrid')::DATE,
       round(NEW.total, 2), 'web', true)
    ON CONFLICT (pedido_id) WHERE metodo = 'web' DO UPDATE
      SET importe = EXCLUDED.importe, fecha = EXCLUDED.fecha
      WHERE public.cobros.importe IS DISTINCT FROM EXCLUDED.importe
         OR public.cobros.fecha IS DISTINCT FROM EXCLUDED.fecha;
  ELSE
    DELETE FROM public.cobros WHERE pedido_id = NEW.id AND metodo = 'web';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pedidos_cobro_web ON public.pedidos;
CREATE TRIGGER pedidos_cobro_web
  AFTER INSERT OR UPDATE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.pedido_cobro_web();

-- Al borrar un pedido, sus cobros automáticos se van con él. Los hechos a
-- mano se quedan y el RESTRICT impide el borrado: ese dinero entró.
CREATE OR REPLACE FUNCTION public.pedido_borrar_cobros_automaticos()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.cobros WHERE pedido_id = OLD.id AND automatico;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS pedidos_borrar_cobros_automaticos ON public.pedidos;
CREATE TRIGGER pedidos_borrar_cobros_automaticos
  BEFORE DELETE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.pedido_borrar_cobros_automaticos();

-- ---------------------------------------------------------------------------
-- 8. Una tienda con cobros hechos a mano no se borra
-- ---------------------------------------------------------------------------
-- El RESTRICT ya lo impediría, pero con un error de clave foránea que no dice
-- nada. Igual que con las facturas: se desactiva.
CREATE OR REPLACE FUNCTION public.tienda_borrado_permitido()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_facturas INT;
  v_cobros INT;
BEGIN
  SELECT count(*) INTO v_facturas
    FROM public.facturas f
   WHERE f.tienda_id = OLD.id AND f.estado <> 'borrador';

  IF v_facturas > 0 THEN
    RAISE EXCEPTION
      'La tienda % tiene % factura(s) emitida(s) y no se puede borrar. Desactívala.',
      OLD.nombre, v_facturas
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT count(*) INTO v_cobros
    FROM public.cobros c
    JOIN public.pedidos p ON p.id = c.pedido_id
   WHERE p.tienda_id = OLD.id AND NOT c.automatico;

  IF v_cobros > 0 THEN
    RAISE EXCEPTION
      'La tienda % tiene % cobro(s) registrado(s) y no se puede borrar. Desactívala.',
      OLD.nombre, v_cobros
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN OLD;
END;
$$;
