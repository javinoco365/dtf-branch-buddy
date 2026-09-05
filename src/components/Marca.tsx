import { useState } from "react";

/**
 * La marca de la casa: logotipo y nombre.
 *
 * El logotipo se sirve desde `public/marca/logo.png`, con fondo transparente.
 * Mientras ese fichero no exista se pinta un monograma con las iniciales, no
 * una imagen rota: el componente arranca con el monograma y solo cambia al
 * logotipo si la imagen llega a cargar de verdad.
 *
 * El recuadro navy de detrás solo se pinta con el monograma. El logotipo ya
 * trae su propio fondo navy y su filete cyan, así que ponerlo encima de otro
 * recuadro navy le comería el filete por los bordes.
 */
export const MARCA_NOMBRE = "DTF Culture";
export const MARCA_DESCRIPCION = "Gestión multi-tienda";

export function Marca({
  tamano = "sm",
  soloIcono = false,
}: {
  tamano?: "sm" | "lg";
  soloIcono?: boolean;
}) {
  const [conLogo, setConLogo] = useState(false);
  const caja = tamano === "lg" ? "h-12 w-12" : "h-9 w-9";
  const letras = tamano === "lg" ? "text-sm" : "text-[11px]";
  const fondo = conLogo
    ? ""
    : `bg-primary text-primary-foreground shadow-sm ${tamano === "lg" ? "rounded-xl" : "rounded-lg"}`;

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className={`${caja} ${fondo} flex items-center justify-center shrink-0 overflow-hidden`}>
        <img
          src="/marca/logo.png"
          alt=""
          className={conLogo ? "h-full w-full object-contain" : "hidden"}
          onLoad={() => setConLogo(true)}
        />
        {!conLogo && <span className={`${letras} font-bold tracking-tight`}>DTF</span>}
      </div>
      {!soloIcono && (
        <div className="min-w-0">
          <div
            className={`font-bold truncate tracking-wide ${tamano === "lg" ? "text-xl" : "text-sm"}`}
          >
            {MARCA_NOMBRE}
          </div>
          {/* opacity y no text-muted-foreground: este componente se pinta sobre
              la tarjeta clara del acceso y sobre el menú lateral oscuro, y un
              color fijo pensado para uno de los dos se lee mal en el otro.
              Heredando el color de donde esté, funciona en ambos. */}
          <div className="text-[11px] opacity-60 truncate">{MARCA_DESCRIPCION}</div>
        </div>
      )}
    </div>
  );
}
