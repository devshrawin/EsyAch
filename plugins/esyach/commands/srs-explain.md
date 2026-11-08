---
name: srs-explain
description: Explain an SRS (PDF, DOCX, Markdown, or text), optionally with screenshots, as one page with coverage, journeys, gaps, a trace table, and a clickable prototype
---

Load the esyach skill, read `references/srs.md`, and explain this SRS.

Input: `$@` is the SRS path, optionally followed by `--screens <folder|zip>`. Without screenshots, explain the document alone: context, modules, rules, the trace table, and its findings.

1. Run `tools/extract_srs.py` into `<srs folder>/.esyach/srs_text.json`. Report the requirement count; if the IDs were numbered by esyach, say so. Warn about any PII it prints.
2. With screenshots: run `tools/screens_prep.py` into the same `.esyach/`, then view **every** `grid/*.png` before writing a box.
3. Read the whole SRS. Write `.esyach/srs.json`: actors, modules, screens with every control, links, journeys per actor, and findings. Ground each claim in the SRS text or a screenshot; an inferred link carries its reason.
4. Write `.esyach/srs.src.html` in the shape `references/srs.md` gives, then render with `kit/render.mjs`. Fix every `✗`, look at the sheet once, and fix with small edits.
5. Hand over in a few lines: the page path, the `SRS:` line, each contradiction and missing screen, and the low-confidence links to confirm.

When the reply arrives: answers to `<ve-ask>` decide which side of a contradiction wins or what happens to a missing screen. Record them as notes in `srs.json` findings and render again. A question the reader left alone is not an answer. Never edit the SRS itself unless the user asks.
