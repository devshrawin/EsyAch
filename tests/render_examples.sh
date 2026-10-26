#!/usr/bin/env bash
# Rebuild the viewer template, re-render the example HTML files and take screenshots.
set -euo pipefail
cd "$(dirname "$0")/.."
(cd viewer && npx tsc --noEmit && npx vite build >/dev/null)
python3 scripts/validate.py examples/shop-demo/.flowmap/architecture.json --root examples/shop-demo
python3 scripts/build.py examples/shop-demo/.flowmap/architecture.json -o examples/shop-demo/.flowmap/flowmap.html
node tests/screenshot.cjs examples/shop-demo/.flowmap/flowmap.html docs/mode-a.png
node tests/screenshot.cjs examples/shop-demo/.flowmap/flowmap.html docs/mode-a-flow.png --flow checkout --step 5
node tests/screenshot.cjs examples/shop-demo/.flowmap/flowmap.html docs/mode-a-failure.png --flow payment_declined --step 5
