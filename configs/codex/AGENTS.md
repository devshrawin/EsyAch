Use the canonical `esyach` skill from `plugins/esyach/`.

For Codex CLI, copy the skill to `~/.codex/skills/esyach`. If your Codex build supports prompt templates, you may also copy `plugins/esyach/commands/*.md` to `~/.codex/prompts/`.

Activate by asking Codex to use `$esyach` or the `esyach` skill before explaining or reviewing an SRS, or generating diagrams, diff reviews, plan reviews, slide decks, or complex tables. Generated pages go to `~/.agent/diagrams/`; opening the browser may depend on Codex sandbox permissions.

Command-template support varies by Codex version. If prompts are unavailable, read the relevant command file and follow the skill workflow manually.
