#!/usr/bin/env bash
# Runs the migrations and SQL tests against a throwaway PostGIS container.
# Usage: supabase/tests/run.sh   (requires Docker)
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=runner-postgis-test
IMAGE=${POSTGIS_IMAGE:-imresamu/postgis:16-3.5}
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test "$IMAGE" >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
sleep 2
psql() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql < tests/bootstrap.sql
for f in migrations/*.sql; do
  echo "applying $f"
  psql < "$f"
done
psql -c "grant select on all tables in schema public to authenticated;"
echo "running tests"
psql < tests/territory_test.sql
echo "ALL SQL TESTS PASSED"
