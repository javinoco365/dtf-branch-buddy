import { ArrowDown, ArrowUp } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { rellenarTexto, type ModoNombre, type SeccionFinal } from "@/dominio/plantilla-presupuesto";
import { LARGOS, MAXIMOS, MINIMOS } from "./limites";
import {
  conCabecera,
  conElemento,
  conGrupo,
  conPartes,
  deLaBase,
  useEditor,
  type Plantilla,
} from "./editor";
import { coloresHeredados } from "./aspecto";
import {
  CampoAlineacion,
  CampoColor,
  CampoInterruptor,
  CampoNumero,
  CampoTexto,
  TextoConVariables,
} from "./Campos";
import { SeccionLogo } from "./SeccionLogo";
import { PiePagina, RENGLONES_PIE } from "./PiePagina";

/**
 * Todos los campos de la plantilla, por secciones plegables: primero lo de la
 * cabecera (lo mismo que se arrastra en el diseñador, con todas sus opciones),
 * luego el cuerpo y el pie.
 */

const largo = (s: string) => s.length;

type SeccionFormulario =
  | "logo"
  | "nombre"
  | "titulo"
  | "datos"
  | "texto"
  | "cabecera"
  | "colores"
  | "partes"
  | "tabla"
  | "resumen"
  | "secciones"
  | "pie";

export function SeccionesPlantilla({
  abiertas,
  onAbiertas,
}: {
  abiertas: string[];
  onAbiertas: (v: string[]) => void;
}) {
  const { plantilla: p, ambito } = useEditor();
  const cab = p.cabecera;

  // Una pista de cada sección cerrada: lo que tiene ahora, de un vistazo.
  const no = (b: boolean) => (b ? null : "No sale");
  const pistas: Record<SeccionFormulario, string | null> = {
    logo: no(cab.logo.mostrar),
    nombre: cab.nombre.mostrar === "nunca" ? "No sale" : null,
    titulo: no(cab.titulo.mostrar),
    datos: no(cab.datos.mostrar),
    texto: cab.texto.mostrar && cab.texto.texto.trim() ? null : "No sale",
    cabecera: null,
    colores: p.colores.principal || p.colores.acento ? "Propios" : null,
    partes: null,
    tabla: null,
    resumen: null,
    secciones: null,
    pie: null,
  };

  const item = (
    valor: SeccionFormulario,
    titulo: string,
    desc: string,
    contenido: React.ReactNode,
  ) => (
    <AccordionItem key={valor} value={valor} id={`seccion-${valor}`} className="scroll-mt-4">
      <AccordionTrigger className="gap-3 py-3 hover:no-underline">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="font-medium">{titulo}</span>
            {pistas[valor] && (
              <Badge variant="outline" className="py-0 text-[10px] font-normal">
                {pistas[valor]}
              </Badge>
            )}
          </span>
          <span className="block text-xs font-normal text-muted-foreground">{desc}</span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-4 pt-1">{contenido}</AccordionContent>
    </AccordionItem>
  );

  return (
    <Accordion type="multiple" value={abiertas} onValueChange={onAbiertas} className="w-full">
      <p className="pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Cabecera
      </p>
      {item("logo", "Logo", `El ${deLaBase(ambito)} o uno propio, y su caja`, <SeccionLogo />)}
      {item(
        "nombre",
        "Nombre comercial",
        "El nombre que sale arriba, cuándo y dónde",
        <SeccionNombre />,
      )}
      {item("titulo", "Título", "«PRESUPUESTO», o lo que pongas", <SeccionTitulo />)}
      {item("datos", "Datos del presupuesto", "Número, fecha y validez", <SeccionDatos />)}
      {item(
        "texto",
        "Texto libre",
        "Un eslogan, una dirección… admite variables",
        <SeccionTextoLibre />,
      )}
      {item(
        "cabecera",
        "Altura de la cabecera y línea",
        "Dónde acaba la cabecera y empieza el cuerpo",
        <SeccionCabecera />,
      )}
      {item("colores", "Colores", "El principal y el de la línea", <SeccionColores />)}

      <p className="pb-1 pt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Cuerpo y pie
      </p>
      {item(
        "partes",
        "Emisor y cliente",
        "Las dos cajas: orden, títulos y qué datos llevan",
        <SeccionPartes />,
      )}
      {item("tabla", "Tabla de líneas", "Títulos de las columnas y cuáles salen", <SeccionTabla />)}
      {item("resumen", "Resumen", "Base imponible, IVA, TOTAL y metros", <SeccionResumen />)}
      {item(
        "secciones",
        "Secciones finales",
        "Observaciones, condiciones y aceptación: orden y textos",
        <SeccionesFinales />,
      )}
      {item("pie", "Pie de página", "Los datos fiscales y el número de página", <SeccionPie />)}
    </Accordion>
  );
}

