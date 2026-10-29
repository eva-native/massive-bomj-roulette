#!/usr/bin/env bash
# Backs up the MBR database with pg_dump from the compose "db" service.
#
#   deploy/backup.sh               # writes backups/mbr-YYYYmmdd-HHMMSS.sql.gz
#   KEEP=30 deploy/backup.sh       # keep the newest 30 backups (default 14)
#   BACKUP_DIR=/srv/mbr-backups deploy/backup.sh
#
# Run it from the directory with compose.yaml, e.g. from cron every night:
#   0 4 * * * cd /srv/mbr && deploy/backup.sh >> backups/backup.log 2>&1
#
# Restore: see docs/dev/deploy.md.
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-backups}
KEEP=${KEEP:-14}
mkdir -p "$BACKUP_DIR"

file="$BACKUP_DIR/mbr-$(date +%Y%m%d-%H%M%S).sql.gz"
tmp="$file.part"

# --clean --if-exists makes the dump restorable over an existing database.
docker compose exec -T db pg_dump -U mbr --clean --if-exists mbr | gzip > "$tmp"
mv "$tmp" "$file"
echo "backup: $file ($(du -h "$file" | cut -f1))"

# Keep only the newest $KEEP backups.
ls -1t "$BACKUP_DIR"/mbr-*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f -- "$old"
  echo "backup: removed $old"
done
