#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
trap 'echo "VERIFY FAIL (setup or check failed)" >&2' ERR
if [[ "${SKIP_NPM_CI:-0}" != "1" ]]; then npm ci; fi
npm run build
npm test
checks=0
expect() {
  local expected="$1"
  shift
  local actual=0
  "$@" >/dev/null 2>&1 || actual=$?
  if [[ "$actual" != "$expected" ]]; then
    echo "VERIFY FAIL: expected $expected, got $actual: $*" >&2
    exit 1
  fi
  checks=$((checks + 1))
}
expect 0 node dist/cli.js files test/fixtures/good --json
for fixture in version-mismatch mcpname-missing mcpname-mismatch npm-identifier-mismatch npm-package-version-mismatch mcpb-sha-mismatch schema-missing registry-type-snake; do
  expect 1 node dist/cli.js files "test/fixtures/$fixture" --json
done
expect 2 node dist/cli.js files test/fixtures/no-package-json --json
expect 0 node dist/cli.js files test/fixtures/only-package-json --json
fake_cmd="\"$(command -v node)\" \"$PWD/test/fixtures/fake-server.mjs\""
expect 0 node dist/cli.js tools test/fixtures/good --cmd "$fake_cmd" --json
expect 1 node dist/cli.js tools test/fixtures/good --cmd "$fake_cmd" --env 'FAKE_TOOLS=[{"name":"extra"}]' --json
echo "VERIFY PASS ($checks checks)"
