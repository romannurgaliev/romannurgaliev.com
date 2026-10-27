# CLAUDE.md — romannurgaliev.com

Portfolio and CV of Roman Nurgaliev, product designer. Audience: recruiters and hiring managers.
Plain HTML + CSS + vanilla JS. No framework, no build step. Deployed by Netlify from `master` (the old `main` branch on GitHub is stale; don't push there).

Repo: `github.com/romannurgaliev/romannurgaliev.com` · local: `~/Documents/romannurgaliev.com`

Roman is a designer, not a developer. Explain changes in plain terms; don't assume he can debug code.

---

## Working with Roman

Design decisions are Roman's. When something is unclear, ask; don't fill the gap with your own design choice.

1. **References are the spec.** When Roman shows examples (screenshots, other sites), copy what is in them. Anything that isn't there (images, extra rows, new controls), ask first.
2. **When the agreed solution breaks** (doesn't fit, conflicts with something), show a screenshot and 2 options. Don't pick one yourself.
3. **Before adding an element, check the whole page** for something it duplicates.
4. **Do only what was asked.** Mention side issues in one line at the end; don't fix them unasked.
5. **Keep replies short:** result, screenshot, question if there is one. He reads on a phone.

---

## Read before editing

- Read the actual file before changing it. Don't guess class names or values — this file describes the system, the code is the source of truth.
- If the code and this file disagree, trust the code and point out the mismatch.
- Change existing tokens and rules before adding new selectors.
- Every shared block (head, sidebar, footer, pager) is copied by hand into several files. When you change one, change all of them (see "Duplicated markup").

---

## File structure

```
index.html            — the one main page: #home (bio + case cards, #work) → #cv → #contact
work/<slug>.html      — case pages: brighty, donuts, vpn, dedust, antara-health, podcast
work/images/<project>/ — stills (DeDust uses work/images/questhub/): webp, <what>-<width>.webp (e.g. terminal-700.webp);
                        animations: <what>-<width>-av1.mp4 + -h264.mp4 + -poster.webp
_redirects, _headers  — Netlify: 301s for old URLs (/cv, /work, /contact), cache headers
404.html
style.css             — the whole site, one file
risk-model.js         — simulator math and demo data, no page code (browser: window.RiskModel, Node: require)
risk-sim.css/.js      — Liquidation Risk Simulator UI, Brighty page only, desktop ≥960px; loads after risk-model.js
docs/risk-model.md     — the simulator math for developers: formulas, assumptions, Hyperliquid gaps; tests/vectors.json has worked examples
tests/                — risk-model.js tests (see tests/README.md): `npm test`, `npm run coverage`,
                        `npm run mutation`, `npm run test:ui` (browser). Run them after any change to the simulator
case-nav.js           — case pages: hiding top bar, contents list (≥1240px)
case-media.js         — case pages: carousels (.case-carousel), galleries (.case-gallery), looping videos (video[data-loop])
copy-email.js         — any [data-copy] element copies its value and shows a toast
scripts/cv-pdf.js     — builds cv.pdf from the #cv section of index.html (Playwright)
scripts/audit.js      — mechanical site checks for the periodic audit (`node scripts/audit.js`)
.claude/skills/audit/  — the /audit procedure; .claude/hooks/audit-reminder.js reminds every 6 sessions
cv.pdf, og-image.png, favicon.svg, robots.txt, sitemap.xml
fonts/InterVariable.woff2
```

Scroll-spy and smooth anchor scrolling for index.html are an inline `<script>` at the end of index.html.

---

## Design tokens (style.css `:root`)

Colors — never hardcode a color in style.css outside `:root`:

```css
--bg: #FFFFFF;
--text: #111111;
--text-muted: #737373;
--line: rgba(17,17,17,0.1);
--fill: rgba(17,17,17,0.05);
--fill-hover: rgba(17,17,17,0.09);
--bar-bg: rgba(255,255,255,0.92);  /* sticky bars, under a blur */
--edge: rgba(17,17,17,0.06);       /* hairline around a screenshot */
--shadow: rgba(17,17,17,0.08);     /* toast */
```

Font: Inter Variable, self-hosted and preloaded. No Google Fonts, no other typefaces.

Type scale — seven steps, two weights (400 and 500). Nothing else in style.css (exceptions: `.home-bio` uses line-height 1.45; on phones the home page text — bio, case list, contact text and links — is 18px / 1.45 / −0.014em):

| Step | Size | Line height | Tracking | Used for |
|---|---|---|---|---|
| S | 13px | 1.4 | 0 | meta, years, labels, chips (weight 500) |
| M | 16px | 1.5 | −0.011em | body, CV entries |
| Body | clamp(17px, 15px + 0.25vw, 20px) | 1.55 | −0.014em | case copy (paragraphs and lists in `.case-section`); fluid, ~18.5px on a 1440 laptop |
| L | 20px | 1.3 | −0.017em | bio, nav, card titles, case lead |
| H | clamp(24px, 23px + 0.26vw, 28px) | 1.25 | −0.021em | h2 inside a case, pull quotes; fluid, ~1.4 × Body |
| XL | 44px (32 on phones) | 1.15 | −0.028em | section titles |
| Display | clamp(40px, 4.6vw, 64px) | 1.02 | −0.03em | case page h1 |

Text elements get their size from the "Type roles" block near the top of style.css (each role lists its selectors). To change a text style, add the selector to a role there; don't set `font-size` on a component.

No `text-transform: uppercase` and no decorative `letter-spacing` anywhere in style.css.

`risk-sim.css` is the exception: it reproduces the trading terminal UI and has its own tokens (`--w50`, `--red`, …), weights 600/700 and uppercase. Keep it isolated; don't reuse its styles elsewhere.

---

## Layout

- **index.html** (`body.two-col`): grid, 320px sticky sidebar + content, max 1200px. On desktop the nav sits in the vertical middle of the sidebar; name, bio and section titles share one baseline (`--baseline`).
- **Case pages** (`body.case-page`): the sidebar becomes a top bar that hides on scroll down. Text column 680px (`--case-text`), figures 1200px (`--case-wide`), contents list on the left from 1240px.
- Breakpoints: 640 (phones), 768/769 (sidebar → top), 960 (risk simulator), 1240 (contents list).

---

## Content

Home cards, in this order (the order is deliberate — fintech and B2B first). Years are shown on case pages only, not on cards:

1. Brighty — Trading Terminal & B2B Onboarding · 2025–2026 → work/brighty.html
2. donuts.tg — Crypto Payment Gateway · 2024 → work/donuts.html
3. VPN service — Apps & Web Account · May 2026–Present → work/vpn.html
4. DeDust.io — TON Explorer & Quest Hub · 2025 → work/dedust.html
5. Antara Health — Virtual Primary Care · 2021–2024 → work/antara-health.html
6. Дизайн Такой — Podcast · 2018–2022 → work/podcast.html

The case pager (Previous / Up next) must follow the same order. The VPN company is not named anywhere on the site.

Home card structure: `a.case-card` > `.case-thumb` (image first) > `.case-meta` > `.case-header` (`h2.case-title`) + `p.case-desc`. No tags on cards.

Case page structure: `article.case` > `header.case-head` (h1 + period) > `.case-intro` (lead, chips) > `.case-section` blocks, each with one `h2` (the contents list is built from these) > `nav.case-pager`. Figures: `.case-figure` with `.case-figure-frame` (`--phones`), `.case-carousel`, `.case-gallery`, `.case-embed`.

Images: webp, always with `width`, `height`, `alt`, and `srcset`/`sizes` when there are several widths. `loading="lazy"` on all images except the first on a page, which gets `fetchpriority="high"`.

Animations (screen recordings, UI loops) are never animated webp or GIF — they are looping videos, 5–10× lighter. One size per animation, AV1 first with an H.264 fallback (Safari on devices without AV1), poster = the first frame:

```html
<video data-loop role="img" muted loop playsinline preload="none" poster="images/x/name-640-poster.webp" width="640" height="1088" aria-label="What the animation shows">
  <source src="images/x/name-640-av1.mp4" type='video/mp4; codecs="av01.0.05M.08"'>
  <source src="images/x/name-640-h264.mp4" type="video/mp4">
</video>
```

case-media.js plays a `video[data-loop]` only while it is in view and never with reduced motion. Video width and height must be even. Encode (ffmpeg): H.264 `-c:v libx264 -preset slow -crf 26 -tune animation -movflags +faststart`; AV1 `-c:v libsvtav1 -preset 6 -crf 38 -movflags +faststart`; codecs string level from `ffprobe -show_entries stream=level`. Styles: frame rules use `:is(img, video)`.

CV text lives only in the #cv section of index.html. After any CV edit, rebuild the PDF:

```bash
npm i --no-save playwright && npx playwright install chromium
node scripts/cv-pdf.js
```

---

## Duplicated markup

No templating, so these are copied by hand — update every copy:

- `<head>` (meta, OG, preload, favicon, stylesheet): index.html, 404.html, all work/*.html
- Sidebar / top bar: index.html, 404.html, all work/*.html
- Footer (`.site-footer`): all work/*.html
- Pager: all work/*.html and 404.html
- `sitemap.xml` `lastmod`: update by hand when a page changes

---

## Code conventions

- HTML: semantic and minimal. Every landmark that repeats (`nav`) needs an `aria-label`.
- Accessibility that already exists and must not break: skip link, `:focus-visible` outline, `prefers-reduced-motion` (CSS and JS), toast as `role="status"`, `inert` on hidden carousel slides, arrow-key carousel control.
- JS: no libraries. New code in modern syntax (`const`, arrow functions); existing ES5 files (case-nav, case-media, risk-sim) may stay as they are until rewritten.
- Comments explain why, in plain English, as in the existing files.

---

## Known issues (in priority order)

Do now:
- [x] Pager order on case pages doesn't match the home order (current pager: VPN → Brighty → DeDust → donuts → Antara → Podcast)
- [x] First image on index and each case page is `loading="lazy"`; make it eager with `fetchpriority="high"`
- [x] Add Netlify `_redirects` (301 for /cv.html, /work.html, /contact.html) and `_headers` (long cache for /fonts and /work/images)
- [x] Second `<nav>` on case pages has no `aria-label`

Later:
- [x] Animated webp → looping AV1/H.264 video with poster (Brighty 5.9 → ~1.2 MB, Antara ~5.5 → ~1 MB)
- [ ] Type scale in rem; remove `html { font-size: 16px }`
- [ ] Own og:image per case
- [ ] Spacing and radius tokens (now ~30 spacing values, 13 radii)
- [ ] Media queries: keep them next to their component, drop the separate "Responsive" block at the end
- [ ] One JS dialect; move index scroll-spy into a shared file with case-nav.js
- [x] Remove dead CSS (`.delay-2`…`.delay-6`, `.case-thumb--placeholder`, `.case-figure-frame--dialog`) and duplicate selectors (`.case-stats dd`, `.contact-link-value`); `.case-thumb-strip--2` removed from the HTML
- [x] Type set on components (captions, quote, stats, toast, footer, contents list) moved into Type roles
- [ ] Sidebar `<aside>` → `<header>`
- [ ] Templating for the shared shell — only once there are ~10 cases
- [ ] Full-screen image view: removed, kept on the local branch `archive/fullscreen-view` (dark scrim, fit-to-window gallery, slide between screens)

---

## Audit

After every 5–8 sessions, run `/audit` (.claude/skills/audit/SKILL.md): mechanical checks with `node scripts/audit.js`, then a read-through for facts that disagree between pages, leftovers and CLAUDE.md drift. A SessionStart hook counts sessions and reminds from the 6th; if its reminder shows up in context, mention it to Roman in one line. The audit resets the counter with `node .claude/hooks/audit-reminder.js --reset`.

## Deploy

Claude Code can push (it uses the same Keychain token). Commit and push only when Roman asks. Otherwise end every task with the commit command so he can run it himself:

```bash
git add -A && git commit -m "description" && git push
```

If a push fails on auth, give Roman that command to run in his own terminal.

Remote: HTTPS with a Personal Access Token in macOS Keychain. Pushing changes to `.github/workflows/` needs a token with the `workflow` scope.

GitHub Actions (`.github/workflows/test.yml`) runs the simulator tests on every push; it doesn't block Netlify. Browser screenshots for CI are recorded by the "Update Linux screenshots" workflow (see tests/README.md).