// ---------------------------------------------------------------------------
// Cabecera
// ---------------------------------------------------------------------------

/** X, Y, tamaño y alineación de un texto de la cabecera. */
function PosicionTexto({ el }: { el: "nombre" | "titulo" | "texto" }) {
  const { plantilla, cambiar } = useEditor();
  const t = plantilla.cabecera[el];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <CampoNumero
        etiqueta="X"
        valor={t.x}
        min={MINIMOS.cabecera[el].x}
        max={MAXIMOS.cabecera[el].x}
        onChange={(x) => cambiar(conElemento(el, { x }))}
      />
      <CampoNumero
        etiqueta="Y (línea base)"
        valor={t.y}
        min={MINIMOS.cabecera[el].y}
        max={MAXIMOS.cabecera[el].y}
        onChange={(y) => cambiar(conElemento(el, { y }))}
      />
      <CampoNumero
        etiqueta="Tamaño"
        unidad="pt"
        valor={t.tamano}
        min={MINIMOS.cabecera[el].tamano}
        max={MAXIMOS.cabecera[el].tamano}
        onChange={(tamano) => cambiar(conElemento(el, { tamano }))}
      />
      <CampoAlineacion
        valor={t.alineacion}
        onChange={(alineacion) => cambiar(conElemento(el, { alineacion }))}
      />
    </div>
  );
}

const MODOS_NOMBRE: { valor: ModoNombre; texto: string }[] = [
  { valor: "auto", texto: "Solo si no hay logo" },
  { valor: "siempre", texto: "Siempre" },
  { valor: "nunca", texto: "Nunca" },
];

