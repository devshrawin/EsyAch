Use the canonical `esyach` skill from `plugins/esyach/`.

For Antigravity CLI, install the skill through native Agent Skills paths. Use `~/.gemini/antigravity-cli/skills/esyach` for global use, or `.agents/skills/esyach` inside one workspace. Antigravity also supports the older `.agent/skills` path, but new docs should use `.agents/skills`.

Install globally:

```bash
mkdir -p ~/.gemini/antigravity-cli/skills
cp -R plugins/esyach ~/.gemini/antigravity-cli/skills/esyach
```

Install in the current workspace:

```bash
mkdir -p .agents/skills
cp -R plugins/esyach .agents/skills/esyach
```

Launch `agy` from the project and run `/skills` to confirm `esyach` is discovered. When the user asks for a diagram, architecture overview, visual review, slide deck, project recap, fact check, or complex comparison table, ask Antigravity to use the `esyach` skill.

Antigravity SDK projects can reuse the same `SKILL.md` content as an Agent Skill resource, but this repo does not ship a separate SDK wrapper. The command markdown files under `plugins/esyach/commands/` remain reference prompts. No separate Antigravity plugin adapter is shipped because that would duplicate the canonical skill directory.

Generated pages should be written to `~/.agent/diagrams/` and opened in a browser when the environment allows it. If browser access is blocked, report the file path.
