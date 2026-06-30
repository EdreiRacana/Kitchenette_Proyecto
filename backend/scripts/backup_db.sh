#!/usr/bin/env bash
# Respaldo manual de la base de datos de producción.
# Uso: DATABASE_URL="postgresql://..." ./backup_db.sh
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: define DATABASE_URL antes de ejecutar este script." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/../backups"
mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="$BACKUP_DIR/sthenova_backup_${TIMESTAMP}.sql.gz"

# pg_dump no acepta el driver async (postgresql+asyncpg://) de SQLAlchemy.
PG_URL="${DATABASE_URL/postgresql+asyncpg:\/\//postgresql://}"
PG_URL="${PG_URL/postgres:\/\//postgresql://}"

pg_dump "$PG_URL" | gzip > "$OUT_FILE"

echo "Backup creado: $OUT_FILE"
