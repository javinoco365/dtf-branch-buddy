import { ALTO_PAGINA, ANCHO_PAGINA, MARGEN, rellenarTexto } from "@/dominio/plantilla-presupuesto";
import { maquetaPie } from "@/dominio/maqueta-presupuesto";
import { numeroJusto } from "@/lib/format";
import { useEditor } from "./editor";
import {
  ANCLA,
  FUENTE_PDF,
  GRIS_LINEA,
  GRIS_SUAVE,
  INTERLINEA,
  MM_POR_PT,
  partirAprox,
} from "./aspecto";

/** Cuántos renglones caben en el pie antes de achicar la letra. */
export const RENGLONES_PIE = 3;
/** Lo que se reserva para «Página 1 de 2», a cada lado que haga falta (como el PDF). */
const HUECO_PAGINAS = 30;
/** La letra más pequeña a la que baja el pie para caber en tres renglones. */
const TAMANO_MINIMO = 5;

/**
 * El pie de la página a escala, con las reglas del PDF: los datos fiscales
 * con sus variables ya rellenas, la letra más pequeña si no caben en tres
 * renglones, la línea encima y el número de página en el lado contrario al
 * texto. Los renglones se cortan a ojo; lo exacto, en la vista previa.
 */
export function PiePagina() {
  const { plantilla, valores } = useEditor();
  const pie = plantilla.pie;
  const ancho =
    ANCHO_PAGINA -
    2 * MARGEN -
    (pie.paginas ? (pie.alineacion === "centro" ? 2 : 1) : 0) * HUECO_PAGINAS;
  const parrafos = rellenarTexto(pie.texto, valores);
  const partir = (tam: number) => parrafos.flatMap((l) => partirAprox(l, ancho, tam));

  let tamano = pie.tamano;
  let renglones = partir(tamano);
  while (renglones.length > RENGLONES_PIE && tamano > TAMANO_MINIMO) {
    tamano = Math.max(TAMANO_MINIMO, tamano - 0.5);
    renglones = partir(tamano);
  }

  const mp = maquetaPie(renglones.length, tamano);
  const arriba = Math.min(ALTO_PAGINA - 24, mp.raya - 6);
  const alto = ALTO_PAGINA - arriba;
  const x =
    pie.alineacion === "centro"
      ? ANCHO_PAGINA / 2
      : pie.alineacion === "derecha"
        ? ANCHO_PAGINA - MARGEN
        : MARGEN;
  const tam = tamano * MM_POR_PT;
  const paginasALaIzquierda = pie.alineacion === "derecha";
  const hayPie = renglones.length > 0 || pie.paginas;

  return (
    <div className="rounded-lg border bg-muted/40 p-2 sm:p-3">
      <svg
        viewBox={`0 ${arriba} ${ANCHO_PAGINA} ${alto}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Pie de página a escala"
      >
        <rect
          x={0}
          y={arriba}
          width={ANCHO_PAGINA}
          height={alto}
          fill="white"
          stroke="rgb(203 213 225)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {hayPie && (
          <line
            x1={MARGEN}
            x2={ANCHO_PAGINA - MARGEN}
            y1={mp.raya}
            y2={mp.raya}
            stroke={GRIS_LINEA}
            strokeWidth={0.3}
          />
        )}
        <text
          x={x}
          y={mp.primeraLinea}
          fontSize={tam}
          fontFamily={FUENTE_PDF}
          textAnchor={ANCLA[pie.alineacion]}
          fill={GRIS_SUAVE}
        >
          {renglones.map((l, i) => (
            <tspan key={i} x={x} dy={i === 0 ? 0 : tam * INTERLINEA}>
              {l}
            </tspan>
          ))}
        </text>
        {pie.paginas && (
          <text
            x={paginasALaIzquierda ? MARGEN : ANCHO_PAGINA - MARGEN}
            y={mp.primeraLinea}
            fontSize={tam}
            fontFamily={FUENTE_PDF}
            textAnchor={paginasALaIzquierda ? "start" : "end"}
            fill={GRIS_SUAVE}
          >
            Página 1 de 1
          </text>
        )}
      </svg>
      {renglones.length === 0 ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          El pie sale sin texto: no hay, o sus variables no tienen datos.
        </p>
      ) : tamano < pie.tamano ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          No cabe en {RENGLONES_PIE} renglones a {numeroJusto(pie.tamano, 1)} pt: la letra baja a
          unos {numeroJusto(tamano, 1)} pt.
        </p>
      ) : null}
    </div>
  );
}
