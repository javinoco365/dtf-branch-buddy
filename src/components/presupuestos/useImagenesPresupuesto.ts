import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listarImagenesPresupuesto,
  quitarImagenPresupuesto,
  subirImagenPresupuesto,
} from "@/lib/presupuesto-imagenes.functions";
import {
  MAXIMO_BYTES_IMAGEN,
  MAXIMO_IMAGENES_PRESUPUESTO,
  esTipoImagenPresupuesto,
} from "@/dominio/imagenes-presupuesto";

type Ambito = "tienda" | "textil";

/** Una imagen que todavía no está guardada: se sube al guardar el presupuesto. */
type Nueva = { clave: string; fichero: File; url: string };

/**
 * Las imágenes del editor de un presupuesto: las guardadas, las que se van a
 * quitar y las nuevas. Nada se escribe hasta guardar: `sincronizar(id)` quita
 * y sube, después de guardar el presupuesto y antes de sacar su PDF.
 *
 * Sin la migración de imágenes, `disponible` es false y la sección no sale.
 */
export function useImagenesPresupuesto({
  ambito,
  presupuestoId,
  abierto,
  iniciales,
}: {
  ambito: Ambito;
  presupuestoId: string | null;
  abierto: boolean;
  /** Las que trae un borrador de la IA (las subidas y las sacadas del PDF). */
  iniciales?: readonly File[];
}) {
  const listar = useServerFn(listarImagenesPresupuesto);
  const subir = useServerFn(subirImagenPresupuesto);
  const quitar = useServerFn(quitarImagenPresupuesto);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["presupuesto-imagenes", ambito, presupuestoId],
    enabled: abierto,
    queryFn: () => listar({ data: { ambito, presupuestoId } }),
  });

  const [quitadas, setQuitadas] = useState<Set<string>>(new Set());
  const [nuevas, setNuevas] = useState<Nueva[]>([]);
  const contador = useRef(0);

  // Al abrir: lo que traiga el borrador; al cerrar, se suelta todo.
  useEffect(() => {
    if (!abierto) return;
    setQuitadas(new Set());
    const lista = (iniciales ?? []).map((fichero) => ({
      clave: `n${(contador.current += 1)}`,
      fichero,
      url: URL.createObjectURL(fichero),
    }));
    setNuevas(lista);
    return () => lista.forEach((n) => URL.revokeObjectURL(n.url));
  }, [abierto, iniciales]);

  const guardadas = useMemo(
    () => (data?.imagenes ?? []).filter((i) => !quitadas.has(i.id)),
    [data, quitadas],
  );
  const total = guardadas.length + nuevas.length;

  const anadir = useCallback(
    (ficheros: FileList | File[]) => {
      const lista: Nueva[] = [];
      let hueco = MAXIMO_IMAGENES_PRESUPUESTO - total;
      for (const f of Array.from(ficheros)) {
        if (!esTipoImagenPresupuesto(f.type)) {
          toast.error(`«${f.name}» no es un JPG, un PNG ni un WEBP.`);
          continue;
        }
        if (f.size > MAXIMO_BYTES_IMAGEN) {
          toast.error(`«${f.name}» pesa más de 5 MB.`);
          continue;
        }
        if (hueco <= 0) {
          toast.error(`Como mucho, ${MAXIMO_IMAGENES_PRESUPUESTO} imágenes por presupuesto.`);
          break;
        }
        hueco -= 1;
        lista.push({
          clave: `n${(contador.current += 1)}`,
          fichero: f,
          url: URL.createObjectURL(f),
        });
      }
      if (lista.length) setNuevas((ns) => [...ns, ...lista]);
    },
    [total],
  );

  const quitarNueva = (clave: string) =>
    setNuevas((ns) => {
      const n = ns.find((x) => x.clave === clave);
      if (n) URL.revokeObjectURL(n.url);
      return ns.filter((x) => x.clave !== clave);
    });
  const quitarGuardada = (id: string) => setQuitadas((q) => new Set(q).add(id));

  /**
   * Quita las que se han quitado y sube las nuevas al presupuesto ya guardado.
   * Devuelve lo que no se ha podido hacer: el presupuesto ya está guardado y
   * eso no se deshace por una imagen.
   */
  const sincronizar = useCallback(
    async (id: string): Promise<string[]> => {
      if (!data?.disponible) return [];
      const fallos: string[] = [];
      for (const imagen of quitadas) {
        try {
          await quitar({ data: { id: imagen } });
        } catch (e) {
          fallos.push(`no se ha quitado una imagen (${(e as Error).message})`);
        }
      }
      for (const n of nuevas) {
        const fd = new FormData();
        fd.set("ambito", ambito);
        fd.set("presupuestoId", id);
        fd.set("fichero", n.fichero);
        try {
          await subir({ data: fd });
        } catch (e) {
          fallos.push(`«${n.fichero.name}»: ${(e as Error).message}`);
        }
      }
      void qc.invalidateQueries({ queryKey: ["presupuesto-imagenes", ambito] });
      return fallos;
    },
    [data?.disponible, quitadas, nuevas, ambito, quitar, subir, qc],
  );

  return {
    disponible: data?.disponible ?? false,
    cargando: isLoading,
    guardadas,
    nuevas,
    total,
    anadir,
    quitarNueva,
    quitarGuardada,
    sincronizar,
  };
}

export type EstadoImagenesPresupuesto = ReturnType<typeof useImagenesPresupuesto>;
