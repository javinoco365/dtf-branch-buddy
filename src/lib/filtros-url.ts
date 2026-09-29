import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  escribirFecha,
  escribirFiltros,
  esPeriodo,
  hayFiltros,
  leerFecha,
  leerFiltros,
  quitarFiltros,
  type Filtros,
  type Periodo,
} from "@/dominio/filtros";

/** `{ bajo: false }` da `boolean`, no `false`: el filtro podrá valer las dos cosas. */
type Ensanchar<T> = {
  [K in keyof T]: T[K] extends boolean
    ? boolean
    : T[K] extends number
      ? number
      : T[K] extends string
        ? string
        : T[K];
};

/**
 * Los filtros de una pantalla, guardados en la dirección.
 *
 * Devuelve los valores (con los por defecto donde la dirección no dice nada),
 * `cambiar` para modificar algunos y `quitar` para volver a los por defecto.
 * Escribe con `replace`: cambiar un filtro no llena el historial del
 * navegador, así que «Atrás» vuelve a la pantalla anterior y no al filtro
 * anterior.
 *
 * `porDefecto` puede construirse en cada render (depender de la tienda, por
 * ejemplo): se compara por contenido.
 */
export function useFiltrosUrl<P extends Filtros>(valoresPorDefecto: P) {
  type T = Ensanchar<P> & Filtros;
  const porDefecto = valoresPorDefecto as unknown as T;
  const busqueda = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();

  const clave = JSON.stringify(porDefecto);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const defecto = useMemo(() => porDefecto, [clave]);

  const valores = useMemo(() => leerFiltros(busqueda, defecto), [busqueda, defecto]);

  const escribir = useCallback(
    (siguiente: (prev: Record<string, unknown>) => Record<string, unknown>) => {
      void navigate({
        to: ".",
        search: siguiente as never,
        replace: true,
      });
    },
    [navigate],
  );

  const cambiar = useCallback(
    (cambios: Partial<T>) => escribir((prev) => escribirFiltros(prev, cambios, defecto)),
    [escribir, defecto],
  );

  const quitar = useCallback(
    (conservar: (keyof T)[] = []) =>
      escribir((prev) => {
        const limpio = quitarFiltros(prev, defecto);
        for (const k of conservar) {
          if (prev[k as string] !== undefined) limpio[k as string] = prev[k as string];
        }
        return limpio;
      }),
    [escribir, defecto],
  );

  const hay = useCallback(
    (ignorar: (keyof T)[] = []) => hayFiltros(valores, defecto, ignorar as string[]),
    [valores, defecto],
  );

  return { valores, cambiar, quitar, hay };
}

/**
 * Un cuadro de búsqueda que escribe en la dirección sin hacerlo en cada tecla.
 *
 * El texto se ve al instante (estado local) y se lleva a la dirección cuando
 * se deja de escribir. Si la dirección cambia por otro lado —«Quitar filtros»,
 * volver atrás—, el cuadro se pone al día.
 */
export function useTextoDiferido(
  valor: string,
  alCambiar: (texto: string) => void,
  retardo = 300,
): [string, (texto: string) => void] {
  const [texto, setTexto] = useState(valor);
  const ultimoEnviado = useRef(valor);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (valor !== ultimoEnviado.current) {
      ultimoEnviado.current = valor;
      setTexto(valor);
    }
  }, [valor]);

  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  const escribir = useCallback(
    (nuevo: string) => {
      setTexto(nuevo);
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => {
        ultimoEnviado.current = nuevo;
        alCambiar(nuevo);
      }, retardo);
    },
    [alCambiar, retardo],
  );

  return [texto, escribir];
}

/**
 * El periodo de una pantalla (mes o semana) y su día de referencia, en la
 * dirección. Sin nada en la dirección, el mes actual.
 */
export function usePeriodoUrl() {
  const { valores, cambiar } = useFiltrosUrl({ periodo: "mes", fecha: "" });
  const periodo: Periodo = esPeriodo(valores.periodo) ? valores.periodo : "mes";
  const ref = leerFecha(valores.fecha);
  const setPeriodo = (p: Periodo) => cambiar({ periodo: p, fecha: escribirFecha(ref, p) });
  const setRef = (d: Date | ((actual: Date) => Date)) =>
    cambiar({ fecha: escribirFecha(typeof d === "function" ? d(ref) : d, periodo) });
  return { periodo, ref, setPeriodo, setRef };
}
