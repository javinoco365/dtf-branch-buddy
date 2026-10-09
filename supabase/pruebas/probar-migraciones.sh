#!/usr/bin/env bash
#
# Ejecuta las migraciones contra un Postgres de verdad, sobre una base vacía,
# y comprueba que el motor de facturación se comporta como debe.
#
# Existe porque aplicar migraciones a ojo contra Supabase significa descubrir
# los fallos uno a uno y en producción. Aquí salen antes. Este banco encontró
# dos que habrían llegado a la base:
#
#   - emitir_factura() fallaba en TODAS las emisiones: jsonb_array_elements(...)
#     AS l nombra el alias de la tabla, no la columna, así que r.l no existía.
#   - Al insertar un pedido con estado, el trigger de sincronización lo
#     machacaba con 'pendiente'. La sincronización de WooCommerce habría dejado
#     todos los pedidos en pendiente sin avisar.
#
# Qué NO comprueba: nada que dependa de la infraestructura real de Supabase.
# auth, storage y vault se sustituyen por lo mínimo (00_entorno_supabase.sql).
# La extensión supabase_vault no existe fuera de Supabase y se omite.
#
# El veredicto final cuenta las líneas MAL de TODAS las secciones (y las HUECO
# o ROTA del motor de facturación), las pruebas que se cortan con un error de
# SQL, los huecos en la numeración y la cadena de auditoría. Si hay cualquiera
# de esas cosas, dice cuáles y sale con código 1. Solo dice «TODO EN VERDE» y
# sale con 0 si no hay ninguna.
#
# Uso:  ./supabase/pruebas/probar-migraciones.sh
#       PG_BIN=/ruta/bin PG_DIR=/tmp/otra PG_PUERTO=55441 ./supabase/pruebas/probar-migraciones.sh
# Necesita: PostgreSQL 16 (por defecto en /usr/lib/postgresql/16/bin; si no,
# PG_BIN). Postgres no arranca como root: si se lanza como root, el script se
# vuelve a ejecutar como el usuario postgres; si no, corre como el usuario
# actual (así es en la integración continua).

set -euo pipefail

BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
DIR=${PG_DIR:-/tmp/pgcrm}
PUERTO=${PG_PUERTO:-55432}
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)

if [ "$(id -u)" -eq 0 ]; then
  # Postgres se niega a arrancar como root.
  mkdir -p "$DIR" && chown -R postgres:postgres "$DIR"
  exec su postgres -s /bin/bash -c "PG_BIN='$BIN' PG_DIR='$DIR' PG_PUERTO='$PUERTO' bash '$0'"
fi

export PATH="$BIN:$PATH"
rm -rf "$DIR/data" "$DIR/sock" "$DIR/sql"
mkdir -p "$DIR/data" "$DIR/sock" "$DIR/sql"

initdb -D "$DIR/data" -U postgres --auth=trust >/dev/null
pg_ctl -D "$DIR/data" -o "-k $DIR/sock -p $PUERTO -h ''" -l "$DIR/log" start >/dev/null
trap 'pg_ctl -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true' EXIT
sleep 2

createdb -h "$DIR/sock" -p "$PUERTO" -U postgres crm
PSQL="psql -h $DIR/sock -p $PUERTO -U postgres -d crm -v ON_ERROR_STOP=1 -q"

