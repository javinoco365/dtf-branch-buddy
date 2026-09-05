import { useState } from "react";

/**
 * La marca de la casa: logotipo y nombre.
 *
 * El logotipo se sirve desde `public/marca/logo.svg`. Mientras ese fichero no
 * exista se pinta un monograma con las iniciales, no una imagen rota: el
 * componente arranca con el monograma y solo cambia al logotipo si la imagen
 * llega a cargar. Así se puede dejar el logotipo en su sitio cuando se tenga,
 * sin tocar código, y hasta entonces la pantalla no enseña un hueco.
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
  const caja = tamano === "lg" ? "h-12 w-12 rounded-xl" : "h-9 w-9 rounded-lg";
  const letras = tamano === "lg" ? "text-sm" : "text-[11px]";

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className={`${caja} bg-primary text-primary-foreground flex items-center justify-center shrink-0 shadow-sm overflow-hidden`}
      >
        <img
          src="/marca/logo.svg"
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
