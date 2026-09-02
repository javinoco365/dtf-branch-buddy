-- ============================================================================
-- CIMIENTOS 4/6 · Los tres estados del pedido
-- ============================================================================
--
-- QUÉ HACE
--   Añade estado_pago, estado_produccion y estado_envio a public.pedidos, más
--   cancelado_en y motivo_cancelacion, y los rellena a partir del enum actual.
--
-- POR QUÉ
--   Hoy hay un único enum pedido_estado con siete valores que mezclan tres ejes
--   distintos: pendiente, en_produccion, imprimiendo, listo, enviado,
--   entregado, cancelado. Con eso no se puede representar «pagado pero todavía
--   sin imprimir», que es el estado en el que está la mayoría de los pedidos en
--   cualquier momento dado, ni «impreso pero pendiente de cobro», que en B2B a
--   crédito es lo normal.
--
-- LA CANCELACIÓN NO ES UN ESTADO
--   Cancelar es transversal: un pedido cancelado tenía antes un estado de pago,
--   de producción y de envío. Por eso pasa a ser una marca temporal
--   (cancelado_en) y no un valor de ninguno de los tres enums.
--
-- DE DÓNDE SALE LA CORRESPONDENCIA
--   No es inventada: sale del mapa que la propia aplicación usa para empujar
--   estados a WooCommerce (ESTADO_TO_WC en src/lib/pedidos.functions.ts).
--   Ahí, pendiente es on-hold (a la espera de pago), en_produccion,
--   imprimiendo y listo son processing (pagado y en curso), y enviado y
--   entregado son completed.
--
--     estado actual   | estado_pago | estado_produccion | estado_envio
--     ----------------|-------------|-------------------|--------------
--     pendiente       | pendiente   | sin_empezar       | sin_enviar
--     en_produccion   | pagado      | en_cola           | sin_enviar
--     imprimiendo     | pagado      | imprimiendo       | sin_enviar
--     listo           | pagado      | listo             | sin_enviar
--     enviado         | pagado      | listo             | en_transito
--     entregado       | pagado      | listo             | entregado
--     cancelado       | (se queda como pendiente, y se marca cancelado_en)
--
--   Del valor cancelado no se puede deducir en qué punto estaba el pedido: se
--   deja en el estado inicial y se marca la cancelación. Inventar que estaba
--   pagado sería peor que reconocer que no consta.
--
-- QUÉ NO HACE
--   No elimina la columna estado. Las dos conviven hasta que ninguna consulta
--   lea la vieja; retirarla va en una migración posterior. Mientras tanto, un
--   trigger mantiene estado sincronizado cuando se escriben los nuevos campos,
--   para que la aplicación actual siga funcionando sin cambios.
--
-- REVERSIBLE
--   Sí. Eliminar las columnas nuevas, el trigger y los tipos lo deshace. La
--   columna estado no se toca en ningún momento.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE public.estado_pago AS ENUM (
    'pendiente',    -- todavía no se ha cobrado nada
    'parcial',      -- anticipo o pago a cuenta
    'pagado',
    'reembolsado'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'El tipo public.estado_pago ya existe, se omite';
END $$;

DO $$ BEGIN
  CREATE TYPE public.estado_produccion AS ENUM (
    'sin_empezar',
    'en_cola',      -- asignado a una tirada, aún no impreso
    'imprimiendo',
    'listo'         -- impreso y empaquetado
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'El tipo public.estado_produccion ya existe, se omite';
END $$;

DO $$ BEGIN
  CREATE TYPE public.estado_envio AS ENUM (
    'sin_enviar',
    'preparado',    -- etiqueta generada, pendiente de recogida
    'en_transito',
    'entregado',
    'devuelto'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'El tipo public.estado_envio ya existe, se omite';
END $$;

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS estado_pago public.estado_pago NOT NULL DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS estado_produccion public.estado_produccion NOT NULL DEFAULT 'sin_empezar',
  ADD COLUMN IF NOT EXISTS estado_envio public.estado_envio NOT NULL DEFAULT 'sin_enviar',
  ADD COLUMN IF NOT EXISTS cancelado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_cancelacion TEXT;

COMMENT ON COLUMN public.pedidos.cancelado_en IS
  'Marca de cancelación. NULL significa pedido vivo. Sustituye al valor cancelado del enum estado.';
COMMENT ON COLUMN public.pedidos.estado IS
  'OBSOLETA. Sustituida por estado_pago, estado_produccion y estado_envio. Se mantiene sincronizada por trigger mientras queden consultas que la lean.';

-- ---------------------------------------------------------------------------
-- Relleno
-- ---------------------------------------------------------------------------
UPDATE public.pedidos SET
  estado_pago = CASE estado
    WHEN 'pendiente' THEN 'pendiente'::public.estado_pago
    WHEN 'cancelado' THEN 'pendiente'::public.estado_pago
    ELSE 'pagado'::public.estado_pago
  END,
  estado_produccion = CASE estado
    WHEN 'pendiente'     THEN 'sin_empezar'::public.estado_produccion
    WHEN 'cancelado'     THEN 'sin_empezar'::public.estado_produccion
    WHEN 'en_produccion' THEN 'en_cola'::public.estado_produccion
    WHEN 'imprimiendo'   THEN 'imprimiendo'::public.estado_produccion
    ELSE 'listo'::public.estado_produccion
  END,
  estado_envio = CASE estado
    WHEN 'enviado'   THEN 'en_transito'::public.estado_envio
    WHEN 'entregado' THEN 'entregado'::public.estado_envio
    ELSE 'sin_enviar'::public.estado_envio
  END,
  cancelado_en = CASE WHEN estado = 'cancelado' THEN COALESCE(updated_at, now()) END;

-- ---------------------------------------------------------------------------
-- Convivencia con la columna vieja
-- ---------------------------------------------------------------------------
-- Traduce los tres estados nuevos al enum antiguo, para que las pantallas que
-- todavía leen pedidos.estado sigan viendo lo que esperan. Va en las dos
-- direcciones: si alguien escribe estado (la aplicación actual), se derivan los
-- tres; si alguien escribe los tres (la aplicación nueva), se deriva estado.
-- ---------------------------------------------------------------------------
-- La correspondencia, en un solo sitio
-- ---------------------------------------------------------------------------
-- El segundo argumento es lo que se devuelve para «cancelado», que no dice nada
-- de en qué punto estaba el pedido: al insertar es el valor inicial, y al
-- actualizar es el que ya tenía.
CREATE OR REPLACE FUNCTION public.pedido_estado_a_pago(
  _estado public.pedido_estado, _si_cancelado public.estado_pago)
RETURNS public.estado_pago LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _estado
    WHEN 'pendiente' THEN 'pendiente'::public.estado_pago
    WHEN 'cancelado' THEN _si_cancelado
    ELSE 'pagado'::public.estado_pago END;
$$;

CREATE OR REPLACE FUNCTION public.pedido_estado_a_produccion(
  _estado public.pedido_estado, _si_cancelado public.estado_produccion)
RETURNS public.estado_produccion LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _estado
    WHEN 'pendiente'     THEN 'sin_empezar'::public.estado_produccion
    WHEN 'cancelado'     THEN _si_cancelado
    WHEN 'en_produccion' THEN 'en_cola'::public.estado_produccion
    WHEN 'imprimiendo'   THEN 'imprimiendo'::public.estado_produccion
    ELSE 'listo'::public.estado_produccion END;
$$;

CREATE OR REPLACE FUNCTION public.pedido_estado_a_envio(
  _estado public.pedido_estado, _si_cancelado public.estado_envio)
RETURNS public.estado_envio LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _estado
    WHEN 'enviado'   THEN 'en_transito'::public.estado_envio
    WHEN 'entregado' THEN 'entregado'::public.estado_envio
    WHEN 'cancelado' THEN _si_cancelado
    ELSE 'sin_enviar'::public.estado_envio END;
$$;

CREATE OR REPLACE FUNCTION public.pedido_sincronizar_estados()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  -- Cierto cuando los tres campos nuevos están tal y como los deja el DEFAULT,
  -- es decir, cuando quien escribe no los ha tocado.
  v_nuevos_intactos BOOLEAN;
BEGIN
  v_nuevos_intactos :=
        NEW.estado_pago = 'pendiente'
    AND NEW.estado_produccion = 'sin_empezar'
    AND NEW.estado_envio = 'sin_enviar'
    AND NEW.cancelado_en IS NULL;

  -- ---- Alta por la vía antigua -------------------------------------------
  -- La sincronización de WooCommerce inserta el pedido con su estado ya
  -- mapeado y sin tocar los tres campos nuevos. Sin esta rama, el trigger
  -- derivaría estado de unos campos que están a cero y machacaría en silencio
  -- el estado que venía: todos los pedidos sincronizados acabarían en
  -- «pendiente».
  IF TG_OP = 'INSERT' AND v_nuevos_intactos AND NEW.estado IS DISTINCT FROM 'pendiente' THEN
    NEW.estado_pago := public.pedido_estado_a_pago(NEW.estado, 'pendiente');
    NEW.estado_produccion := public.pedido_estado_a_produccion(NEW.estado, 'sin_empezar');
    NEW.estado_envio := public.pedido_estado_a_envio(NEW.estado, 'sin_enviar');
    NEW.cancelado_en := CASE WHEN NEW.estado = 'cancelado' THEN now() END;
    RETURN NEW;
  END IF;

  -- ---- Cambio por la vía antigua -----------------------------------------
  -- Solo cambió estado: se derivan los tres. Al cancelar se conserva el punto
  -- en el que estaba el pedido, porque cancelar no lo devuelve al principio.
  IF TG_OP = 'UPDATE'
     AND NEW.estado IS DISTINCT FROM OLD.estado
     AND NEW.estado_pago IS NOT DISTINCT FROM OLD.estado_pago
     AND NEW.estado_produccion IS NOT DISTINCT FROM OLD.estado_produccion
     AND NEW.estado_envio IS NOT DISTINCT FROM OLD.estado_envio
  THEN
    NEW.estado_pago := public.pedido_estado_a_pago(NEW.estado, OLD.estado_pago);
    NEW.estado_produccion := public.pedido_estado_a_produccion(NEW.estado, OLD.estado_produccion);
    NEW.estado_envio := public.pedido_estado_a_envio(NEW.estado, OLD.estado_envio);
    NEW.cancelado_en := CASE
      WHEN NEW.estado = 'cancelado' THEN COALESCE(OLD.cancelado_en, now())
      ELSE NULL END;
    RETURN NEW;
  END IF;

  -- ---- Escritura por la vía nueva ----------------------------------------
  NEW.estado := CASE
    WHEN NEW.cancelado_en IS NOT NULL THEN 'cancelado'::public.pedido_estado
    WHEN NEW.estado_envio = 'entregado' THEN 'entregado'::public.pedido_estado
    WHEN NEW.estado_envio IN ('preparado', 'en_transito') THEN 'enviado'::public.pedido_estado
    WHEN NEW.estado_produccion = 'listo' THEN 'listo'::public.pedido_estado
    WHEN NEW.estado_produccion = 'imprimiendo' THEN 'imprimiendo'::public.pedido_estado
    WHEN NEW.estado_produccion = 'en_cola' THEN 'en_produccion'::public.pedido_estado
    ELSE 'pendiente'::public.pedido_estado
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pedidos_sincronizar_estados ON public.pedidos;
CREATE TRIGGER pedidos_sincronizar_estados
  BEFORE INSERT OR UPDATE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.pedido_sincronizar_estados();

CREATE INDEX IF NOT EXISTS pedidos_estado_pago_idx ON public.pedidos (estado_pago);
CREATE INDEX IF NOT EXISTS pedidos_estado_produccion_idx ON public.pedidos (estado_produccion);
CREATE INDEX IF NOT EXISTS pedidos_estado_envio_idx ON public.pedidos (estado_envio);
CREATE INDEX IF NOT EXISTS pedidos_vivos_idx ON public.pedidos (tienda_id, fecha_pedido DESC)
  WHERE cancelado_en IS NULL;
