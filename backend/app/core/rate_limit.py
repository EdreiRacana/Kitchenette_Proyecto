from slowapi import Limiter
from slowapi.util import get_remote_address

# Límite en memoria por proceso: suficiente para una sola instancia de Render.
# Si en el futuro se escala a varios workers/instancias, cambiar a storage_uri
# con Redis para que el conteo se comparta entre procesos.
limiter = Limiter(key_func=get_remote_address)
