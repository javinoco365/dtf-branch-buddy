import { useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, EyeOff, Move } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { numeroJusto } from "@/lib/format";
import { ANCHO_PAGINA, MARGEN, rellenarTexto } from "@/dominio/plantilla-presupuesto";
import { inicioCuerpo } from "@/dominio/maqueta-presupuesto";
import {
  ELEMENTOS,
  NOMBRE_ELEMENTO,
  SECCION_DE,
  conCabecera,
  conElemento,
  useEditor,
  type ElementoCabecera,
  type Plantilla,
  type Seleccion,
} from "./editor";
import { MAXIMOS, MINIMOS, aMedioMm, acotar } from "./limites";
import {
  ANCLA,
  FUENTE_PDF,
  GRIS_LINEA,
  GRIS_SUAVE,
  GRIS_TEXTO,
  INTERLINEA,
  MM_POR_PT,
  SALTO_DATOS,
  coloresDiseno,
  encajeLogo,
  nombreVisible,
} from "./aspecto";
import { CampoAlineacion, CampoInterruptor, CampoNumero } from "./Campos";

/**
 * El diseñador de la cabecera: la franja de arriba de un A4 a escala, con el
 * logo, el nombre comercial, el título, los datos y el texto libre como cajas
 * que se arrastran (con el ratón o con el dedo) y la línea de la cabecera, que
 * se sube o se baja. Todo en milímetros, al medio milímetro, sin salirse de la
 * página. Debajo, la posición exacta de lo elegido, en campos que siguen al
 * arrastre y que también lo mueven.
 */

/** Lo que se ve del cuerpo, para situarse: unos milímetros de las cajas del emisor y el cliente. */
const BAJO_CUERPO = 7;
/** A cuántos mm de una guía (márgenes, centro) se pega lo que se arrastra. */
const IMAN = 1.5;
const GUIAS = [MARGEN, ANCHO_PAGINA / 2, ANCHO_PAGINA - MARGEN];

type Caja = { x: number; y: number; ancho: number; alto: number };

type Arrastre =
  | {
      tipo: "mover";
      el: ElementoCabecera;
      px0: number;
      py0: number;
      x0: number;
      y0: number;
      mmPorPx: number;
      /** La caja del elemento respecto a su punto (x, y): para no sacarla de la página. */
      izq: number;
      der: number;
      arriba: number;
      abajo: number;
      altoLienzo: number;
    }
  | {
      tipo: "tamano";
      el: "logo" | "datos";
      px0: number;
      py0: number;
      ancho0: number;
      alto0: number;
      mmPorPx: number;
    }
  | { tipo: "linea"; py0: number; alto0: number; mmPorPx: number };

/** El punto de referencia de un elemento: (x, y) de la plantilla. */
const punto = (p: Plantilla, el: ElementoCabecera) => ({
  x: p.cabecera[el].x,
  y: p.cabecera[el].y,
});

/** Los bordes que se comparan con las guías al mover: el punto y, si tiene ancho, el borde derecho. */
function pegarAGuia(x: number, ancho: number | null): { x: number; guia: number | null } {
  for (const g of GUIAS) {
    if (Math.abs(x - g) <= IMAN) return { x: g, guia: g };
    if (ancho != null && Math.abs(x + ancho - g) <= IMAN) return { x: g - ancho, guia: g };
  }
  return { x, guia: null };
}

