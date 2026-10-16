import { ALTO_PAGINA, ANCHO_PAGINA, MARGEN, rellenarTexto } from "@/dominio/plantilla-presupuesto";
import { maquetaPie } from "@/dominio/maqueta-presupuesto";
import { numeroJusto } from "@/lib/format";
import { useEditor } from "./editor";
import {
  ANCLA,
  FUENTE_PDF,
  FUENTE_TITULAR,
  GRIS_SUAVE,
  INTERLINEA,
  MM_POR_PT,
  coloresDiseno,
  partirAprox,
} from "./aspecto";

/** Cuántos renglones caben en el pie antes de achicar la letra. */
export const RENGLONES_PIE = 2;
/** La letra más pequeña a la que baja el pie para caber en sus renglones. */
const TAMANO_MINIMO = 5;

/**
 * La banda del pie a escala, con las reglas del PDF: el título a la
 * izquierda en grande, y el texto con sus variables ya rellenas en lo que
 * queda, con la letra más pequeña si no cabe en dos renglones. Los renglones
 * se cortan a ojo; lo exacto, en la vista previa.
 */
export function PiePagina() {
  const { plantilla, valores } = useEditor();
  const pie = plantilla.pie;
  const colores = coloresDiseno(plantilla);
  const titulo = rellenarTexto(pie.titulo, valores).join(" ").toUpperCase();
  const tamTitulo = 11 * MM_POR_PT;
  // A ojo: Anton es estrecha.
  const anchoTitulo = titulo ? titulo.length * tamTitulo * 0.5 : 0;
  const xTexto = MARGEN + (anchoTitulo ? anchoTitulo + 8 : 0);
  const ancho = ANCHO_PAGINA - MARGEN - xTexto;
  const parrafos = rellenarTexto(pie.texto, valores);
  const partir = (tam: number) => parrafos.flatMap((l) => partirAprox(l, ancho, tam));

  let tamano = pie.tamano;
  let renglones = partir(tamano);
  while (renglones.length > RENGLONES_PIE && tamano > TAMANO_MINIMO) {
    tamano = Math.max(TAMANO_MINIMO, tamano - 0.5);
    renglones = partir(tamano);
  }

  const mp = maquetaPie(renglones.length, tamano);
  const arriba = mp.arriba - 6;
  const alto = ALTO_PAGINA - arriba;
  const x =
    pie.alineacion === "centro"
      ? xTexto + ancho / 2
      : pie.alineacion === "derecha"
        ? ANCHO_PAGINA - MARGEN
        : xTexto;
  const tam = tamano * MM_POR_PT;

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
        <rect
          x={0}
          y={mp.arriba}
          width={ANCHO_PAGINA}
          height={ALTO_PAGINA - mp.arriba}
          fill={colores.banda}
        />
        {titulo && (
          <text
            x={MARGEN}
            y={mp.arriba + (ALTO_PAGINA - mp.arriba - tamTitulo * 0.86) / 2 + tamTitulo * 0.86}
            fontSize={tamTitulo}
            fontFamily={FUENTE_TITULAR}
            letterSpacing={0.12}
            fill={colores.acento}
          >
            {titulo}
          </text>
        )}
        <text
          x={x}
          y={mp.primeraLinea}
          fontSize={tam}
          fontFamily={FUENTE_PDF}
          textAnchor={ANCLA[pie.alineacion]}
          fill={colores.sobreBanda}
        >
          {renglones.map((l, i) => (
            <tspan key={i} x={x} dy={i === 0 ? 0 : tam * INTERLINEA}>
              {l}
            </tspan>
          ))}
        </text>
        {pie.paginas && (
          <text
            x={ANCHO_PAGINA - MARGEN}
            y={mp.arriba - 1.5}
            fontSize={7 * MM_POR_PT}
            fontFamily={FUENTE_PDF}
            textAnchor="end"
            fill={GRIS_SUAVE}
          >
            Página 1 de 2 (solo si hay más de una)
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
