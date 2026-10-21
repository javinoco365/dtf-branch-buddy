import { useState } from "react";
import { CamposSegunNivel } from "@/components/CamposSegunNivel";
import { usePermisos } from "@/hooks/use-permisos";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { guardarAjustesGerencia } from "@/lib/gerencia.functions";
import type { AjustesJornada } from "@/dominio/gerencia";
import { Campo } from "../comun";

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const decimal = (t: string) => Number(t.replace(",", "."));

/**
 * La jornada de la máquina, la hora de corte y el coste del envío, dentro del
 * Resumen: se cambian aquí y se guardan en Ajustes de Gerencia.
 */
export function Jornada({
  ajustes,
  disponible,
}: {
  ajustes: AjustesJornada;
  /** Falso sin la migración 20261027100000: se enseñan los de por defecto. */
  disponible: boolean;
}) {
  const queryClient = useQueryClient();
  const guardarFn = useServerFn(guardarAjustesGerencia);
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState({
    metros_hora: "",
    jornada_inicio: "",
    jornada_fin: "",
    hora_corte: "",
    coste_envio_defecto: "",
  });

  const abrir = (o: boolean) => {
    setAbierto(o);
    if (o) {
      setF({
        metros_hora: String(ajustes.metros_hora).replace(".", ","),
        jornada_inicio: ajustes.jornada_inicio,
        jornada_fin: ajustes.jornada_fin,
        hora_corte: ajustes.hora_corte,
        coste_envio_defecto: String(ajustes.coste_envio_defecto).replace(".", ","),
      });
    }
  };

  const metrosHora = decimal(f.metros_hora);
  const coste = decimal(f.coste_envio_defecto);
  const error = !(metrosHora > 0 && metrosHora <= 1000)
    ? "Los metros por hora tienen que ser más de 0."
    : !HORA.test(f.jornada_inicio) || !HORA.test(f.jornada_fin) || !HORA.test(f.hora_corte)
      ? "Las horas van como 09:00."
      : f.jornada_inicio >= f.jornada_fin
        ? "La jornada tiene que acabar después de empezar."
        : !(coste >= 0 && coste <= 1000)
          ? "El coste del envío tiene que estar entre 0 y 1.000 €."
          : null;

  const guardar = useMutation({
    mutationFn: () =>
      guardarFn({
        data: {
          metros_hora: metrosHora,
          jornada_inicio: f.jornada_inicio,
          jornada_fin: f.jornada_fin,
          hora_corte: f.hora_corte,
          coste_envio_defecto: coste,
        },
      }),
    onSuccess: () => {
      toast.success("Jornada guardada");
      setAbierto(false);
      queryClient.invalidateQueries({ queryKey: ["gerencia-ajustes"] });
      queryClient.invalidateQueries({ queryKey: ["pedidos"] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo guardar"),
  });

  // Quien solo ve, ve la jornada; cambiarla es escribir.
  const { escribir } = usePermisos();
  return (
    <Popover open={abierto} onOpenChange={abrir}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="no-imprimir max-md:w-full">
          <Settings2 className="h-4 w-4" />
          Jornada y máquina
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <p className="text-sm font-medium">Jornada y máquina</p>
          <p className="text-xs text-muted-foreground">
            Con esto se calcula cuánto podía imprimir la máquina (capacidad) y qué pedidos entran
            tarde.
          </p>
        </div>
        <CamposSegunNivel>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Metros por hora">
              <Input
                inputMode="decimal"
                value={f.metros_hora}
                onChange={(e) => setF({ ...f, metros_hora: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Hora de corte">
              <Input
                type="time"
                value={f.hora_corte}
                onChange={(e) => setF({ ...f, hora_corte: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Empieza">
              <Input
                type="time"
                value={f.jornada_inicio}
                onChange={(e) => setF({ ...f, jornada_inicio: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Acaba">
              <Input
                type="time"
                value={f.jornada_fin}
                onChange={(e) => setF({ ...f, jornada_fin: e.target.value })}
              />
            </Campo>
            <div className="col-span-2">
              <Campo etiqueta="Envío sin coste apuntado (€, sin IVA)">
                <Input
                  inputMode="decimal"
                  value={f.coste_envio_defecto}
                  onChange={(e) => setF({ ...f, coste_envio_defecto: e.target.value })}
                />
              </Campo>
              <p className="mt-1 text-xs text-muted-foreground">
                Lo que se calcula que cobra la agencia cuando el pedido no tiene apuntado el coste
                real (se apunta en el envío de cada pedido).
              </p>
            </div>
          </div>
        </CamposSegunNivel>
        {!disponible && (
          <p className="text-xs text-destructive">
            Falta aplicar la migración 20261027100000_pedidos_realizado.sql para poder guardarlo.
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setAbierto(false)}>
            {escribir ? "Cancelar" : "Cerrar"}
          </Button>
          {escribir && (
            <Button
              size="sm"
              disabled={!!error || !disponible || guardar.isPending}
              onClick={() => guardar.mutate()}
            >
              {guardar.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Guardar
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
