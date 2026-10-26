---
name: audit
description: Periodic cleanup of romannurgaliev.com after several sessions of edits — finds and fixes drift between pages, CSS, images, docs and CLAUDE.md. Use when Roman types /audit, says "аудит", "проверь всё", "почисти после сессий", or when the session-start reminder says an audit is due.
---

# Site audit

Goal: after several sessions of quick edits, bring the site back to one consistent
state — the code matches CLAUDE.md, every copy of shared markup matches, nothing is
broken or left over — **without changing how the site looks or what it says**,
unless something is plainly a mistake.

Roman is a designer, not a developer. Report in Russian, in plain words.

## 0. Scope

- What changed since the last audit: `git log --oneline` back to the last commit
  whose message starts with "Audit", and `git diff --stat <that commit>..HEAD`.
  Look hardest at those files, but run every check on the whole site.
- Read CLAUDE.md and the memory notes first. Things Roman has declined
  (e.g. the carousel counter contrast) are not findings.

## 1. Mechanical checks

```bash
node scripts/audit.js
```

It checks: missing files, unused images, image/video attributes and real sizes,
copies of `<head>`, sidebar and footer, pager order vs home cards, nav labels,
straight quotes, CSS rules from CLAUDE.md (colours, weights, type roles, unused
and duplicate selectors), sitemap dates, cv.pdf age. Fix everything it reports, or
explain why a finding is deliberate and teach the script to allow it (with a comment).

If you find a class of mistake by hand that a script could catch, add the check to
`scripts/audit.js`.

## 2. By hand — what the script can't judge

Read every page in full (index.html, 404.html, work/*.html) and check:

- **Facts agree everywhere.** Each number, date, title, and claim must match across
  the home card, the case page, its meta description, and the CV in #cv
  (e.g. users, periods, "Present" vs "present", role names). If two places
  disagree and it's not obvious which is right, ask Roman — don't guess.
- **Copy style:** curly quotes and apostrophes (’ “ ”), en dash in ranges (2021–2024),
  captions with no full stop at the end, h2 in Title Case, no leftover
  TODO/lorem/placeholder text, the VPN company never named.
- **Leftovers of removed features:** CSS, JS, images, or CLAUDE.md lines for things
  that were deleted (check recent commits that say "remove", "drop", "archive").
- **CLAUDE.md vs code.** Every token, file, class, breakpoint, rule and path in
  CLAUDE.md exists in the code and vice versa. The code wins; fix CLAUDE.md.
  Tick Known issues that are done; add new ones you find but don't fix.
- **JS:** selectors in case-media.js / case-nav.js / copy-email.js still exist in the
  HTML; classes they toggle have styles.
- **Video:** the AV1 `codecs` level matches
  `ffprobe -v error -select_streams v:0 -show_entries stream=level -of csv=p=0 <file>`.
- **Netlify:** `_redirects` hides every repo-only file and folder; `_headers` covers
  fonts and images.

## 3. Fix

- Smallest change that fixes it. Same rules as any edit (CLAUDE.md "Read before
  editing", "Duplicated markup").
- Before touching CSS, take a computed-style snapshot of every element on every page
  at 1440, 1280, 800 and 375px (Playwright from node_modules, local server from
  .claude/launch.json), and diff it after. Any difference must be intended — list it.
- Design or content decisions (a colour, a line height, a different wording) are
  not yours: list them as questions for Roman instead of changing them.
- Page changed → bump its `lastmod` in sitemap.xml. CV changed → rebuild cv.pdf.

## 4. Verify

```bash
node scripts/audit.js
npm test
npm run test:ui
```

Then open the home page and two case pages in the browser preview at desktop and
375px width and look at them. Check the console for errors.

## 5. Close

1. Reset the reminder: `node .claude/hooks/audit-reminder.js --reset`
2. Report in Russian, short: what was fixed (grouped: content, CSS, images, docs),
   what changed visibly (if anything), questions for Roman.
3. Commit message starts with "Audit:". Commit and push only if Roman asks;
   otherwise give him the command:

```bash
git add -A && git commit -m "Audit: …" && git push
```
