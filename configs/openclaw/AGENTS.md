Use the canonical `esyach` skill from `plugins/esyach/`.

OpenClaw support is lightweight rules guidance, not a native plugin adapter. Point the agent at `plugins/esyach/SKILL.md` and ask it to follow that workflow when producing diagrams, visual reviews, slide decks, or complex tables.

Generated pages should be written to `~/.agent/diagrams/` and opened in a browser when the environment allows it. If OpenClaw does not support command templates, read the matching file under `plugins/esyach/commands/` and execute its instructions manually.