export function DisenadorCabecera({
  seleccion,
  onSeleccion,
  onMasOpciones,
}: {
  seleccion: Seleccion | null;
  onSeleccion: (s: Seleccion | null) => void;
  /** Abre en el formulario la sección de lo elegido. */
  onMasOpciones: (seccion: string) => void;
}) {
  const { plantilla: p, cambiar, identidad, logoPropio, base, valores } = useEditor();
  const cab = p.cabecera;
  const { texto: colorTexto, acento } = coloresDiseno(p, base.color);

  const marco = useRef<HTMLDivElement>(null);
  const arrastre = useRef<Arrastre | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [guia, setGuia] = useState<number | null>(null);

  // Las cajas de cada elemento, medidas en el propio dibujo (en mm).
  const contenidos = useRef<Partial<Record<ElementoCabecera, SVGGElement | null>>>({});
  const [cajas, setCajas] = useState<Partial<Record<ElementoCabecera, Caja>>>({});
  useLayoutEffect(() => {
    const nuevas: Partial<Record<ElementoCabecera, Caja>> = {};
    for (const el of ELEMENTOS) {
      const g = contenidos.current[el];
      if (!g) continue;
      try {
        const b = g.getBBox();
        if (b.width > 0 || b.height > 0) {
          nuevas[el] = { x: b.x, y: b.y, ancho: b.width, alto: b.height };
        }
      } catch {
        // Sin medir (aún no se ha pintado): sin caja.
      }
    }
    const distinta = ELEMENTOS.some((el) => {
      const a = cajas[el];
      const b = nuevas[el];
      if (!a || !b) return !!a !== !!b;
      return (
        Math.abs(a.x - b.x) > 0.01 ||
        Math.abs(a.y - b.y) > 0.01 ||
        Math.abs(a.ancho - b.ancho) > 0.01 ||
        Math.abs(a.alto - b.alto) > 0.01
      );
    });
    if (distinta) setCajas(nuevas);
    // Se mide cada vez que cambia algo de lo que se dibuja; si sale lo mismo, no se toca.
  }, [cab, identidad.nombre_comercial, valores, logoPropio, base.logo_url, cajas]);

  const logoDisponible = logoPropio || base.logo_url;
  const verNombre = nombreVisible(p, !!logoDisponible);
  const visible: Record<ElementoCabecera, boolean> = {
    logo: cab.logo.mostrar && !!logoDisponible,
    nombre: verNombre,
    titulo: cab.titulo.mostrar,
    datos: cab.datos.mostrar,
    texto: cab.texto.mostrar && cab.texto.texto.trim() !== "",
  };

  // Dónde empieza el cuerpo, como en el PDF: 7 mm bajo la línea, o 6 mm bajo
  // lo más bajo que salga en la cabecera si baja más. El dibujo llega un poco
  // más abajo, para que se vea dónde empieza.
  const cajasVisibles = ELEMENTOS.flatMap((el) => {
    const c = cajas[el];
    return visible[el] && c ? [{ x0: c.x, y0: c.y, x1: c.x + c.ancho, y1: c.y + c.alto }] : [];
  });
  const inicio = inicioCuerpo(cab.alto, cajasVisibles);
  const altoLienzo = inicio + BAJO_CUERPO;

  const mmPorPx = () => {
    const ancho = marco.current?.getBoundingClientRect().width ?? 0;
    return ancho > 0 ? ANCHO_PAGINA / ancho : 1;
  };

  const empezar = (e: React.PointerEvent, a: Arrastre) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.preventDefault();
    marco.current?.setPointerCapture(e.pointerId);
    arrastre.current = a;
    setArrastrando(true);
  };

  const empezarMover = (e: React.PointerEvent, el: ElementoCabecera) => {
    onSeleccion(el);
    const { x, y } = punto(p, el);
    const c = cajas[el] ?? { x, y, ancho: 0, alto: 0 };
    empezar(e, {
      tipo: "mover",
      el,
      px0: e.clientX,
      py0: e.clientY,
      x0: x,
      y0: y,
      mmPorPx: mmPorPx(),
      izq: c.x - x,
      der: c.x + c.ancho - x,
      arriba: c.y - y,
      abajo: c.y + c.alto - y,
      altoLienzo,
    });
  };

  const mover = (e: React.PointerEvent) => {
    const a = arrastre.current;
    if (!a) return;
    const dy = (e.clientY - a.py0) * a.mmPorPx;
    if (a.tipo === "linea") {
      const alto = acotar(aMedioMm(a.alto0 + dy), MINIMOS.cabecera.alto, MAXIMOS.cabecera.alto);
      if (alto !== cab.alto) cambiar(conCabecera({ alto }));
      return;
    }
    const dx = (e.clientX - a.px0) * a.mmPorPx;
    if (a.tipo === "tamano") {
      if (a.el === "logo") {
        const l = cab.logo;
        const ancho = acotar(
          aMedioMm(a.ancho0 + dx),
          MINIMOS.cabecera.logo.ancho,
          Math.min(MAXIMOS.cabecera.logo.ancho, ANCHO_PAGINA - l.x),
        );
        const alto = acotar(
          aMedioMm(a.alto0 + dy),
          MINIMOS.cabecera.logo.alto,
          MAXIMOS.cabecera.logo.alto,
        );
        cambiar(conElemento("logo", { ancho, alto }));
      } else {
        const ancho = acotar(
          aMedioMm(a.ancho0 + dx),
          MINIMOS.cabecera.datos.ancho,
          Math.min(MAXIMOS.cabecera.datos.ancho, ANCHO_PAGINA - cab.datos.x),
        );
        cambiar(conElemento("datos", { ancho }));
      }
      return;
    }
    // Mover: al medio milímetro, pegado a los márgenes y al centro si pasa cerca,
    // y con la caja entera dentro de la página.
    const anchoCaja = a.el === "logo" ? cab.logo.ancho : a.el === "datos" ? cab.datos.ancho : null;
    const pegado = pegarAGuia(aMedioMm(a.x0 + dx), anchoCaja);
    const minX = Math.max(MINIMOS.cabecera[a.el].x, -a.izq);
    const maxX = Math.min(MAXIMOS.cabecera[a.el].x, ANCHO_PAGINA - a.der);
    const minY = Math.max(MINIMOS.cabecera[a.el].y, -a.arriba);
    const maxY = Math.min(MAXIMOS.cabecera[a.el].y, a.altoLienzo - a.abajo);
    const x = acotar(pegado.x, minX, Math.max(minX, maxX));
    const y = acotar(aMedioMm(a.y0 + dy), minY, Math.max(minY, maxY));
    setGuia(pegado.guia != null && x === pegado.x ? pegado.guia : null);
    const actual = punto(p, a.el);
    if (x !== actual.x || y !== actual.y) cambiar(conElemento(a.el, { x, y }));
  };

  const soltar = (e: React.PointerEvent) => {
    if (!arrastre.current) return;
    arrastre.current = null;
    setArrastrando(false);
    setGuia(null);
    if (marco.current?.hasPointerCapture(e.pointerId)) {
      marco.current.releasePointerCapture(e.pointerId);
    }
  };

  /** Con el teclado: flechas, medio milímetro; con mayúsculas, 5 mm. */
  const teclas = (e: React.KeyboardEvent, s: Seleccion) => {
    const paso = e.shiftKey ? 5 : 0.5;
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-paso, 0],
      ArrowRight: [paso, 0],
      ArrowUp: [0, -paso],
      ArrowDown: [0, paso],
    };
    const mov = d[e.key];
    if (!mov) return;
    e.preventDefault();
    if (s === "linea") {
      const alto = acotar(cab.alto + mov[1], MINIMOS.cabecera.alto, MAXIMOS.cabecera.alto);
      cambiar(conCabecera({ alto }));
      return;
    }
    const { x, y } = punto(p, s);
    cambiar(
      conElemento(s, {
        x: acotar(aMedioMm(x + mov[0]), MINIMOS.cabecera[s].x, MAXIMOS.cabecera[s].x),
        y: acotar(aMedioMm(y + mov[1]), MINIMOS.cabecera[s].y, MAXIMOS.cabecera[s].y),
      }),
    );
  };

  const pt = (tamano: number) => tamano * MM_POR_PT;

  // Lo que dice cada elemento, con los datos de la vista previa si los hay.
  const nombre = identidad.nombre_comercial || base.nombre || "";
  const lineasTexto = rellenarTexto(cab.texto.texto, valores);
  // Una etiqueta vacía quita su fila, como en el PDF.
  const filasDatos = (
    [
      [cab.datos.etiquetaNumero, valores.numero || "—"],
      [cab.datos.etiquetaFecha, valores.fecha || "—"],
      [cab.datos.etiquetaValidez, valores.fecha_validez || "—"],
    ] as const
  ).filter(([etiqueta]) => etiqueta.trim() !== "");

  /**
   * Un elemento arrastrable: su dibujo, una caja para cogerlo y el marco si
   * está elegido. Lo que no sale en el PDF no se dibuja, salvo si se elige en
   * la lista: entonces sale tenue, para poder colocarlo.
   */
  const elemento = (el: ElementoCabecera, dibujo: React.ReactNode) => {
    const c = cajas[el];
    const elegido = seleccion === el;
    if (!visible[el] && !elegido) return null;
    const { x, y } = punto(p, el);
    return (
      <g
        key={el}
        role="button"
        tabIndex={0}
        aria-pressed={elegido}
        aria-label={`${NOMBRE_ELEMENTO[el]}: ${numeroJusto(x, 1)} mm desde la izquierda, ${numeroJusto(
          y,
          1,
        )} mm desde arriba${visible[el] ? "" : " (no sale en el PDF)"}. Arrástralo o muévelo con las flechas.`}
        className="cursor-grab outline-none active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => empezarMover(e, el)}
        onKeyDown={(e) => teclas(e, el)}
        onFocus={() => onSeleccion(el)}
        opacity={visible[el] ? 1 : 0.35}
      >
        <g ref={(g) => void (contenidos.current[el] = g)}>{dibujo}</g>
        {c && (
          <rect
            className="marco"
            x={c.x - 0.8}
            y={c.y - 0.8}
            width={c.ancho + 1.6}
            height={c.alto + 1.6}
            rx={0.6}
            fill="transparent"
            style={{ stroke: elegido ? "var(--primary)" : "rgb(148 163 184)" }}
            strokeWidth={elegido ? 1.5 : 1}
            strokeDasharray={elegido ? undefined : "3 3"}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </g>
    );
  };

  const textoPdf = (
    t: { x: number; y: number; tamano: number; alineacion: keyof typeof ANCLA },
    contenido: React.ReactNode,
    color: string,
    negrita = true,
  ) => (
    <text
      x={t.x}
      y={t.y}
      fontSize={pt(t.tamano)}
      fontFamily={FUENTE_PDF}
      fontWeight={negrita ? 700 : 400}
      textAnchor={ANCLA[t.alineacion]}
      fill={color}
      style={{ userSelect: "none" }}
    >
      {contenido}
    </text>
  );

  // La caja de lo elegido, en porcentajes del lienzo, para el rótulo y los tiradores.
  const cajaElegida = seleccion && seleccion !== "linea" ? cajas[seleccion] : undefined;
  const pct = (mmX: number, mmY: number) => ({
    left: `${(mmX / ANCHO_PAGINA) * 100}%`,
    top: `${(mmY / altoLienzo) * 100}%`,
  });

  // Lo que baja tanto de la línea que empuja el cuerpo hacia abajo.
  const empujanCuerpo = ELEMENTOS.filter((el) => {
    const c = cajas[el];
    return visible[el] && c && c.y + c.alto + 6 > cab.alto + 7 + 0.25;
  });

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/40 p-2 sm:p-3">
        <div
          ref={marco}
          className={cn("relative select-none", arrastrando && "cursor-grabbing")}
          onPointerMove={mover}
          onPointerUp={soltar}
          onPointerCancel={soltar}
          onLostPointerCapture={() => {
            arrastre.current = null;
            setArrastrando(false);
            setGuia(null);
          }}
          // Un toque en el papel, fuera de todo, quita la selección (los
          // elementos, la línea y los tiradores no dejan que llegue aquí).
          onPointerDown={() => onSeleccion(null)}
        >
          <svg
            viewBox={`0 0 ${ANCHO_PAGINA} ${altoLienzo}`}
            className="block h-auto w-full overflow-visible"
            role="group"
            aria-label="Cabecera del PDF a escala"
          >
            <defs>
              <linearGradient id="disenador-corte" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="white" stopOpacity="0" />
                <stop offset="1" stopColor="white" stopOpacity="1" />
              </linearGradient>
            </defs>
            {/* El papel y los márgenes del cuerpo. */}
            <rect
              x={0}
              y={0}
              width={ANCHO_PAGINA}
              height={altoLienzo}
              fill="white"
              stroke="rgb(203 213 225)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            {[MARGEN, ANCHO_PAGINA - MARGEN].map((x) => (
              <line
                key={x}
                x1={x}
                x2={x}
                y1={0}
                y2={altoLienzo}
                stroke="rgb(186 230 253)"
                strokeDasharray="4 4"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {guia != null && (
              <line
                x1={guia}
                x2={guia}
                y1={0}
                y2={altoLienzo}
                stroke="rgb(236 72 153)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}

            {/* Donde empieza el cuerpo: el arranque de las cajas del emisor y el cliente. */}
            <g pointerEvents="none" style={{ userSelect: "none" }}>
              {[0, 1].map((i) => {
                const ancho = (ANCHO_PAGINA - 2 * MARGEN - 6) / 2;
                return (
                  <rect
                    key={i}
                    x={MARGEN + i * (ancho + 6)}
                    y={inicio}
                    width={ancho}
                    height={BAJO_CUERPO}
                    rx={1.5}
                    fill="rgb(248 250 252)"
                    stroke={GRIS_LINEA}
                    strokeWidth={0.3}
                  />
                );
              })}
              <text
                x={MARGEN + 4}
                y={inicio + 4.5}
                fontSize={2.6}
                fontFamily={FUENTE_PDF}
                fill="rgb(148 163 184)"
              >
                Aquí empieza el cuerpo ({numeroJusto(inicio, 1)} mm): emisor y cliente, líneas…
              </text>
              <rect
                x={0}
                y={inicio + 2}
                width={ANCHO_PAGINA}
                height={BAJO_CUERPO - 2}
                fill="url(#disenador-corte)"
              />
            </g>

            {elemento(
              "logo",
              logoDisponible ? (
                <image
                  href={logoDisponible}
                  x={cab.logo.x}
                  y={cab.logo.y}
                  width={cab.logo.ancho}
                  height={cab.logo.alto}
                  preserveAspectRatio={encajeLogo(cab.logo)}
                />
              ) : (
                <>
                  <rect
                    x={cab.logo.x}
                    y={cab.logo.y}
                    width={cab.logo.ancho}
                    height={cab.logo.alto}
                    fill="rgb(241 245 249)"
                  />
                  <text
                    x={cab.logo.x + cab.logo.ancho / 2}
                    y={cab.logo.y + cab.logo.alto / 2 + 1}
                    fontSize={3}
                    fontFamily={FUENTE_PDF}
                    textAnchor="middle"
                    fill={GRIS_SUAVE}
                    style={{ userSelect: "none" }}
                  >
                    Sin logo
                  </text>
                </>
              ),
            )}
            {elemento("nombre", textoPdf(cab.nombre, nombre || "Nombre comercial", colorTexto))}
            {elemento("titulo", textoPdf(cab.titulo, cab.titulo.texto || "Título", colorTexto))}
            {elemento(
              "datos",
              <>
                {filasDatos.map(([etiqueta, valor], i) => (
                  <g key={i}>
                    <text
                      x={cab.datos.x}
                      y={cab.datos.y + i * SALTO_DATOS}
                      fontSize={pt(8.5)}
                      fontFamily={FUENTE_PDF}
                      fill={GRIS_SUAVE}
                      style={{ userSelect: "none" }}
                    >
                      {etiqueta}
                    </text>
                    <text
                      x={cab.datos.x + cab.datos.ancho}
                      y={cab.datos.y + i * SALTO_DATOS}
                      fontSize={pt(9.5)}
                      fontFamily={FUENTE_PDF}
                      fontWeight={700}
                      textAnchor="end"
                      fill={GRIS_TEXTO}
                      style={{ userSelect: "none" }}
                    >
                      {valor}
                    </text>
                  </g>
                ))}
              </>,
            )}
            {elemento(
              "texto",
              textoPdf(
                cab.texto,
                (lineasTexto.length ? lineasTexto : ["Texto libre"]).map((l, i) => (
                  <tspan
                    key={i}
                    x={cab.texto.x}
                    dy={i === 0 ? 0 : pt(cab.texto.tamano) * INTERLINEA}
                  >
                    {l}
                  </tspan>
                )),
                GRIS_SUAVE,
                false,
              ),
            )}

            {/* La línea de la cabecera: se arrastra arriba y abajo. */}
            <g
              role="slider"
              tabIndex={0}
              aria-label="Línea de la cabecera: dónde empieza el cuerpo"
              aria-valuemin={MINIMOS.cabecera.alto}
              aria-valuemax={MAXIMOS.cabecera.alto}
              aria-valuenow={cab.alto}
              aria-valuetext={`${numeroJusto(cab.alto, 1)} mm desde arriba`}
              className="cursor-ns-resize outline-none"
              style={{ touchAction: "none" }}
              onPointerDown={(e) => {
                onSeleccion("linea");
                empezar(e, { tipo: "linea", py0: e.clientY, alto0: cab.alto, mmPorPx: mmPorPx() });
              }}
              onKeyDown={(e) => teclas(e, "linea")}
              onFocus={() => onSeleccion("linea")}
            >
              <line
                x1={MARGEN}
                x2={ANCHO_PAGINA - MARGEN}
                y1={cab.alto}
                y2={cab.alto}
                stroke={cab.linea ? acento : "rgb(148 163 184)"}
                strokeWidth={cab.linea ? 0.8 : 0.3}
                strokeDasharray={cab.linea ? undefined : "1.5 1.5"}
              />
              {/* Más gruesa por dentro, para cogerla con el dedo. */}
              <rect
                x={0}
                y={cab.alto - 2.5}
                width={ANCHO_PAGINA}
                height={5}
                style={{
                  fill:
                    seleccion === "linea"
                      ? "color-mix(in oklab, var(--primary) 14%, transparent)"
                      : "transparent",
                }}
              />
            </g>
          </svg>

          {/* El rótulo de lo elegido y sus tiradores, por encima del dibujo. */}
          {cajaElegida && seleccion && seleccion !== "linea" && (
            <div
              className="pointer-events-none absolute -translate-y-full pb-1"
              style={pct(cajaElegida.x - 0.8, cajaElegida.y - 0.8)}
            >
              <span className="whitespace-nowrap rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground shadow-sm">
                {NOMBRE_ELEMENTO[seleccion]}
                {!visible[seleccion] && " · no sale"}
              </span>
            </div>
          )}
          {seleccion === "logo" && cajas.logo && (
            <Tirador
              titulo="Cambiar el tamaño de la caja del logo"
              cursor="nwse-resize"
              style={pct(cab.logo.x + cab.logo.ancho, cab.logo.y + cab.logo.alto)}
              onPointerDown={(e) =>
                empezar(e, {
                  tipo: "tamano",
                  el: "logo",
                  px0: e.clientX,
                  py0: e.clientY,
                  ancho0: cab.logo.ancho,
                  alto0: cab.logo.alto,
                  mmPorPx: mmPorPx(),
                })
              }
            />
          )}
          {seleccion === "datos" && cajas.datos && (
            <Tirador
              titulo="Cambiar el ancho de los datos"
              cursor="ew-resize"
              style={pct(cab.datos.x + cab.datos.ancho + 0.8, cajas.datos.y + cajas.datos.alto / 2)}
              onPointerDown={(e) =>
                empezar(e, {
                  tipo: "tamano",
                  el: "datos",
                  px0: e.clientX,
                  py0: e.clientY,
                  ancho0: cab.datos.ancho,
                  alto0: 0,
                  mmPorPx: mmPorPx(),
                })
              }
            />
          )}
          <div
            className="pointer-events-none absolute right-1 -translate-y-1/2"
            style={{ top: `${(cab.alto / altoLienzo) * 100}%` }}
          >
            <span
              className={cn(
                "rounded px-1 py-0.5 text-[10px] tabular-nums shadow-sm",
                seleccion === "linea"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background/90 text-muted-foreground",
              )}
            >
              {numeroJusto(cab.alto, 1)} mm
            </span>
          </div>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Move className="h-3 w-3 shrink-0" />
          Arrastra cada caja para colocarla y la línea para cambiar dónde empieza el cuerpo. Se pega
          a los márgenes (en azul) y al centro.
        </p>
      </div>

      {empujanCuerpo.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {empujanCuerpo.map((el) => NOMBRE_ELEMENTO[el]).join(", ")}{" "}
            {empujanCuerpo.length === 1 ? "baja" : "bajan"} de la línea de la cabecera: el cuerpo
            empieza más abajo, a {numeroJusto(inicio, 1)} mm, para no pisar{" "}
            {empujanCuerpo.length === 1 ? "lo" : "los"}. Súbelo o baja la línea si quieres que quede
            dentro de la cabecera.
          </span>
        </p>
      )}

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={seleccion ?? ""}
        onValueChange={(v) => onSeleccion((v || null) as Seleccion | null)}
        className="flex-wrap justify-start"
        aria-label="Elegir un elemento de la cabecera"
      >
        {[...ELEMENTOS, "linea" as const].map((s) => {
          const oculto = s === "linea" ? !cab.linea : !visible[s];
          return (
            <ToggleGroupItem
              key={s}
              value={s}
              className="px-2.5 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
            >
              {oculto && <EyeOff className="text-muted-foreground" aria-label="no sale" />}
              {NOMBRE_ELEMENTO[s]}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>

      {seleccion ? (
        <PosicionElegida seleccion={seleccion} onMasOpciones={onMasOpciones} />
      ) : (
        <p className="text-xs text-muted-foreground">
          Toca un elemento en el dibujo o en la lista para ver su posición exacta.
        </p>
      )}
    </div>
  );
}

/** Un tirador para cambiar el tamaño: grande para el dedo, pequeño a la vista. */
function Tirador({
  titulo,
  cursor,
  style,
  onPointerDown,
}: {
  titulo: string;
  cursor: string;
  style: React.CSSProperties;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
      style={{ ...style, cursor, touchAction: "none" }}
      onPointerDown={onPointerDown}
    >
      <span className="h-2.5 w-2.5 rounded-sm border border-primary bg-background shadow" />
    </button>
  );
}

/** La posición exacta de lo elegido, en campos que siguen al arrastre. */
function PosicionElegida({
  seleccion,
  onMasOpciones,
}: {
  seleccion: Seleccion;
  onMasOpciones: (seccion: string) => void;
}) {
  const { plantilla: p, cambiar } = useEditor();
  const cab = p.cabecera;

  let campos: React.ReactNode;
  if (seleccion === "linea") {
    campos = (
      <>
        <CampoNumero
          etiqueta="Línea a"
          valor={cab.alto}
          min={MINIMOS.cabecera.alto}
          max={MAXIMOS.cabecera.alto}
          onChange={(alto) => cambiar(conCabecera({ alto }))}
        />
        <CampoInterruptor
          etiqueta="Dibujar la línea"
          valor={cab.linea}
          onChange={(linea) => cambiar(conCabecera({ linea }))}
          className="col-span-2 self-end pb-1.5 sm:col-span-1"
        />
      </>
    );
  } else {
    const el = cab[seleccion];
    const xy = (
      <>
        <CampoNumero
          etiqueta="X"
          valor={el.x}
          min={MINIMOS.cabecera[seleccion].x}
          max={MAXIMOS.cabecera[seleccion].x}
          onChange={(x) => cambiar(conElemento(seleccion, { x }))}
        />
        <CampoNumero
          etiqueta="Y"
          valor={el.y}
          min={MINIMOS.cabecera[seleccion].y}
          max={MAXIMOS.cabecera[seleccion].y}
          onChange={(y) => cambiar(conElemento(seleccion, { y }))}
        />
      </>
    );
    if (seleccion === "logo") {
      campos = (
        <>
          {xy}
          <CampoNumero
            etiqueta="Ancho"
            valor={cab.logo.ancho}
            min={MINIMOS.cabecera.logo.ancho}
            max={MAXIMOS.cabecera.logo.ancho}
            onChange={(ancho) => cambiar(conElemento("logo", { ancho }))}
          />
          <CampoNumero
            etiqueta="Alto"
            valor={cab.logo.alto}
            min={MINIMOS.cabecera.logo.alto}
            max={MAXIMOS.cabecera.logo.alto}
            onChange={(alto) => cambiar(conElemento("logo", { alto }))}
          />
        </>
      );
    } else if (seleccion === "datos") {
      campos = (
        <>
          {xy}
          <CampoNumero
            etiqueta="Ancho"
            valor={cab.datos.ancho}
            min={MINIMOS.cabecera.datos.ancho}
            max={MAXIMOS.cabecera.datos.ancho}
            onChange={(ancho) => cambiar(conElemento("datos", { ancho }))}
          />
        </>
      );
    } else {
      const t = cab[seleccion];
      campos = (
        <>
          {xy}
          <CampoNumero
            etiqueta="Tamaño"
            unidad="pt"
            valor={t.tamano}
            min={MINIMOS.cabecera[seleccion].tamano}
            max={MAXIMOS.cabecera[seleccion].tamano}
            onChange={(tamano) => cambiar(conElemento(seleccion, { tamano }))}
          />
          <CampoAlineacion
            valor={t.alineacion}
            onChange={(alineacion) => cambiar(conElemento(seleccion, { alineacion }))}
          />
        </>
      );
    }
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{NOMBRE_ELEMENTO[seleccion]}</p>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => onMasOpciones(SECCION_DE[seleccion])}
        >
          Más opciones <ArrowDown />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{campos}</div>
      {seleccion !== "linea" && (
        <p className="text-[11px] text-muted-foreground">
          {seleccion === "logo"
            ? "X e Y: la esquina de arriba a la izquierda de la caja, en mm desde el borde del papel. El logo se encaja en la caja sin deformarse."
            : seleccion === "datos"
              ? "X: donde empiezan las etiquetas; las cifras acaban en X + ancho. Y: la línea sobre la que se apoya la primera fila. En mm desde el borde del papel."
              : "X: el punto donde se alinea el texto. Y: la línea sobre la que se apoya. En mm desde el borde del papel."}
        </p>
      )}
    </div>
  );
}
