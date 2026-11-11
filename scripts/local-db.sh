#!/usr/bin/env bash
# Local development PostgreSQL for the Agross admin dashboard.
# Creates a private cluster inside .local/ (never touches other databases on this computer),
# listens only on 127.0.0.1:5433, and holds sample data only.
#
#   scripts/local-db.sh start | stop | status | reset
set -euo pipefail

# PostgreSQL refuses to start on macOS without a valid locale.
export LC_ALL=en_US.UTF-8

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/.local/postgres"
PORT=5433

find_bin() {
  for dir in /opt/homebrew/opt/postgresql@16/bin /opt/homebrew/opt/postgresql@17/bin /opt/homebrew/opt/postgresql@18/bin \
             /opt/homebrew/opt/postgresql@14/bin /usr/local/opt/postgresql@16/bin /usr/lib/postgresql/16/bin; do
    [ -x "$dir/pg_ctl" ] && { echo "$dir"; return; }
  done
  command -v pg_ctl >/dev/null 2>&1 && { dirname "$(command -v pg_ctl)"; return; }
  echo "PostgreSQL command-line tools not found. Install PostgreSQL (for example: brew install postgresql@16)." >&2
  exit 1
}
BIN="$(find_bin)"

init_if_needed() {
  if [ ! -d "$DATA" ]; then
    mkdir -p "$DATA"
    "$BIN/initdb" -D "$DATA" -U agross -A trust --encoding=UTF8 >/dev/null
    echo "listen_addresses = '127.0.0.1'" >> "$DATA/postgresql.conf"
    echo "port = $PORT" >> "$DATA/postgresql.conf"
    echo "unix_socket_directories = '$DATA'" >> "$DATA/postgresql.conf"
  fi
}

case "${1:-}" in
  start)
    init_if_needed
    "$BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1 || "$BIN/pg_ctl" -D "$DATA" -l "$DATA/server.log" -w start >/dev/null
    for name in agross agross_test; do
      "$BIN/psql" -h 127.0.0.1 -p $PORT -U agross -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$name'" | grep -q 1 \
        || "$BIN/createdb" -h 127.0.0.1 -p $PORT -U agross "$name"
    done
    echo "Local PostgreSQL running on 127.0.0.1:$PORT (databases: agross, agross_test)"
    ;;
  stop)
    "$BIN/pg_ctl" -D "$DATA" stop -m fast >/dev/null 2>&1 && echo "Stopped." || echo "Not running."
    ;;
  status)
    "$BIN/pg_ctl" -D "$DATA" status || true
    ;;
  reset)
    "$BIN/pg_ctl" -D "$DATA" stop -m fast >/dev/null 2>&1 || true
    rm -rf "$DATA"
    "$0" start
    ;;
  *)
    echo "Usage: $0 start|stop|status|reset" >&2
    exit 1
    ;;
esac
