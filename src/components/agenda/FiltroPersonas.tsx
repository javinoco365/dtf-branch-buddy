// «Para» y «De»: quién tiene que hacerla y quién la mandó. Mandan en el
// calendario y en la lista a la vez. Los atajos de la izquierda solo rellenan
// los dos desplegables.
import { ATAJOS_PERSONA, type FiltroPersona } from "@/dominio/agenda";
import type { PersonaAgenda } from "@/lib/agenda.functions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function FiltroPersonas({
  valor,
  onCambio,
  personas,
  yo,
  cuantas,
}: {
  valor: FiltroPersona;
  onCambio: (f: FiltroPersona) => void;
  personas: PersonaAgenda[];
  /** La persona de «¿Quién eres?»; sin ella no hay «mí». */
  yo: string | null;
  /** Pendientes de cada atajo, para el número de la pestaña. */
  cuantas: Record<string, number>;
}) {
  const otras = personas.filter((p) => p.activo && p.id !== yo);
  const atajos = yo ? ATAJOS_PERSONA : ATAJOS_PERSONA.filter((a) => a.id === "todas");
  const opcionesPara = [
    ...(yo
      ? [
          ["yo", "Mí"],
          ["otros", "Otras personas"],
        ]
      : []),
    ["todos", "Cualquiera"],
    ...otras.map((p) => [p.id, p.nombre]),
  ];
  const opcionesDe = [
    ["todos", "Cualquiera"],
    ...(yo ? [["yo", "Mí"]] : []),
    ...otras.map((p) => [p.id, p.nombre]),
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div
        role="group"
        aria-label="Atajos"
        className="inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-1 max-sm:w-full"
      >
        {atajos.map((a) => {
          const activo = valor.para === a.filtro.para && valor.de === a.filtro.de;
          return (
            <button
              key={a.id}
              type="button"
              aria-pressed={activo}
              onClick={() => onCambio(a.filtro)}
              className={cn(
                "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-3 text-sm transition-colors max-sm:flex-1 md:min-h-9",
                activo
                  ? "bg-card font-semibold text-foreground shadow-sm"
                  : "text-secondary-foreground hover:text-foreground",
              )}
            >
              {a.nombre}
              {a.id !== "todas" && (
                <span className="rounded-md bg-border/60 px-1.5 text-[11px] font-semibold tabular-nums">
                  {cuantas[a.id] ?? 0}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <Desplegable
        etiqueta="Para"
        valor={valor.para}
        opciones={opcionesPara}
        onCambio={(para) => onCambio({ ...valor, para })}
      />
      <Desplegable
        etiqueta="De"
        valor={valor.de}
        opciones={opcionesDe}
        onCambio={(de) => onCambio({ ...valor, de })}
      />
      <p className="basis-full text-xs text-muted-foreground">
        «Para» es quien tiene que hacerla; «De», quien la mandó. Mandan en el calendario y en la
        lista.
      </p>
    </div>
  );
}

function Desplegable({
  etiqueta,
  valor,
  opciones,
  onCambio,
}: {
  etiqueta: string;
  valor: string;
  opciones: string[][];
  onCambio: (v: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-muted-foreground max-sm:w-full">
      <span className="max-sm:w-9">{etiqueta}</span>
      <Select value={valor} onValueChange={onCambio}>
        <SelectTrigger
          className="h-11 w-[170px] text-foreground max-sm:w-auto max-sm:flex-1 md:h-9"
          aria-label={etiqueta}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opciones.map(([v, l]) => (
            <SelectItem key={v} value={v!}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
