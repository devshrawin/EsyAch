# Is it safe to install?

flowmap is a Claude Code plugin made of Markdown instructions, a few Python scripts and one prebuilt HTML viewer.

## What the plugin contains

- **No hooks, no MCP servers, no install scripts.** Installing it adds two slash commands and one skill.
- **No dependencies to install.** The Python scripts import only the standard library (Pillow and pypdf are optional and guarded). The viewer is prebuilt, so you do not need npm. Test `PKG-06` checks the imports on every run.
- **Nothing is downloaded at run time**, apart from the one thing you ask for: a GitHub URL you pass to `/flowmap` is shallow-cloned.

## What it does to the code you analyse

- **It never runs it.** No install, no import, no build, no tests of the target. We do not even call `git ls-files` on a target, because a hostile `.git/config` could run commands; `.gitignore` is parsed by hand (test `ING-10`).
- **Clones** are `https` only (`ING-09`), shallow, with git hooks, LFS filters and file protocol off.
- **Zips** are rejected on path traversal, absolute paths, symlinks, too many entries, zip bombs and oversized contents, and nested archives are never extracted (`ING-05` to `ING-08`, `ING-12`).
- **Symlinks** inside an analysed folder are never followed.
- **Size caps** apply to files and screenshots.

## What the generated map does

- **One self-contained HTML file** with your data embedded. It makes **zero network requests**: the browser tests block every request and fail on any attempt (`VA-01`, `VB-01`, `VA-16`, `VB-24`, `VB-29`).
- Text from your code and documents is escaped before it is embedded, so it cannot close the script tag or inject markup.
- Edits and drafts are saved only to your browser's local storage, or to a file you download.

## What leaves your machine

Only what Claude Code itself sends when it reads the files it needs, under your own account. flowmap adds no analytics, tracking or upload of its own. It warns you if an SRS or screenshot seems to contain real personal data (e-mails, phone numbers, card numbers).

## Check it yourself

```bash
python3 tests/qa.py --no-network     # 140 cases, including all of the above
```
