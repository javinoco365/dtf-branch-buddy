import { useRef } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  MAXIMO_IMAGENES_PRESUPUESTO,
  TIPOS_IMAGEN_PRESUPUESTO,
} from "@/dominio/imagenes-presupuesto";
import type { EstadoImagenesPresupuesto } from "./useImagenesPresupuesto";

/** La sección del editor: miniaturas con su botón de quitar y «Añadir imágenes». */
export function ImagenesPresupuesto({ estado }: { estado: EstadoImagenesPresupuesto }) {
  const entrada = useRef<HTMLInputElement>(null);
  if (!estado.disponible) {
    return estado.nuevas.length > 0 ? (
      <p className="text-xs text-muted-foreground">
        Las imágenes no se guardarán: falta aplicar la migración 20261030100000.
      </p>
    ) : null;
  }

  const miniaturas = [
    ...estado.guardadas.map((i) => ({
      clave: i.id,
      url: i.url,
      nombre: i.nombre,
      quitar: () => estado.quitarGuardada(i.id),
    })),
    ...estado.nuevas.map((n) => ({
      clave: n.clave,
      url: n.url as string | null,
      nombre: n.fichero.name,
      quitar: () => estado.quitarNueva(n.clave),
    })),
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Imágenes ({estado.total}/{MAXIMO_IMAGENES_PRESUPUESTO}) · salen en el PDF
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => entrada.current?.click()}
          disabled={estado.total >= MAXIMO_IMAGENES_PRESUPUESTO}
        >
          <ImagePlus className="h-4 w-4 mr-1" /> Añadir imágenes
        </Button>
        <input
          ref={entrada}
          type="file"
          multiple
          accept={TIPOS_IMAGEN_PRESUPUESTO.join(",")}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) estado.anadir(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {miniaturas.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {estado.cargando ? "Cargando…" : "Sin imágenes. JPG, PNG o WEBP, de hasta 5 MB."}
        </p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {miniaturas.map((m) => (
            <div
              key={m.clave}
              className="relative aspect-square rounded-md border bg-muted overflow-hidden"
              title={m.nombre}
            >
              {m.url ? (
                <img src={m.url} alt={m.nombre} className="h-full w-full object-contain" />
              ) : (
                <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground p-1 text-center">
                  {m.nombre}
                </span>
              )}
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute top-1 right-1 h-6 w-6"
                aria-label={`Quitar ${m.nombre}`}
                onClick={m.quitar}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
