import type { ReactNode } from "react";
import { numero } from "@/lib/format";
import type { LecturaCuenta } from "@/lib/cuenta";
import { TarjetaConcepto } from "@/components/TarjetaKpi";

/**
 * Las cuatro cifras de un periodo con el nombre y la cuenta de la Cuenta de
 * resultados: ventas netas, margen bruto, cobrado y pendiente de cobro. Las
 * usan Inicio y el resumen de cada tienda.
 *
 * Se enseñan siempre las cuatro, aunque el periodo no tenga pedidos: puede
 * haber cobros de pedidos de antes, o algo pendiente de cobro. Mientras se
 * leen, «…»; si una no se pudo leer, «—» con el motivo y el botón de
 * reintentar.
 */
export function CifrasDelPeriodo({
  lectura,
  frente,
  pieVentas,
  pieCobrado,
  piePendiente,
}: {
  lectura: LecturaCuenta;
  frente?: string;
  pieVentas?: ReactNode;
  pieCobrado?: ReactNode;
  /** Lo pendiente es la foto de hoy: se dice («Hoy, sea del mes que sea»). */
  piePendiente: ReactNode;
}) {
  const { cuenta, previa, estadoDinero, reintentar, reintentando } = lectura;
  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      <TarjetaConcepto
        clave="ventas_netas"
        cifra={cuenta?.ventas_netas ?? null}
        previa={previa?.ventas_netas}
        frente={frente}
        pie={pieVentas}
      />
      <TarjetaConcepto
        clave="margen_bruto"
        cifra={cuenta?.margen_bruto ?? null}
        previa={previa?.margen_bruto}
        frente={frente}
        pie={
          cuenta?.margenPct != null ? (
            <span className="text-muted-foreground">
              {numero(cuenta.margenPct, 1)}&nbsp;% de las ventas netas
            </span>
          ) : undefined
        }
      />
      <TarjetaConcepto
        clave="cobrado"
        cifra={cuenta?.cobrado ?? null}
        previa={previa?.cobrado}
        frente={frente}
        estado={estadoDinero.cobrado}
        onReintentar={reintentar}
        reintentando={reintentando}
        pie={pieCobrado}
      />
      <TarjetaConcepto
        clave="pendiente_cobro"
        cifra={cuenta?.pendiente_cobro ?? null}
        estado={estadoDinero.pendiente_cobro}
        onReintentar={reintentar}
        reintentando={reintentando}
        pie={<span className="text-muted-foreground">{piePendiente}</span>}
      />
    </div>
  );
}
