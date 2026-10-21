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
  recortarImagenes,
} from "@/dominio/imagenes-presupuesto";
import { reducirImagenParaSubir } from "@/lib/reducir-imagen";
import { invalidarTrasGuardar } from "@/lib/cache";

type Ambito = "tienda" | "textil";

/** Una imagen que todavía no está guardada: se sube al guardar el presupuesto. */
type Nueva = { clave: string; fichero: File; url: string };

/**
 * Las imágenes del editor de un presupuesto: las guardadas, las que se van a
 * quitar y las nuevas. Nada se escribe hasta guardar: `sincronizar(id)` quita
 * y sube, después de guardar el presupuesto y antes de sacar su PDF.
 *
 * `estado`: «cargando» mientras se pregunta al servidor, «error» si no ha
 * contestado, «no-disponible» sin la migración de imágenes y «disponible».
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

  const clave = useMemo(
    () => ["presupuesto-imagenes", ambito, presupuestoId] as const,
    [ambito, presupuestoId],
  );
  const consultar = useCallback(
    () => listar({ data: { ambito, presupuestoId } }),
    [listar, ambito, presupuestoId],
  );
  const { data, isLoading, isError, error } = useQuery({
    queryKey: clave,
    enabled: abierto,
    queryFn: consultar,
  });
  const estado: "cargando" | "error" | "no-disponible" | "disponible" = data
    ? data.disponible
      ? "disponible"
      : "no-disponible"
    : isError
      ? "error"
      : "cargando";

  const [quitadas, setQuitadas] = useState<Set<string>>(new Set());
  const [nuevas, setNuevas] = useState<Nueva[]>([]);
  const contador = useRef(0);

  // Al abrir: lo que traiga el borrador; al cerrar, se suelta todo.
  useEffect(() => {
    if (!abierto) return;
    setQuitadas(new Set());
    // Las del borrador ya vienen recortadas; por si acaso, nunca más del máximo.
    const { elegidas, fuera } = recortarImagenes([iniciales ?? []]);
    if (fuera > 0) {
      toast.warning(
        `Como mucho, ${MAXIMO_IMAGENES_PRESUPUESTO} imágenes por presupuesto: ${fuera} se quedan fuera.`,
      );
    }
    const lista = elegidas.map((fichero) => ({
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
      if (quitadas.size === 0 && nuevas.length === 0) return [];
      // Si la consulta aún no ha contestado (o ha fallado), se le pregunta ahora:
      // nunca se dan por guardadas unas imágenes sin saber si se pueden guardar.
      let info = data;
      if (!info) {
        try {
          info = await qc.fetchQuery({ queryKey: clave, queryFn: consultar });
        } catch (e) {
          return [
            `las imágenes no se han guardado: no se ha podido consultar el servidor (${(e as Error).message})`,
          ];
        }
      }
      if (!info?.disponible) {
        return nuevas.length
          ? [
              `las ${nuevas.length} imágenes no se han guardado: falta aplicar la migración 20261030100000`,
            ]
          : [];
      }
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
        // Reducida en el navegador si es muy grande: el PDF se hace en el servidor.
        fd.set("fichero", await reducirImagenParaSubir(n.fichero));
        try {
          await subir({ data: fd });
        } catch (e) {
          fallos.push(`«${n.fichero.name}»: ${(e as Error).message}`);
        }
      }
      void qc.invalidateQueries({ queryKey: ["presupuesto-imagenes", ambito] });
      void invalidarTrasGuardar(qc);
      return fallos;
    },
    [data, clave, consultar, quitadas, nuevas, ambito, quitar, subir, qc],
  );

  return {
    estado,
    disponible: estado === "disponible",
    cargando: isLoading,
    errorConsulta: isError ? ((error as Error | null)?.message ?? "error") : null,
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
