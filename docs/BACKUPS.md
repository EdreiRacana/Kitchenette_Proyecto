# Estrategia de respaldo de base de datos — Sthenova ERP

Aplica al entorno de producción, donde la base de datos es PostgreSQL
gestionado por Render (`DATABASE_URL` apunta a un servicio "PostgreSQL" de
Render). En desarrollo local se usa SQLite (`backend/sthenova.db`), que no
requiere esta estrategia.

## 1. Respaldos automáticos de Render (primera línea de defensa)

Los planes pagos de PostgreSQL en Render generan automáticamente:
- Un respaldo diario, retenido según el plan contratado (revisar en el
  dashboard de Render: Database → Backups).
- "Point-in-time recovery" (PITR) en los planes que lo incluyen, que permite
  restaurar a cualquier minuto dentro de la ventana de retención, no solo al
  snapshot diario.

**Acción requerida antes de operar con datos reales**: entrar al dashboard de
Render, confirmar el plan contratado y la ventana de retención de backups, y
subir de plan si la retención (p. ej. 1-2 días en planes básicos) es
insuficiente para el negocio. Esto es responsabilidad de configuración/pago,
no de código.

## 2. Respaldo manual bajo demanda (`pg_dump`)

Para tener una copia adicional fuera de Render (por ejemplo, antes de una
migración riesgosa o como respaldo independiente del proveedor), se incluye
el script `backend/scripts/backup_db.sh`:

```bash
# Desde la máquina con acceso a DATABASE_URL de producción:
DATABASE_URL="postgresql://usuario:password@host:5432/dbname" \
  backend/scripts/backup_db.sh
```

Esto genera un archivo `sthenova_backup_YYYYMMDD_HHMMSS.sql.gz` comprimido en
el directorio `backend/backups/` (excluido de git vía `.gitignore`). Ese
archivo debe subirse a un almacenamiento externo (S3, Google Drive, Supabase
Storage) y no dejarse solo en el disco local del operador.

## 3. Restauración

```bash
gunzip -c sthenova_backup_20260101_030000.sql.gz | \
  psql "postgresql://usuario:password@host:5432/dbname"
```

**Recomendación**: probar la restauración en una base de datos de prueba
(staging) al menos una vez antes de necesitarla en una emergencia real, para
confirmar que el flujo funciona con la versión actual del esquema.

## 4. Calendario recomendado

| Frecuencia | Acción | Responsable |
|---|---|---|
| Diaria (automática) | Backup de Render | Render (plan pago) |
| Semanal | `backup_db.sh` manual + subir a almacenamiento externo | Operador/Admin |
| Antes de cada migración de esquema (`alembic upgrade`) | `backup_db.sh` manual | Quien ejecuta el deploy |
| Trimestral | Prueba de restauración en staging | Admin del sistema |

## 5. Qué falta (requiere decisión de negocio, no de código)

- Elegir y contratar el almacenamiento externo para los respaldos manuales
  (S3, Backblaze, etc.) — tiene costo recurrente.
- Definir el plan de Render con la retención de PITR adecuada al apetito de
  riesgo del negocio — tiene costo recurrente.
- Asignar a una persona responsable de ejecutar/verificar el calendario
  anterior.
