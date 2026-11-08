---
name: srs-review
description: Audit an SRS before the build - ambiguous, untestable, conflicting, or missing requirements - as a verdict-first page with a decision per problem
---

Load the esyach skill, read `references/srs.md`, and review this SRS as a document. Screenshots are optional; this review judges the writing, not the screens.

Input: `$@` is the SRS path, optionally with `--screens <folder|zip>` to add coverage.

1. Run `tools/extract_srs.py` (and `tools/screens_prep.py` when screenshots are given) into `<srs folder>/.esyach/`.
2. Read every requirement. Record each problem as a finding in `srs.json`, citing its ID:
   - `ambiguity`: two readings, a vague word (fast, easy, user-friendly, etc.), no actor, or no measurable target;
   - `contradiction`: two requirements, or the SRS and a screen, that cannot both hold (`srs_says` / `screen_shows` name both sides);
   - `missing_state`: an error, empty, or permission case the SRS implies but never specifies;
   - `note`: a gap in scope, such as an NFR area with no requirement (security, accessibility, availability) or a business rule with no owner.
3. Page: verdict first ("Ready to build after 4 fixes"), then `<ve-coverage>`, `<ve-gaps only="findings">` as small multiples, `<ve-trace>`, and one `<ve-ask id="f1" …>` per finding worth a decision. Each ask offers a rewrite of the requirement as the suggested option (`default`, one line in `note`) and "keep as written".
4. Render with `kit/render.mjs`, fix every `✗`, and hand over: the verdict, the count by type, and the three findings that block the build.

When the reply arrives, draft the rewritten requirements the reader accepted as a list for the SRS owner. Do not edit the SRS file unless the user asks.