function SeccionNombre() {
  const { plantilla, cambiar, base, ambito } = useEditor();
  const n = plantilla.cabecera.nombre;
  const de = deLaBase(ambito);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoTexto
          etiqueta="Nombre comercial"
          valor={n.texto}
          maximo={largo(LARGOS.cabecera.nombre.texto)}
          placeholder={base.nombre ?? ""}
          onChange={(texto) => cambiar(conElemento("nombre", { texto }))}
          ayuda={
            base.nombre
              ? `Vacío: el ${de} («${base.nombre}»). Sale también en la caja del emisor.`
              : `Vacío: el ${de}.`
          }
        />
        <div className="space-y-1.5">
          <Label className="text-xs">En la cabecera</Label>
          <Select
            value={n.mostrar}
            onValueChange={(v) => cambiar(conElemento("nombre", { mostrar: v as ModoNombre }))}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODOS_NOMBRE.map((m) => (
                <SelectItem key={m.valor} value={m.valor}>
                  {m.texto}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <PosicionTexto el="nombre" />
    </>
  );
}

function SeccionTitulo() {
  const { plantilla, cambiar } = useEditor();
  const t = plantilla.cabecera.titulo;
  return (
    <>
      <CampoInterruptor
        etiqueta="Poner el título"
        valor={t.mostrar}
        onChange={(mostrar) => cambiar(conElemento("titulo", { mostrar }))}
      />
      <CampoTexto
        etiqueta="Texto"
        valor={t.texto}
        maximo={largo(LARGOS.cabecera.titulo.texto)}
        placeholder="PRESUPUESTO"
        onChange={(texto) => cambiar(conElemento("titulo", { texto }))}
      />
      <PosicionTexto el="titulo" />
    </>
  );
}

function SeccionDatos() {
  const { plantilla, cambiar } = useEditor();
  const d = plantilla.cabecera.datos;
  return (
    <>
      <CampoInterruptor
        etiqueta="Poner número, fecha y validez"
        valor={d.mostrar}
        onChange={(mostrar) => cambiar(conElemento("datos", { mostrar }))}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <CampoTexto
          etiqueta="Etiqueta del número"
          valor={d.etiquetaNumero}
          maximo={largo(LARGOS.cabecera.datos.etiquetaNumero)}
          onChange={(etiquetaNumero) => cambiar(conElemento("datos", { etiquetaNumero }))}
        />
        <CampoTexto
          etiqueta="Etiqueta de la fecha"
          valor={d.etiquetaFecha}
          maximo={largo(LARGOS.cabecera.datos.etiquetaFecha)}
          onChange={(etiquetaFecha) => cambiar(conElemento("datos", { etiquetaFecha }))}
        />
        <CampoTexto
          etiqueta="Etiqueta de la validez"
          valor={d.etiquetaValidez}
          maximo={largo(LARGOS.cabecera.datos.etiquetaValidez)}
          onChange={(etiquetaValidez) => cambiar(conElemento("datos", { etiquetaValidez }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CampoNumero
          etiqueta="X (etiquetas)"
          valor={d.x}
          min={MINIMOS.cabecera.datos.x}
          max={MAXIMOS.cabecera.datos.x}
          onChange={(x) => cambiar(conElemento("datos", { x }))}
        />
        <CampoNumero
          etiqueta="Y (primera fila)"
          valor={d.y}
          min={MINIMOS.cabecera.datos.y}
          max={MAXIMOS.cabecera.datos.y}
          onChange={(y) => cambiar(conElemento("datos", { y }))}
        />
        <CampoNumero
          etiqueta="Ancho"
          valor={d.ancho}
          min={MINIMOS.cabecera.datos.ancho}
          max={MAXIMOS.cabecera.datos.ancho}
          onChange={(ancho) => cambiar(conElemento("datos", { ancho }))}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Las etiquetas empiezan en X y las cifras acaban en X + ancho, alineadas a la derecha. Con
        una etiqueta vacía, esa fila no sale.
      </p>
    </>
  );
}

function SeccionTextoLibre() {
  const { plantilla, cambiar } = useEditor();
  const t = plantilla.cabecera.texto;
  return (
    <>
      <CampoInterruptor
        etiqueta="Poner un texto libre en la cabecera"
        valor={t.mostrar}
        onChange={(mostrar) => cambiar(conElemento("texto", { mostrar }))}
      />
      <TextoConVariables
        etiqueta="Texto"
        valor={t.texto}
        maximo={largo(LARGOS.cabecera.texto.texto)}
        filas={3}
        placeholder="Por ejemplo: {web} · {telefono}"
        ayuda="Cada línea, un renglón."
        onChange={(texto) => cambiar(conElemento("texto", { texto }))}
      />
      <PosicionTexto el="texto" />
    </>
  );
}

function SeccionCabecera() {
  const { plantilla, cambiar } = useEditor();
  const c = plantilla.cabecera;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CampoNumero
          etiqueta="La línea va a"
          valor={c.alto}
          min={MINIMOS.cabecera.alto}
          max={MAXIMOS.cabecera.alto}
          onChange={(alto) => cambiar(conCabecera({ alto }))}
        />
      </div>
      <CampoInterruptor
        etiqueta="Dibujar la línea bajo la cabecera"
        ayuda="Sin línea, el cuerpo empieza igual a esa altura."
        valor={c.linea}
        onChange={(linea) => cambiar(conCabecera({ linea }))}
      />
      <p className="text-xs text-muted-foreground">
        Medido desde el borde de arriba del papel. El cuerpo empieza 7 mm por debajo de la línea; si
        algo de la cabecera baja más, el cuerpo empieza debajo de ello, así que nunca se pisan.
      </p>
    </>
  );
}

function SeccionColores() {
  const { plantilla, cambiar, base, ambito } = useEditor();
  const c = plantilla.colores;
  const heredado = coloresHeredados(plantilla, base.color);
  return (
    <>
      <CampoColor
        etiqueta="Color principal"
        valor={c.principal}
        heredado={heredado.principal}
        nombreHeredado={
          heredado.principalDeLaBase ? `el ${deLaBase(ambito)}` : "el azul de la casa"
        }
        ayuda={`El nombre, el título, los rótulos, la cabecera de la tabla y el TOTAL. Si es muy claro, lo que va escrito encima sale en oscuro para que se lea. Vacío: el ${deLaBase(ambito)}, si el blanco se lee bien encima; si no, el azul de la casa.`}
        onChange={(principal) => cambiar(conGrupo("colores", { principal }))}
      />
      <CampoColor
        etiqueta="Color de la línea"
        valor={c.acento}
        heredado={heredado.acento}
        nombreHeredado={heredado.acentoEsPrincipal ? "el principal" : "el azul cielo de la casa"}
        ayuda="La línea bajo la cabecera."
        onChange={(acento) => cambiar(conGrupo("colores", { acento }))}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Cuerpo
// ---------------------------------------------------------------------------

function SeccionPartes() {
  const { plantilla, cambiar } = useEditor();
  const { emisorPrimero, emisor, cliente } = plantilla.partes;

  const camposEmisor: [keyof typeof emisor, string][] = [
    ["razonSocial", "Razón social"],
    ["cif", "CIF"],
    ["direccion", "Dirección"],
    ["email", "Correo"],
    ["telefono", "Teléfono"],
    ["web", "Web"],
  ];
  const camposCliente: [keyof typeof cliente, string][] = [
    ["empresa", "Empresa"],
    ["nif", "NIF / CIF"],
    ["direccion", "Dirección"],
    ["email", "Correo"],
    ["telefono", "Teléfono"],
  ];

  return (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs">Orden de las cajas</Label>
        <Select
          value={emisorPrimero ? "emisor" : "cliente"}
          onValueChange={(v) => cambiar(conPartes({ emisorPrimero: v === "emisor" }))}
        >
          <SelectTrigger className="h-8 sm:w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="emisor">Emisor a la izquierda, cliente a la derecha</SelectItem>
            <SelectItem value="cliente">Cliente a la izquierda, emisor a la derecha</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-xs font-medium text-muted-foreground">Emisor</legend>
          <CampoInterruptor
            etiqueta="Poner la caja del emisor"
            valor={emisor.mostrar}
            onChange={(mostrar) => cambiar(conPartes({ emisor: { mostrar } }))}
          />
          <CampoTexto
            etiqueta="Título de la caja"
            valor={emisor.titulo}
            maximo={largo(LARGOS.partes.emisor.titulo)}
            disabled={!emisor.mostrar}
            onChange={(titulo) => cambiar(conPartes({ emisor: { titulo } }))}
          />
          <div className="grid grid-cols-2 gap-2.5">
            {camposEmisor.map(([k, texto]) => (
              <CampoInterruptor
                key={k}
                etiqueta={texto}
                valor={emisor[k] as boolean}
                disabled={!emisor.mostrar}
                onChange={(v) =>
                  cambiar(conPartes({ emisor: { [k]: v } as Partial<typeof emisor> }))
                }
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-xs font-medium text-muted-foreground">Cliente</legend>
          <CampoInterruptor
            etiqueta="Poner la caja del cliente"
            valor={cliente.mostrar}
            onChange={(mostrar) => cambiar(conPartes({ cliente: { mostrar } }))}
          />
          <CampoTexto
            etiqueta="Título de la caja"
            valor={cliente.titulo}
            maximo={largo(LARGOS.partes.cliente.titulo)}
            disabled={!cliente.mostrar}
            onChange={(titulo) => cambiar(conPartes({ cliente: { titulo } }))}
          />
          <div className="grid grid-cols-2 gap-2.5">
            {camposCliente.map(([k, texto]) => (
              <CampoInterruptor
                key={k}
                etiqueta={texto}
                valor={cliente[k] as boolean}
                disabled={!cliente.mostrar}
                onChange={(v) =>
                  cambiar(conPartes({ cliente: { [k]: v } as Partial<typeof cliente> }))
                }
              />
            ))}
          </div>
        </fieldset>
      </div>
      <p className="text-xs text-muted-foreground">
        El nombre encabeza siempre cada caja. Un dato que el presupuesto no tenga no sale aunque
        esté marcado.
      </p>
    </>
  );
}

function SeccionTabla() {
  const { plantilla, cambiar } = useEditor();
  const t = plantilla.tabla;
  const tx = (k: "descripcion" | "cantidad" | "precio" | "iva" | "importe") => (v: string) =>
    cambiar(conGrupo("tabla", { [k]: v } as Partial<Plantilla["tabla"]>));
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoTexto
          etiqueta="Columna de la descripción"
          valor={t.descripcion}
          maximo={largo(LARGOS.tabla.descripcion)}
          onChange={tx("descripcion")}
        />
        <CampoTexto
          etiqueta="Columna del importe"
          valor={t.importe}
          maximo={largo(LARGOS.tabla.importe)}
          onChange={tx("importe")}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["mostrarCantidad", "cantidad", "Cantidad"],
            ["mostrarPrecio", "precio", "Precio unitario"],
            ["mostrarIva", "iva", "IVA"],
          ] as const
        ).map(([interruptor, k, nombre]) => (
          <div key={k} className="space-y-2 rounded-lg border p-3">
            <CampoInterruptor
              etiqueta={`Columna ${nombre}`}
              valor={t[interruptor]}
              onChange={(v) =>
                cambiar(conGrupo("tabla", { [interruptor]: v } as Partial<Plantilla["tabla"]>))
              }
            />
            <CampoTexto
              etiqueta="Título"
              valor={t[k]}
              maximo={largo(LARGOS.tabla[k])}
              disabled={!t[interruptor]}
              onChange={tx(k)}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        La descripción y el importe salen siempre. Los importes de las líneas van sin IVA.
      </p>
    </>
  );
}

function SeccionResumen() {
  const { plantilla, cambiar } = useEditor();
  const r = plantilla.resumen;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <CampoTexto
          etiqueta="Base imponible"
          valor={r.base}
          maximo={largo(LARGOS.resumen.base)}
          onChange={(base) => cambiar(conGrupo("resumen", { base }))}
        />
        <CampoTexto
          etiqueta="IVA"
          valor={r.iva}
          maximo={largo(LARGOS.resumen.iva)}
          ayuda={`Va delante del tipo: «${r.iva || "IVA"} 21 %».`}
          onChange={(iva) => cambiar(conGrupo("resumen", { iva }))}
        />
        <CampoTexto
          etiqueta="Total"
          valor={r.total}
          maximo={largo(LARGOS.resumen.total)}
          onChange={(total) => cambiar(conGrupo("resumen", { total }))}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
        <CampoInterruptor
          etiqueta="Poner los metros totales"
          ayuda="Solo salen si el presupuesto tiene líneas por metros."
          valor={r.mostrarMetros}
          onChange={(mostrarMetros) => cambiar(conGrupo("resumen", { mostrarMetros }))}
        />
        <CampoTexto
          etiqueta="Rótulo de los metros"
          valor={r.metros}
          maximo={largo(LARGOS.resumen.metros)}
          disabled={!r.mostrarMetros}
          onChange={(metros) => cambiar(conGrupo("resumen", { metros }))}
        />
      </div>
    </>
  );
}

const NOMBRE_SECCION: Record<SeccionFinal, string> = {
  observaciones: "Observaciones",
  condiciones: "Condiciones",
  aceptacion: "Aceptación del cliente",
};

function SeccionesFinales() {
  const { plantilla, cambiar } = useEditor();
  const orden = plantilla.orden;

  const mover = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= orden.length) return;
    const nuevo = [...orden];
    [nuevo[i], nuevo[j]] = [nuevo[j], nuevo[i]];
    cambiar((p: Plantilla) => ({ ...p, orden: nuevo }));
  };

  return (
    <>
      <p className="text-xs text-muted-foreground">
        Van después del resumen, en este orden. Usa las flechas para cambiarlo.
      </p>
      <ol className="space-y-3">
        {orden.map((s, i) => {
          const mostrar = plantilla[s].mostrar;
          return (
            <li
              key={s}
              className={cn("space-y-3 rounded-lg border p-3", !mostrar && "bg-muted/30")}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {NOMBRE_SECCION[s]}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={i === 0}
                  aria-label={`Subir ${NOMBRE_SECCION[s]}`}
                  title="Subir"
                  onClick={() => mover(i, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={i === orden.length - 1}
                  aria-label={`Bajar ${NOMBRE_SECCION[s]}`}
                  title="Bajar"
                  onClick={() => mover(i, 1)}
                >
                  <ArrowDown />
                </Button>
              </div>
              <CampoInterruptor
                etiqueta="Sale en el PDF"
                valor={mostrar}
                onChange={(v) => cambiar(conGrupo(s, { mostrar: v }))}
              />
              {s === "observaciones" && <CamposObservaciones />}
              {s === "condiciones" && <CamposCondiciones />}
              {s === "aceptacion" && <CamposAceptacion />}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function CamposObservaciones() {
  const { plantilla, cambiar } = useEditor();
  const o = plantilla.observaciones;
  return (
    <CampoTexto
      etiqueta="Título"
      valor={o.titulo}
      maximo={largo(LARGOS.observaciones.titulo)}
      disabled={!o.mostrar}
      ayuda="El texto es el de las observaciones de cada presupuesto. Si no tiene, la sección no sale."
      onChange={(titulo) => cambiar(conGrupo("observaciones", { titulo }))}
    />
  );
}

function CamposCondiciones() {
  const { plantilla, cambiar } = useEditor();
  const c = plantilla.condiciones;
  return (
    <>
      <CampoTexto
        etiqueta="Título"
        valor={c.titulo}
        maximo={largo(LARGOS.condiciones.titulo)}
        disabled={!c.mostrar}
        onChange={(titulo) => cambiar(conGrupo("condiciones", { titulo }))}
      />
      <TextoConVariables
        etiqueta="Condiciones"
        valor={c.texto}
        maximo={largo(LARGOS.condiciones.texto)}
        filas={5}
        disabled={!c.mostrar}
        ayuda="Una condición por línea."
        onChange={(texto) => cambiar(conGrupo("condiciones", { texto }))}
      />
    </>
  );
}

function CamposAceptacion() {
  const { plantilla, cambiar } = useEditor();
  const a = plantilla.aceptacion;
  return (
    <>
      <CampoTexto
        etiqueta="Título"
        valor={a.titulo}
        maximo={largo(LARGOS.aceptacion.titulo)}
        disabled={!a.mostrar}
        onChange={(titulo) => cambiar(conGrupo("aceptacion", { titulo }))}
      />
      <TextoConVariables
        etiqueta="Texto"
        valor={a.texto}
        maximo={largo(LARGOS.aceptacion.texto)}
        filas={2}
        disabled={!a.mostrar}
        onChange={(texto) => cambiar(conGrupo("aceptacion", { texto }))}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoTexto
          etiqueta="Rótulo de la fecha"
          ayuda="Vacío: sin línea para la fecha."
          valor={a.etiquetaFecha}
          maximo={largo(LARGOS.aceptacion.etiquetaFecha)}
          disabled={!a.mostrar}
          onChange={(etiquetaFecha) => cambiar(conGrupo("aceptacion", { etiquetaFecha }))}
        />
        <CampoTexto
          etiqueta="Rótulo de la firma"
          ayuda="Vacío: sin línea para la firma."
          valor={a.etiquetaFirma}
          maximo={largo(LARGOS.aceptacion.etiquetaFirma)}
          disabled={!a.mostrar}
          onChange={(etiquetaFirma) => cambiar(conGrupo("aceptacion", { etiquetaFirma }))}
        />
      </div>
    </>
  );
}

function SeccionPie() {
  const { plantilla, cambiar, valores } = useEditor();
  const pie = plantilla.pie;
  const lineas = pie.texto.split(/\r?\n/).filter((l) => l.trim() !== "").length;
  const rellenas = rellenarTexto(pie.texto, valores).length;
  return (
    <>
      <TextoConVariables
        etiqueta="Texto del pie"
        valor={pie.texto}
        maximo={largo(LARGOS.pie.texto)}
        filas={3}
        placeholder="{razon_social} · CIF {cif} · {direccion}"
        ayuda={`Los datos fiscales de la sociedad, en cada página. Hasta ${RENGLONES_PIE} renglones; los largos se parten solos y, si no caben, la letra se hace más pequeña.`}
        onChange={(texto) => cambiar(conGrupo("pie", { texto }))}
      />
      {Math.max(lineas, rellenas) > RENGLONES_PIE && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Hay más de {RENGLONES_PIE} líneas: la letra del pie se hará más pequeña y, si aun así no
          caben, el pie subirá y le quitará sitio al cuerpo.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CampoAlineacion
          valor={pie.alineacion}
          onChange={(alineacion) => cambiar(conGrupo("pie", { alineacion }))}
        />
        <CampoNumero
          etiqueta="Tamaño"
          unidad="pt"
          valor={pie.tamano}
          min={MINIMOS.pie.tamano}
          max={MAXIMOS.pie.tamano}
          onChange={(tamano) => cambiar(conGrupo("pie", { tamano }))}
        />
      </div>
      <CampoInterruptor
        etiqueta="Número de página («Página 1 de 2»), en el lado contrario al texto"
        valor={pie.paginas}
        onChange={(paginas) => cambiar(conGrupo("pie", { paginas }))}
      />
      <PiePagina />
    </>
  );
}
