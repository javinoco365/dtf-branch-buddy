import { renderizarPlantilla, type Variables } from "@/dominio/plantillas";

/**
 * Las variables que se pueden usar en las plantillas, con su descripción.
 *
 * Esta lista es la fuente de verdad de la pantalla y del envío: si una
 * plantilla usa algo que no está aquí, es una errata y hay que avisar antes de
 * guardar, no después de mandar el correo.
 */
export const VARIABLES_PEDIDO_ENVIADO: { clave: string; descripcion: string }[] = [
  { clave: "cliente_nombre", descripcion: "Nombre del cliente" },
  { clave: "pedido_numero", descripcion: "Número del pedido" },
  { clave: "pedido_total", descripcion: "Total del pedido, en euros" },
  { clave: "pedido_metros", descripcion: "Metros del pedido" },
  { clave: "tienda_nombre", descripcion: "Nombre comercial de la tienda" },
  { clave: "empresa_nombre", descripcion: "Razón social de la sociedad" },
  { clave: "transportista", descripcion: "Transportista, si está anotado" },
  { clave: "codigo_seguimiento", descripcion: "Número de seguimiento" },
  { clave: "seguimiento_url", descripcion: "Enlace de seguimiento" },
];

/** Valores de muestra, solo para la vista previa de la pantalla. */
export const EJEMPLO_PEDIDO_ENVIADO: Variables = {
  cliente_nombre: "Martí & Hijos S.L.",
  pedido_numero: "MAN-20260903-4821",
  pedido_total: "63,53 €",
  pedido_metros: "3,5",
  tienda_nombre: "DTF Culture",
  empresa_nombre: "RONOCA DESARROLLOS S.L.",
  transportista: "SEUR",
  codigo_seguimiento: "1234567890",
  seguimiento_url: "https://seur.com/seguimiento/1234567890",
};

/** Las claves conocidas, como objeto, para poder pasarlas al renderizador. */
export function clavesConocidas(): Variables {
  return Object.fromEntries(VARIABLES_PEDIDO_ENVIADO.map((v) => [v.clave, ""]));
}

/**
 * Comprueba una plantilla contra la lista de variables válidas.
 *
 * Devuelve las erratas encontradas. Se usa para no dejar guardar una plantilla
 * con una variable que no existe: si se cuela, el cliente recibe un correo con
 * `{{clietne_nombre}}` escrito tal cual.
 */
export function erratasEnPlantilla(...textos: string[]): string[] {
  const conocidas = clavesConocidas();
  const erratas = new Set<string>();
  for (const t of textos) {
    for (const d of renderizarPlantilla(t, conocidas).desconocidas) erratas.add(d);
  }
  return [...erratas];
}

/** El texto de la plantilla con los valores de muestra puestos. */
export function vistaPrevia(texto: string): string {
  return renderizarPlantilla(texto, EJEMPLO_PEDIDO_ENVIADO).texto;
}
