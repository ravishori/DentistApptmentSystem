#!/usr/bin/env bash
# =============================================================================
# DentalEase — Database setup script
# Creates the database if it doesn't exist, then runs all SQL files in order.
#
# Usage:
#   bash scripts/setup-db.sh [--reset]
#
# --reset  drops and recreates the database (DESTRUCTIVE — dev only)
# =============================================================================

set -euo pipefail

# ── Config (override via environment variables) ───────────────────────────────
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-dentalease_db}"
DB_USER="${DB_USER:-postgres}"
DB_PASS="${DB_PASS:?set DB_PASS (see .env.example)}"
RESET="${1:-}"

export PGPASSWORD="$DB_PASS"
PSQL="psql -h $DB_HOST -p $DB_PORT -U $DB_USER"

echo "============================================"
echo " DentalEase DB Setup"
echo " Host: $DB_HOST:$DB_PORT"
echo " DB:   $DB_NAME"
echo " User: $DB_USER"
echo "============================================"

# ── Optionally drop and recreate ─────────────────────────────────────────────
if [[ "$RESET" == "--reset" ]]; then
    echo ""
    echo "⚠️  WARNING: --reset will DROP the database '$DB_NAME'."
    read -p "   Type 'yes' to continue: " CONFIRM
    if [[ "$CONFIRM" != "yes" ]]; then
        echo "Aborted."
        exit 1
    fi
    echo "Dropping database..."
    $PSQL -d postgres -c "DROP DATABASE IF EXISTS \"$DB_NAME\";" 2>/dev/null || true
fi

# ── Create database if not exists ─────────────────────────────────────────────
DB_EXISTS=$($PSQL -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")
if [[ "$DB_EXISTS" != "1" ]]; then
    echo "Creating database '$DB_NAME'..."
    $PSQL -d postgres -c "CREATE DATABASE \"$DB_NAME\" ENCODING 'UTF8' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8' TEMPLATE template0;"
    echo "Database created."
else
    echo "Database '$DB_NAME' already exists — skipping create."
fi

# ── Run schema ────────────────────────────────────────────────────────────────
echo ""
echo "Running schema.sql..."
$PSQL -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/../database/schema.sql"
echo "schema.sql done."

# ── Run stored procedures ─────────────────────────────────────────────────────
echo ""
echo "Running stored_procedures.sql..."
$PSQL -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/../database/stored_procedures.sql"
echo "stored_procedures.sql done."

# ── Run seeds ─────────────────────────────────────────────────────────────────
echo ""
echo "Running seeds.sql..."
$PSQL -d "$DB_NAME" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/../database/seeds.sql"
echo "seeds.sql done."

# ── Set app encryption key in Postgres ────────────────────────────────────────
if [[ -f "$(dirname "$0")/../.env" ]]; then
    ENC_KEY=$(grep '^ENCRYPTION_KEY=' "$(dirname "$0")/../.env" | cut -d= -f2-)
    if [[ -n "$ENC_KEY" ]]; then
        echo ""
        echo "Setting app.encryption_key in PostgreSQL..."
        $PSQL -d "$DB_NAME" -c "ALTER DATABASE \"$DB_NAME\" SET app.encryption_key = '$ENC_KEY';"
        echo "Encryption key set."
    fi
fi

echo ""
echo "============================================"
echo " ✅  Database setup complete!"
echo "============================================"
