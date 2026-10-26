#!/usr/bin/env bash
# Everything: unit tests, viewer build, validation, render, browser smoke test, 600-node perf check.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m unittest discover -s tests -p 'test_*.py'
tests/render_examples.sh
OUT=$(mktemp -d)
node tests/viewer_smoke.cjs examples/shop-demo/.flowmap/flowmap.html "$OUT"
python3 tests/gen_big.py 600 -o "$OUT/big.json"
python3 scripts/validate.py "$OUT/big.json" | tail -1
python3 scripts/build.py "$OUT/big.json" -o "$OUT/big.html"
node tests/perf.cjs "$OUT/big.html" "$OUT/big.png"
