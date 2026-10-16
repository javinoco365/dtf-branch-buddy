/**
 * Lo que comparten las piezas del editor de la plantilla del PDF de
 * presupuestos: el borrador que se edita, cómo se cambia una parte sin tocar
 * el resto y el contexto con el que cada sección lo lee.
 *
 * Aquí no se calcula nada del presupuesto: las cifras y la maquetación son del
 * dominio y del generador del PDF. Esto solo mueve la plantilla de un sitio a
 * otro.
 */

import { createContext, useContext } from "react";
import {
  normalizarPlantilla,
  type PlantillaPresupuesto,
  type ValoresPlantilla,
} from "@/dominio/plantilla-presupuesto";
import { valoresPresupuesto, type PresupuestoPDFData } from "@/lib/pdf-presupuesto";

export type Plantilla = PlantillaPresupuesto;

/** Lo que se está editando de un ámbito: la plantilla y su logo propio (null: el de la tienda o la marca). */
export type Borrador = { plantilla: Plantilla; logo_url: string | null };

/** Los elementos que se colocan libres en la cabecera. */
export type ElementoCabecera = "logo" | "nombre" | "titulo" | "datos" | "texto";
/** Lo que se puede elegir en el diseñador: un elemento o la línea de la cabecera. */
export type Seleccion = ElementoCabecera | "linea";

export const ELEMENTOS: ElementoCabecera[] = ["logo", "nombre", "titulo", "datos", "texto"];

export const NOMBRE_ELEMENTO: Record<Seleccion, string> = {
  logo: "Logo",
  nombre: "Nombre comercial",
  titulo: "Título",
  datos: "Datos del presupuesto",
  texto: "Texto libre",
  linea: "Línea de la cabecera",
};

/** La sección del formulario (acordeón) donde está cada cosa del diseñador. */
export const SECCION_DE: Record<Seleccion, string> = {
  logo: "logo",
  nombre: "nombre",
  titulo: "titulo",
  datos: "datos",
  texto: "texto",
  linea: "cabecera",
};

/** Un cambio de la plantilla: recibe la de ahora y devuelve la nueva. */
export type Cambio = (p: Plantilla) => Plantilla;

type Grupo =
  "colores" | "tabla" | "resumen" | "observaciones" | "condiciones" | "aceptacion" | "pie";

/** Cambia unos campos de un grupo (`colores`, `tabla`, `pie`…). */
export const conGrupo =
  <K extends Grupo>(k: K, parcial: Partial<Plantilla[K]>): Cambio =>
  (p) => ({ ...p, [k]: { ...p[k], ...parcial } });

/** Cambia unos campos de un elemento de la cabecera. */
export const conElemento =
  <K extends ElementoCabecera>(k: K, parcial: Partial<Plantilla["cabecera"][K]>): Cambio =>
  (p) => ({ ...p, cabecera: { ...p.cabecera, [k]: { ...p.cabecera[k], ...parcial } } });

/** Cambia el alto o la línea de la cabecera. */
export const conCabecera =
  (parcial: Partial<Pick<Plantilla["cabecera"], "alto" | "linea">>): Cambio =>
  (p) => ({ ...p, cabecera: { ...p.cabecera, ...parcial } });

/** Cambia unos campos del emisor o del cliente, o el orden de los dos. */
export const conPartes =
  (
    parcial: Partial<Pick<Plantilla["partes"], "emisorPrimero">> & {
      emisor?: Partial<Plantilla["partes"]["emisor"]>;
      cliente?: Partial<Plantilla["partes"]["cliente"]>;
    },
  ): Cambio =>
  (p) => ({
    ...p,
    partes: {
      ...p.partes,
      ...(parcial.emisorPrimero === undefined ? {} : { emisorPrimero: parcial.emisorPrimero }),
      emisor: { ...p.partes.emisor, ...parcial.emisor },
      cliente: { ...p.partes.cliente, ...parcial.cliente },
    },
  });

/**
 * Una huella del borrador para saber si hay cambios sin guardar: lo mismo que
 * se guardaría (la plantilla normalizada y el logo, o null).
 */
export function firmaBorrador(b: Borrador): string {
  return JSON.stringify({
    plantilla: normalizarPlantilla(b.plantilla),
    logo_url: b.logo_url?.trim() || null,
  });
}

/**
 * Los valores de las variables ({numero}, {razon_social}…) con los datos de la
 * vista previa, para enseñar en el diseñador cómo queda un texto: los mismos
 * que pone el PDF (`valoresPresupuesto`). Sin datos todavía, solo el nombre;
 * lo demás sale vacío y `rellenarTexto` quita ese trozo.
 */
export function valoresDeVista(
  datos: PresupuestoPDFData | null | undefined,
  nombreComercial: string,
): ValoresPlantilla {
  return datos ? valoresPresupuesto(datos, nombreComercial) : { nombre_comercial: nombreComercial };
}

/** Lo que cada sección del editor necesita leer y poder cambiar. */
export type ContextoEditor = {
  plantilla: Plantilla;
  cambiar: (c: Cambio) => void;
  /** El logo propio de la plantilla; null: el de la tienda o el de la marca. */
  logoPropio: string | null;
  fijarLogoPropio: (url: string | null) => void;
  /** «tienda:<id>» o «textil». */
  clave: string;
  /** Si es una tienda o el textil: cambia los textos («de la tienda», «de la marca»). */
  ambito: "tienda" | "textil";
  /** Lo de la tienda o la marca, que sale si la plantilla no lo cambia. */
  base: { nombre: string | null; logo_url: string | null; color: string | null };
  /** Lo que de verdad sale en el PDF (`resolverIdentidad`). */
  identidad: { nombre_comercial: string; logo_url: string | null; color: string | null };
  /** Los valores de las variables con el presupuesto de la vista previa. */
  valores: ValoresPlantilla;
  /**
   * Si se puede guardar: la tabla de plantillas existe y el usuario es
   * administrador. Sin eso se puede probar la plantilla en la vista previa,
   * pero no guardarla ni subir un logo.
   */
  puedeGuardar: boolean;
};

export const EditorContexto = createContext<ContextoEditor | null>(null);

export function useEditor(): ContextoEditor {
  const c = useContext(EditorContexto);
  if (!c) throw new Error("useEditor fuera del editor de plantillas");
  return c;
}

/** «de la tienda» o «de la marca». */
export const deLaBase = (ambito: "tienda" | "textil") =>
  ambito === "tienda" ? "de la tienda" : "de la marca";
