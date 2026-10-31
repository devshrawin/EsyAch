# Contributing to flowmap

Issues and pull requests are welcome.

## Set up

You need Python 3.9+ and Node 18+. The scripts use only the Python standard library (Pillow and pypdf are optional).

```bash
(cd viewer && npm ci)               # viewer dependencies
(cd viewer && npm run build)        # rebuild viewer/dist/index.html after any change in viewer/src
```

Commit the rebuilt `viewer/dist/index.html`: it is what users run, and they do not need npm.

## Test

```bash
python3 -m unittest discover -s tests -p 'test_*.py'     # fast unit tests
python3 tests/qa.py --no-network                         # 140 cases, including the browser tests
tests/run_all.sh                                         # everything, plus the 600-node performance check
```

On Windows use `python` or `py -3` in place of `python3`. The browser tests use Playwright's Chromium, then your installed Chrome or Edge; set `FLOWMAP_BROWSER` to a browser executable to override.

`npm install playwright` somewhere on your `NODE_PATH` is all the browser tests need.

## Pull requests

- One change per PR, with a test when behaviour changes.
- Keep the guarantees in [docs/is-it-safe.md](docs/is-it-safe.md): the HTML makes no network requests, nothing from an analysed repository is ever executed, and the scripts stay standard-library only.
- Update [CHANGELOG.md](CHANGELOG.md) and, for user-visible changes, the README.