cp "$RAIZ/supabase/pruebas/00_entorno_supabase.sql" "$DIR/sql/"
cp "$RAIZ"/supabase/migrations/*.sql "$DIR/sql/"
sed -i 's/^CREATE EXTENSION IF NOT EXISTS supabase_vault.*$/-- (prueba) supabase_vault se simula en 00_entorno_supabase.sql/' \
  "$DIR/sql"/*_credenciales_vault.sql

echo "== Migraciones =="
for f in "$DIR"/sql/*.sql; do
  n=$(basename "$f")
  if salida=$($PSQL -f "$f" 2>&1); then
    printf "  OK    %s\n" "$n"
  else
    printf "  FALLA %s\n" "$n"
    echo "$salida" | grep -E "ERROR|LINE [0-9]" | head -8 | sed "s/^/          /"
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Las pruebas
# ---------------------------------------------------------------------------
# Cada sección ejecuta un fichero de supabase/pruebas, enseña sus líneas de
# resultado y apunta las que fallan para el veredicto final.

# Una línea que falla: contiene MAL como palabra (no «NORMAL»), o es un HUECO o
# una cadena ROTA de las que imprime el motor de facturación.
FALLO='(^|[^[:alpha:]])MAL([^[:alpha:]]|$)|^[[:space:]]*(HUECO|ROTA)[: ]'
MALES=()
CORTADAS=()

seccion() {
  local titulo=$1 fichero=$2
  local patron=${3:-'BIEN|MAL|ERROR|LINE [0-9]'}
  local salida filtrado linea codigo=0

  echo
  echo "== $titulo =="
  salida=$($PSQL -f "$RAIZ/supabase/pruebas/$fichero" 2>&1) || codigo=$?
  filtrado=$(printf '%s\n' "$salida" | grep -E "$patron" \
    | sed -E 's/^psql:[^ ]+ //; s/^(NOTICE|WARNING):  //' | sed 's/^/  /' || true)
  if [ -n "$filtrado" ]; then
    printf '%s\n' "$filtrado"
  fi

  if [ "$codigo" -ne 0 ]; then
    CORTADAS+=("$titulo ($fichero): psql salió con código $codigo")
  fi

  while IFS= read -r linea; do
    if [ -n "$linea" ]; then
      MALES+=("[$titulo] $(printf '%s' "$linea" | sed -E 's/^[[:space:]]+//')")
    fi
  done < <(printf '%s\n' "$filtrado" | grep -E "$FALLO" || true)

  return 0
}

seccion "Motor de facturación" 10_motor_facturacion.sql \
  '^---|^factura|^serie|^base|^estado|^la |^rectificativa|^filas|^produccion|BIEN|MAL|^HUECO|^ROTA|ERROR|LINE [0-9]'
seccion "Auditoría: de quién es cada escritura" 20_auditoria_autor.sql
seccion "Serie única de la sociedad" 40_serie_unica.sql
seccion "Plantillas de correo" 50_plantillas_correo.sql
seccion "Stock textil: el libro de movimientos" 60_stock_movimientos.sql
seccion "Stock textil: reservas" 70_stock_reservas.sql
seccion "Borrado de tiendas" 80_borrado_tiendas.sql
seccion "Compras textil" 90_compras_textil.sql
seccion "Conciliación bancaria" 95_conciliacion_banco.sql
seccion "Contadores de presupuestos y pedidos" 97_contadores.sql
seccion "Rutas del bucket de facturas" 98_pdf_textil_storage.sql
seccion "La sociedad no se borra" 99_empresa_no_se_borra.sql
seccion "Origen de los pedidos" A1_origen_pedidos.sql
seccion "SMTP configurable" A2_smtp_configurable.sql
seccion "Inicio de la numeracion de facturas" A3_serie_inicio.sql
seccion "Libro de caja" A4_caja.sql
seccion "Inversion de los socios" A5_inversion.sql
seccion "Clientes unicos por empresa" A7_clientes_unicos.sql
seccion "Cobros de todos los pedidos" A8_cobros.sql
seccion "Pedidos pendientes de cobro" A9_pedidos_pendientes_cobro.sql
seccion "Presupuestos de las tiendas y productos genericos" B1_presupuestos_tiendas.sql
seccion "Confirmar presupuesto: el pedido" B2_confirmar_presupuestos.sql
seccion "Tickets: factura simplificada" B3_tickets.sql
seccion "Cifras fiables: cobro web neto y coste congelado" B4_cifras_fiables.sql
seccion "Ajustes de Gerencia" B5_gerencia_ajustes.sql
seccion "Gastos con impuestos y periodicidad" B7_gastos_impuestos.sql
seccion "Gastos con o sin justificante" B9_gastos_justificante.sql
seccion "Facturas de compra de todo el negocio" C1_compras_generales.sql
seccion "Facturas recibidas: importes calculados en la base" C2_compras_recibidas.sql
seccion "Facturas recibidas: cola de revisión y duplicados" C3_compras_cola.sql
seccion "Bancos: cuentas y extractos" C4_banco_cuentas.sql
seccion "Conciliación: compras, grupos, revisar y traspasos" C5_conciliacion_motor.sql
seccion "Clave del lector de facturas en Vault" C6_clave_lector.sql
seccion "Borrar la última factura de la serie" C7_borrar_ultima_factura.sql
seccion "De dónde salen los metros de una línea" C8_metros_origen.sql
seccion "Bucket de los PDF de facturas" B8_bucket_facturas.sql
seccion "Reponer factura_comprobar_fecha" B6_reponer_comprobar_fecha.sql
seccion "Tickets y facturas con la fecha del pedido" C9_fecha_del_pedido.sql
seccion "Número de factura único por ejercicio" C10_numero_por_ejercicio.sql
seccion "Credenciales de WooCommerce en Vault" 30_credenciales_vault.sql
seccion "Políticas por operación: el mismo acceso que los FOR ALL" C11_politicas_por_operacion.sql
seccion "Auditoría en las tablas que faltaban" C12_auditoria_tablas_pendientes.sql

# ---------------------------------------------------------------------------
# Veredicto
# ---------------------------------------------------------------------------
echo
huecos=$($PSQL -tAc "SELECT count(*) FROM public.facturas_huecos_en_serie();")
rotos=$($PSQL -tAc "SELECT count(*) FROM public.auditoria_verificar();")
fallo=0

if [ "${#MALES[@]}" -gt 0 ]; then
  echo "FALLO: ${#MALES[@]} línea(s) MAL:"
  printf '  %s\n' "${MALES[@]}"
  fallo=1
fi

if [ "${#CORTADAS[@]}" -gt 0 ]; then
  echo "FALLO: ${#CORTADAS[@]} prueba(s) se cortaron con un error de SQL antes de terminar:"
  printf '  %s\n' "${CORTADAS[@]}"
  fallo=1
fi

if [ "$huecos" != "0" ]; then
  echo "FALLO: $huecos hueco(s) en la numeración de facturas."
  fallo=1
fi

if [ "$rotos" != "0" ]; then
  echo "FALLO: $rotos eslabón(es) rotos en la cadena de auditoría."
  $PSQL -c "SELECT * FROM public.auditoria_verificar() LIMIT 5;"
  fallo=1
fi

if [ "$fallo" -ne 0 ]; then
  exit 1
fi

echo "TODO EN VERDE: ninguna línea MAL, ninguna prueba cortada, sin huecos en la serie y con la cadena de auditoría intacta."
