# Security

flowmap analyses code and documents you point it at, so it is built to treat them as hostile. See [docs/is-it-safe.md](docs/is-it-safe.md) for what it does and does not do.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability reporting (Security tab → Report a vulnerability) on this repository. You can expect an acknowledgement within a few days.

Examples of what we want to hear about: a way for an analysed repo, zip or SRS to run code or write outside its output folder, a way for a generated map to make a network request, or script injection through names or text embedded in a map.
