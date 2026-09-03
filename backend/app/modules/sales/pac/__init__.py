"""PAC (Proveedor Autorizado de Certificación) wrappers.

Cada PAC tiene su propia API pero exponemos una interfaz uniforme
`PACClient` que el resto del ERP consume — asi podemos alternar entre
Sufactura, Finkok u otro sin tocar el flujo de negocio.

Actualmente implementado:
  - SufacturaPAC (backend/app/modules/sales/pac/sufactura.py)
"""
from .sufactura import SufacturaPAC, PACResult, PACError

__all__ = ["SufacturaPAC", "PACResult", "PACError"]
