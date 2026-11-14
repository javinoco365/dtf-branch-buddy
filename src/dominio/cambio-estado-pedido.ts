/**
 * Qué pasa fuera del CRM al cambiar el estado de un pedido, y qué se le dice
 * a quien lo cambia.
 *
 * Lógica pura: no importa nada de `routes/`, de componentes ni de Supabase.
 *
 * ## Por qué
 *
 * El estado se cambiaba con un toque en el desplegable. «Enviado» manda un
 * correo al cliente y marca el pedido como completado en la web; «Cancelado»
 * lo cancela en la web. Nada de eso tiene vuelta atrás (el correo ya está en
 * el buzón del cliente), así que esos cambios se confirman antes, diciendo
 * qué va a pasar. Los demás son internos: se hacen sin preguntar y se pueden
 * deshacer.
 *
 * Y después, el aviso dice la verdad: si el correo o la web fallaron, se dice
 * qué no salió en lugar de un «Estado actualizado» a secas.
 */

export const ESTADOS_PEDIDO = [
  "pendiente",
  "en_produccion",
  "imprimiendo",
  "listo",
  "enviado",
  "entregado",
  "cancelado",
] as const;

export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];

/** El estado que se pone en WooCommerce para cada estado del CRM. */
export const ESTADO_A_WOO: Record<EstadoPedido, string> = {
  pendiente: "on-hold",
  en_produccion: "processing",
  imprimiendo: "processing",
  listo: "processing",
  enviado: "completed",
  entregado: "completed",
  cancelado: "cancelled",
};

/** Los estados de WooCommerce que el cliente nota (le llega correo de la web). */
const WOO_CON_EFECTO = new Set(["completed", "cancelled"]);

export interface PedidoParaCambio {
  estado: string;
  /** Viene de la web y tiene número de pedido allí. */
  esDeLaWeb: boolean;
  clienteEmail: string | null;
}

export interface EfectosCambio {
  /** Hay que confirmar antes: el cambio sale del CRM. */
  confirmar: boolean;
  /** Lo que va a pasar, una línea por cosa, para el diálogo. */
  efectos: string[];
}

function esEstado(e: string): e is EstadoPedido {
  return (ESTADOS_PEDIDO as readonly string[]).includes(e);
}

/** Qué hará el cambio de estado fuera del CRM, y si hay que confirmarlo. */
export function efectosCambioEstado(pedido: PedidoParaCambio, nuevo: string): EfectosCambio {
  if (!esEstado(nuevo) || nuevo === pedido.estado) return { confirmar: false, efectos: [] };
  const efectos: string[] = [];
  let confirmar = nuevo === "enviado" || nuevo === "cancelado";

  if (nuevo === "enviado") {
    const email = pedido.clienteEmail?.trim();
    efectos.push(
      email
        ? `Se enviará un correo a ${email} avisando de que su pedido va en camino (si el aviso está activado en la tienda y no se le mandó antes).`
        : "El pedido no tiene email del cliente: no se le enviará ningún aviso.",
    );
  }

  if (pedido.esDeLaWeb) {
    const woo = ESTADO_A_WOO[nuevo];
    if (woo === "completed") {
      efectos.push(
        "Se marcará como completado en la web; WooCommerce puede mandarle además su propio correo.",
      );
    } else if (woo === "cancelled") {
      efectos.push(
        "Se marcará como cancelado en la web; WooCommerce puede mandarle además su propio correo.",
      );
    }
    if (WOO_CON_EFECTO.has(woo)) confirmar = true;
  }

  if (nuevo === "cancelado") efectos.push("El pedido dejará de contar en ventas y producción.");

  return { confirmar, efectos };
}

/** Lo que devuelve el servidor al cambiar el estado. */
export interface RespuestaCambioEstado {
  woo_synced: boolean;
  /** Si el pedido es de la web y se intentó cambiar allí. Puede faltar. */
  woo_aplica?: boolean;
  aviso:
    | { estado: "enviado"; destinatario: string }
    | { estado: "omitido"; motivo: string }
    | { estado: "fallido"; motivo: string }
    | null;
}

export interface ResumenCambio {
  /** «bien» si todo salió; «aviso» si el estado se guardó pero algo de fuera no. */
  tono: "bien" | "aviso";
  titulo: string;
  detalles: string[];
}

/** El aviso tras cambiar el estado: lo que salió y lo que no. */
export function resumenCambioEstado(
  etiquetaEstado: string,
  res: RespuestaCambioEstado,
  esDeLaWeb: boolean,
): ResumenCambio {
  const bien: string[] = [];
  const mal: string[] = [];

  if (res.aviso?.estado === "enviado") bien.push(`Correo enviado a ${res.aviso.destinatario}.`);
  else if (res.aviso?.estado === "fallido")
    mal.push(`El correo al cliente no salió: ${res.aviso.motivo}.`);
  else if (res.aviso?.estado === "omitido")
    mal.push(`No se envió correo al cliente: ${res.aviso.motivo}.`);

  const wooAplica = res.woo_aplica ?? esDeLaWeb;
  if (wooAplica) {
    if (res.woo_synced) bien.push("Actualizado también en la web.");
    else mal.push("No se pudo cambiar en la web: cámbialo allí a mano o vuelve a intentarlo.");
  }

  if (mal.length === 0) {
    return { tono: "bien", titulo: `Pedido marcado como ${etiquetaEstado}`, detalles: bien };
  }
  return {
    tono: "aviso",
    titulo: `Pedido marcado como ${etiquetaEstado}, pero no todo salió`,
    detalles: [...mal, ...bien],
  };
}

/** Lo que hace falta de un pedido para avisar antes de borrarlo. */
export interface PedidoParaBorrar {
  lineas: number;
  cobros: { automatico: boolean }[];
  conSeguimiento: boolean;
  /** Ticket o factura emitidos para el pedido («el ticket T-12»), o null. */
  documento: string | null;
  esDeLaWeb: boolean;
}

function plural(n: number, uno: string, varios: string) {
  return `${n} ${n === 1 ? uno : varios}`;
}

/**
 * Qué se lleva por delante borrar un pedido, y si se puede.
 *
 * Las líneas, el seguimiento, el registro de correos y los cobros automáticos
 * (los que trajo la web) se van con él. Los cobros hechos a mano lo impiden:
 * ese dinero entró, y la base no deja borrarlo (ON DELETE RESTRICT).
 */
export function consecuenciasBorrarPedido(p: PedidoParaBorrar): {
  consecuencias: string[];
  impedimento: string | null;
} {
  const aMano = p.cobros.filter((c) => !c.automatico).length;
  if (aMano > 0) {
    return {
      consecuencias: [],
      impedimento: `Tiene ${plural(aMano, "cobro registrado", "cobros registrados")} a mano. Bórralos antes desde los cobros del pedido.`,
    };
  }
  const consecuencias: string[] = [];
  if (p.lineas > 0) consecuencias.push(`Sus ${plural(p.lineas, "línea", "líneas")}.`);
  const auto = p.cobros.length;
  if (auto > 0) {
    consecuencias.push(`${plural(auto, "cobro automático", "cobros automáticos")} de la web.`);
  }
  if (p.conSeguimiento) consecuencias.push("El seguimiento del envío.");
  consecuencias.push("El registro de correos enviados al cliente.");
  if (p.documento) {
    consecuencias.push(`${p.documento} no se borra: se queda emitido, sin pedido al que apuntar.`);
  }
  if (p.esDeLaWeb) consecuencias.push("En la web sigue existiendo: allí no se borra.");
  return { consecuencias, impedimento: null };
}
