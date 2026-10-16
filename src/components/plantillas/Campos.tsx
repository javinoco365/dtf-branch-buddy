import { useEffect, useId, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, Undo2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { numeroJusto } from "@/lib/format";
import {
  VARIABLES_PLANTILLA,
  type Alineacion,
  type VariablePlantilla,
} from "@/dominio/plantilla-presupuesto";
import { aDecima, acotar } from "./limites";

/**
 * Los campos del editor de plantillas. Todos son controlados: reciben el
 * valor de la plantilla y avisan con el nuevo, ya dentro de su rango.
 */

/** Una etiqueta encima de un campo, con una ayuda debajo si hace falta. */
export function Campo({
  etiqueta,
  htmlFor,
  ayuda,
  className,
  children,
}: {
  etiqueta: string;
  htmlFor?: string;
  ayuda?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5 min-w-0", className)}>
      <Label htmlFor={htmlFor} className="text-xs">
        {etiqueta}
      </Label>
      {children}
      {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
    </div>
  );
}

const leerNumero = (t: string) => Number(t.trim().replace(",", "."));

/**
 * Un número con su unidad (mm, pt). Se escribe con coma o con punto. Mientras
 * se escribe, cada valor válido se aplica al momento (la vista previa lo
 * sigue); al salir del campo, lo que se haya quedado fuera de rango se recorta
 * al mínimo o al máximo.
 */
export function CampoNumero({
  etiqueta,
  valor,
  min,
  max,
  unidad = "mm",
  onChange,
  disabled,
  className,
}: {
  etiqueta: string;
  valor: number;
  min: number;
  max: number;
  unidad?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const ayudaId = `${id}-rango`;
  const formatear = (n: number) => numeroJusto(n, 1).replace(/\./g, "");
  const [texto, setTexto] = useState(() => formatear(valor));
  const enfocado = useRef(false);

  // Si el valor cambia desde fuera (al arrastrar en el diseñador), el campo lo sigue.
  useEffect(() => {
    if (!enfocado.current) setTexto(formatear(valor));
  }, [valor]);

  const n = leerNumero(texto);
  const fuera = texto.trim() !== "" && (!Number.isFinite(n) || n < min || n > max);

  return (
    <div className={cn("space-y-1 min-w-0", className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {etiqueta}
      </Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={texto}
          disabled={disabled}
          aria-invalid={fuera || undefined}
          aria-describedby={fuera ? ayudaId : undefined}
          className={cn(
            "h-8 pr-9 tabular-nums",
            fuera && "border-destructive focus-visible:ring-destructive",
          )}
          onFocus={() => (enfocado.current = true)}
          onChange={(e) => {
            setTexto(e.target.value);
            const v = leerNumero(e.target.value);
            if (e.target.value.trim() !== "" && Number.isFinite(v) && v >= min && v <= max) {
              onChange(aDecima(v));
            }
          }}
          onBlur={() => {
            enfocado.current = false;
            const v = leerNumero(texto);
            if (texto.trim() === "" || !Number.isFinite(v)) {
              setTexto(formatear(valor));
              return;
            }
            const final = aDecima(acotar(v, min, max));
            if (final !== valor) onChange(final);
            setTexto(formatear(final));
          }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            const paso = e.shiftKey ? 5 : 0.5;
            const base = Number.isFinite(n) ? n : valor;
            const final = aDecima(acotar(base + (e.key === "ArrowUp" ? paso : -paso), min, max));
            setTexto(formatear(final));
            onChange(final);
          }}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {unidad}
        </span>
      </div>
      {fuera && (
        <p id={ayudaId} className="text-[11px] text-destructive">
          Entre {formatear(min)} y {formatear(max)} {unidad}
        </p>
      )}
    </div>
  );
}

/** Un texto de una línea, con su largo máximo. */
export function CampoTexto({
  etiqueta,
  valor,
  onChange,
  maximo,
  placeholder,
  ayuda,
  disabled,
  className,
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  maximo: number;
  placeholder?: string;
  ayuda?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <Campo etiqueta={etiqueta} htmlFor={id} ayuda={ayuda} className={className}>
      <Input
        id={id}
        value={valor}
        maxLength={maximo}
        placeholder={placeholder}
        disabled={disabled}
        className="h-8"
        onChange={(e) => onChange(e.target.value)}
      />
    </Campo>
  );
}

/** Un sí o no, con el texto al lado. */
export function CampoInterruptor({
  etiqueta,
  valor,
  onChange,
  ayuda,
  disabled,
  className,
}: {
  etiqueta: string;
  valor: boolean;
  onChange: (v: boolean) => void;
  ayuda?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex items-start gap-2.5 min-w-0", className)}>
      <Switch
        id={id}
        checked={valor}
        disabled={disabled}
        onCheckedChange={onChange}
        className="mt-0.5"
      />
      <div className="space-y-0.5 min-w-0">
        <Label htmlFor={id} className="text-sm font-normal leading-snug cursor-pointer">
          {etiqueta}
        </Label>
        {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
      </div>
    </div>
  );
}

const ALINEACIONES: { valor: Alineacion; nombre: string; Icono: typeof AlignLeft }[] = [
  { valor: "izquierda", nombre: "A la izquierda", Icono: AlignLeft },
  { valor: "centro", nombre: "Centrado", Icono: AlignCenter },
  { valor: "derecha", nombre: "A la derecha", Icono: AlignRight },
];

/** Izquierda, centro o derecha. */
export function CampoAlineacion({
  etiqueta = "Alineación",
  valor,
  onChange,
  disabled,
  ayuda,
}: {
  etiqueta?: string;
  valor: Alineacion;
  onChange: (v: Alineacion) => void;
  disabled?: boolean;
  ayuda?: React.ReactNode;
}) {
  return (
    <div className="space-y-1 min-w-0">
      <p className="text-xs font-medium leading-none text-muted-foreground">{etiqueta}</p>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={valor}
        disabled={disabled}
        onValueChange={(v) => v && onChange(v as Alineacion)}
        className="justify-start"
        aria-label={etiqueta}
      >
        {ALINEACIONES.map(({ valor: v, nombre, Icono }) => (
          <ToggleGroupItem key={v} value={v} aria-label={nombre} title={nombre}>
            <Icono />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
    </div>
  );
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** «#2a2260» completo, para el selector de color del navegador (que no admite «#22a»). */
function hexLargo(c: string): string {
  const m = HEX.exec(c.trim());
  if (!m) return "#000000";
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
  return `#${h.toLowerCase()}`;
}

/**
 * Un color en hexadecimal, con el selector del navegador al lado. Vacío: el de
 * la tienda o la marca (`heredado` dice cuál es, para enseñarlo).
 */
export function CampoColor({
  etiqueta,
  valor,
  onChange,
  heredado,
  nombreHeredado,
  ayuda,
  disabled,
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  /** El color que sale si este se deja vacío. */
  heredado: string;
  /** Qué color es ese: «el de la tienda», «el azul de la casa». */
  nombreHeredado: string;
  ayuda?: React.ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  const [texto, setTexto] = useState(valor);
  const enfocado = useRef(false);
  useEffect(() => {
    if (!enfocado.current) setTexto(valor);
  }, [valor]);
  const malo = texto.trim() !== "" && !HEX.test(texto.trim());
  const efectivo = valor || heredado;

  return (
    <Campo etiqueta={etiqueta} htmlFor={id} ayuda={ayuda}>
      <div className="flex flex-wrap items-center gap-2">
        <label
          className={cn(
            "relative h-8 w-10 shrink-0 cursor-pointer overflow-hidden rounded-md border shadow-sm",
            disabled && "pointer-events-none opacity-50",
          )}
          style={{ backgroundColor: efectivo }}
          title="Elegir color"
        >
          <input
            type="color"
            aria-label={`${etiqueta}: elegir color`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            value={hexLargo(efectivo)}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
          />
        </label>
        <Input
          id={id}
          value={texto}
          maxLength={7}
          placeholder={heredado}
          disabled={disabled}
          aria-invalid={malo || undefined}
          className={cn(
            "h-8 w-28 font-mono text-xs uppercase",
            malo && "border-destructive focus-visible:ring-destructive",
          )}
          onFocus={() => (enfocado.current = true)}
          onChange={(e) => {
            const t = e.target.value;
            setTexto(t);
            if (t.trim() === "") onChange("");
            else if (HEX.test(t.trim())) onChange(hexLargo(t));
          }}
          onBlur={() => {
            enfocado.current = false;
            setTexto(valor);
          }}
        />
        {valor ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onChange("")}
          >
            <Undo2 /> Usar {nombreHeredado}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Ahora: {nombreHeredado}</span>
        )}
      </div>
      {malo && (
        <p className="text-[11px] text-destructive">Un color en hexadecimal: #2a2260 o #22a.</p>
      )}
    </Campo>
  );
}

const VARIABLES = Object.entries(VARIABLES_PLANTILLA) as [VariablePlantilla, string][];

/**
 * Un texto largo que admite variables. Debajo, una pastilla por variable: al
 * pulsarla se escribe donde está el cursor.
 */
export function TextoConVariables({
  etiqueta,
  valor,
  onChange,
  maximo,
  filas = 3,
  placeholder,
  ayuda,
  disabled,
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  maximo: number;
  filas?: number;
  placeholder?: string;
  ayuda?: React.ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  // Dónde estaba el cursor la última vez, y en qué texto: al pulsar una
  // pastilla el área pierde el foco. Si el texto ha cambiado desde fuera (otro
  // ámbito, Descartar, Restablecer), esa posición ya no vale.
  const cursor = useRef<{ inicio: number; fin: number; texto: string } | null>(null);

  const recordar = () => {
    const a = area.current;
    if (a) cursor.current = { inicio: a.selectionStart, fin: a.selectionEnd, texto: a.value };
  };

  const insertar = (variable: VariablePlantilla) => {
    const marca = `{${variable}}`;
    // Sin un cursor tomado en este mismo texto, al final.
    const c = cursor.current?.texto === valor ? cursor.current : null;
    const { inicio, fin } = c ?? { inicio: valor.length, fin: valor.length };
    const nuevo = (valor.slice(0, inicio) + marca + valor.slice(fin)).slice(0, maximo);
    onChange(nuevo);
    const despues = Math.min(inicio + marca.length, nuevo.length);
    cursor.current = { inicio: despues, fin: despues, texto: nuevo };
    requestAnimationFrame(() => {
      const a = area.current;
      if (!a) return;
      a.focus();
      a.setSelectionRange(despues, despues);
    });
  };

  return (
    <Campo etiqueta={etiqueta} htmlFor={id} ayuda={ayuda}>
      <Textarea
        ref={area}
        id={id}
        value={valor}
        rows={filas}
        maxLength={maximo}
        placeholder={placeholder}
        disabled={disabled}
        className="text-sm"
        onChange={(e) => {
          onChange(e.target.value);
          recordar();
        }}
        onSelect={recordar}
        onKeyUp={recordar}
        onClick={recordar}
      />
      <div className="space-y-1">
        <p className="text-[11px] text-muted-foreground">
          Variables: pulsa una para escribirla donde está el cursor. Si una sale vacía, se quita ese
          trozo.
        </p>
        <div className="flex flex-wrap gap-1">
          {VARIABLES.map(([v, que]) => (
            <button
              key={v}
              type="button"
              disabled={disabled}
              title={que}
              aria-label={`Insertar {${v}}: ${que}`}
              // Que el área no pierda la selección antes de leerla.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertar(v)}
              className="rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              {`{${v}}`}
            </button>
          ))}
        </div>
      </div>
    </Campo>
  );
}
