"""Borra TODOS los datos operativos de la base de datos, dejando solo el
esquema vacío, para arrancar con información 100% real del cliente.

Se conserva (no se toca) la configuración estructural de la empresa:
company_profile, branches, system_integrations (proveedor de correo, etc.).
Todo lo demás se vacía: usuarios, roles/permisos (se re-siembran los roles
de sistema automáticamente al terminar), clientes, ventas, devoluciones,
RH, inventario, finanzas, contabilidad e ingesta.

Tras correr este script con éxito, /api/v1/auth/setup vuelve a estar
habilitado (la tabla users queda vacía) para crear el primer administrador
real.

Uso (desde backend/, con DATABASE_URL apuntando a la base de PRODUCCIÓN):

    python -m scripts.reset_prod_data

Es interactivo a propósito: pide dos confirmaciones explícitas y nunca
corre solo. Se niega a ejecutarse contra SQLite (protección para no
borrar por accidente una base local de desarrollo).

Alternativa sin línea de comandos: el mismo borrado está disponible desde
la app en Configuración → Seguridad → Zona de peligro (solo visible para
el superusuario, pide contraseña + confirmación).
"""

import asyncio

from app.core.config import settings
from app.db.session import engine
from app.db.reset import KEEP_TABLES, tables_to_wipe, wipe_operational_data, reseed_after_wipe


def _masked_target() -> str:
    uri = settings.SQLALCHEMY_DATABASE_URI or ""
    if "@" in uri:
        return uri.split("@", 1)[1]
    return uri


async def run() -> None:
    uri = settings.SQLALCHEMY_DATABASE_URI or ""
    if uri.startswith("sqlite"):
        print("Esto apunta a SQLite (base local de desarrollo). Este script es solo")
        print("para la base de datos de PRODUCCIÓN (Postgres en Render). Abortando.")
        return

    wipe_targets = tables_to_wipe()

    print("=" * 70)
    print("RESET DE DATOS DE PRODUCCIÓN")
    print("=" * 70)
    print(f"Destino: {_masked_target()}")
    print(f"\nSe conservan ({len(KEEP_TABLES)} tablas, config. de empresa):")
    for t in sorted(KEEP_TABLES):
        print(f"  - {t}")
    print(f"\nSe BORRA TODO el contenido de estas {len(wipe_targets)} tablas:")
    for t in sorted(wipe_targets):
        print(f"  - {t}")
    print("\nEsto incluye usuarios: tras el borrado, POST /api/v1/auth/setup")
    print("vuelve a estar disponible para crear el primer administrador real.")
    print("=" * 70)

    confirm1 = input('\nEscribe exactamente "BORRAR TODO" para continuar: ')
    if confirm1 != "BORRAR TODO":
        print("Confirmación no coincide. Abortado, no se borró nada.")
        return

    host_hint = _masked_target().split("/")[0]
    confirm2 = input(f'Escribe el host de destino ("{host_hint}") para confirmar: ')
    if confirm2 != host_hint:
        print("El host no coincide. Abortado, no se borró nada.")
        return

    wiped = await wipe_operational_data(engine)
    print(f"\nListo: {len(wiped)} tablas vaciadas.")

    await reseed_after_wipe()
    print("Roles y permisos de sistema re-sembrados (Administrador, Contador, Vendedor, etc.).")
    print("\nSiguiente paso: POST /api/v1/auth/setup para crear el primer administrador real.")


if __name__ == "__main__":
    asyncio.run(run())
