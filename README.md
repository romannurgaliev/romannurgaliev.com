# romannurgaliev.com — README for AI assistants

This file is written for language models (Gemini, ChatGPT, Claude and others) that are asked to review, critique or edit this site. A human can read it too, but its first job is to give a model accurate context so it does not guess.

Snapshot date: 2026-10-31. If anything below disagrees with the HTML files or the live site, the files win. Say so and point out the mismatch.

---

## 1. What this is

- Portfolio and CV of **Roman Nurgaliev, product designer**. Fintech and B2B: trading, payments, billing, business onboarding, internal tools, often as the only designer on the team. Based in Almaty, open to remote work or relocation with visa sponsorship.
- **Audience:** recruiters and hiring managers. The site exists to get interviews.
- **Owner:** Roman is a designer, not a developer. Explain code changes in plain language. He often reads answers on a phone.
- **Live site:** https://romannurgaliev.com
- **Repo:** github.com/romannurgaliev/romannurgaliev.com, branch `master` (Netlify deploys from it; the `main` branch is old, so ignore it).
- **Stack:** plain HTML, one CSS file, vanilla JS. No framework, no build step, no CMS, no analytics scripts.

---

## 2. Rules for your answer

These come from mistakes earlier reviews made. Follow them strictly.

1. **Never invent results, metrics, clients or benchmarks.** Every number on the site is real and comes from Roman. If you think a case needs a metric, say "a metric would help here" and leave the number empty. Don't write "~50% faster onboarding" or anything like it.
2. **Quote the exact current text before proposing a change.** If you can't see the current text (no file, no page access), say so instead of reconstructing it from memory or a cached copy. Earlier reviews quoted copy that had already been removed.
3. **Don't claim something is missing without checking.** Case pages exist (section 4). On phones (≤640px) the home page hides the case cards and the CV on purpose and shows a short text list of cases instead, so a mobile crawl can look like "no portfolio". It isn't.
4. **Don't re-propose declined ideas** (section 6).
5. **Separate facts from opinions.** Mark each point as one of: *bug* (something broken, with a way to reproduce it), *inconsistency* (two places disagree; quote both), *suggestion* (taste or strategy).
6. **Point to a location:** page URL or file, plus a section heading or CSS selector.
7. **Design decisions are Roman's.** For anything that isn't a clear bug, give at most 2 options with the trade-off and let him choose. Don't say "the right way is…" about taste.
8. **Do only what was asked.** Mention side issues in one line at the end.

---

## 3. Site structure

| Page | URL | Contents |
|---|---|---|
| Home | `/` (`index.html`) | Sidebar with name, bio and nav; 6 case cards; CV section (`#cv`); contact section (`#contact`). One long page with anchors, no separate /cv or /contact pages (old URLs 301 to the anchors) |
| Case pages | `/work/<slug>.html` | `brighty`, `donuts`, `vpn`, `dedust`, `antara-health`, `podcast` |
| CV PDF | `/cv.pdf` | Generated from the `#cv` section, so the text is identical |
| 404 | `404.html` | |

Layout:
- **Desktop home:** 320px sticky sidebar on the left, content on the right, max width 1200px.
- **Case pages:** the sidebar becomes a top bar that hides when you scroll down. Text column 680px, images up to 1200px. From 1240px wide, a contents list (built from the section headings) appears on the left.
- **Phones (≤640px):** the top bar shows only the name (no menu) on every page. The home page shows bio → text list of cases → contact. Cards and CV are hidden on purpose.
- The **Brighty** page has an interactive Liquidation Risk Simulator on screens ≥960px; on smaller screens it is replaced by a carousel of still images.

---

## 4. Content (current)

Home bio: "I design fintech and B2B products: trading, payments, billing, business onboarding, and internal tools, often as the only designer on the team. I work closely with engineers, compliance, clinicians, and merchants. Now I'm building a VPN for networks where Surfshark doesn't work." (On phones the middle sentence is hidden.)

Cases, in display order. **The order is deliberate** (fintech and B2B first, the podcast last) and the "Previous / Up next" links at the bottom of case pages follow it.

| # | Case | Period | Role | Platform | Card text (after the role, as on site) |
|---|---|---|---|---|---|
| 1 | Brighty — Trading Terminal & B2B Onboarding | Oct 2025–Apr 2026 | Sole designer | Web | Web trading terminal for perps and spot, taken to public release, plus KYB onboarding for business accounts. |
| 2 | donuts.tg — Crypto Payment Gateway | Jul–Dec 2024 | Founding designer | Web | Web checkout, merchant dashboard, and admin panel for a TON payment gateway; processed live merchant payments in beta. |
| 3 | VPN service — Apps & Web Account | May 2026–Present | Product designer | Web, iOS, Android, Android TV | Web account and apps for iOS, Android, and Android TV for a VPN with 275K+ monthly users; 96% stayed on the new account in an A/B test. |
| 4 | DeDust.io — TON Explorer & Quest Hub | Mar–Sep 2025 | Product designer | Web, Telegram Mini App | Quest Hub, a Telegram Mini App for on-chain quests with 100K+ participants, and a web explorer for TON smart-contract developers. |
| 5 | Antara Health — Virtual Primary Care | Feb 2021–May 2024, part-time from Oct 2024 | Founding designer, 0→1 | iOS, Android, web | Patient app for iOS and Android and a web app for clinical staff; capacity grew from 206 to 800 patients per clinician. |
| 6 | Дизайн Такой — Podcast | Dec 2018–Dec 2022 | Co-host | Audio & YouTube, in Russian | 61 episodes, 482K plays, 101K listeners; the most-listened podcast in DevCrowd's 2023 survey of product designers. |

Facts that look odd but are intentional:
- **The VPN company is never named**, anywhere on the site. Don't suggest naming it. (The bio mentions Surfshark as a competitor, not the employer.)
- **donuts.tg closed** in December 2024 (merchants needed networks beyond TON; the next step needed a banking license). The CV says so.
- **Years appear on case pages and in the CV, not on home cards.**
- **The podcast is in Russian** and has a different meta layout from the other cases.

Case page anatomy: title + period → lead paragraph → meta pills (Role → Platform → Team → Location; Team is left out where there's nothing to say) → sections, each with one heading → Previous / Up next. Section headings per page:

- Brighty: Overview · Trading Terminal · Cross-Margin Risk Simulator · Brighty Business · KYB Onboarding · Outcome
- donuts.tg: Overview · What I Did · Checkout · Merchant Dashboard · Outcome
- VPN: Overview · Web Account · Pricing and Billing · Apps and Sign-in · In Progress · Outcome
- DeDust: Overview · Explorer · Quest Hub · Outcome
- Antara Health: Overview · What I Did · Research: My Health · Back Part-time · Outcome
- Podcast: Overview · Reach · Listen · Talk

---

## 5. Design system (for visual critique or CSS edits)

- **One typeface:** Inter Variable, self-hosted. Weights 400 and 500 only. No other fonts, no Google Fonts.
- **Monochrome:** white background, near-black text (#111), grey muted text (#737373), hairlines at 10% black. No accent color. This is deliberate.
- **Seven type sizes:** 13 / 16 / fluid 17–20 (case copy) / 20 / fluid 24–28 / 44 (32 on phones) / fluid 40–64 (case title). No uppercase, no decorative letter-spacing.
- **Images:** webp with explicit width and height. Screen recordings are looping AV1/H.264 videos with a poster frame, never GIF or animated webp. Phone screens are shown inside device bezels; no frame inside a frame.
- **Accessibility already in place** (don't break it, no need to propose it): skip link, visible focus ring, `prefers-reduced-motion` respected in CSS and JS, keyboard-controllable carousels, `role="status"` toast.
- **Exception:** `risk-sim.css` reproduces a trading-terminal UI and has its own colors, bold weights and uppercase labels. That is intentional and stays isolated from the rest of the site.

---

## 6. Already decided: don't propose these

- A "Read case →" link, arrow or other call to action on home cards. Declined.
- A "What I'd do differently" or retrospective section in cases. Declined.
- Raising the contrast of the carousel counter (currently 4.27:1). Declined.
- Showing case cards or the full CV on phones. Hidden by design.
- Adding tags or years to home cards.
- Changing the case order.
- Adding a color accent, a second typeface, or more font weights.
- Naming the VPN company.

---

## 7. If you propose code changes

- Read the actual file first. Don't guess class names.
- **Shared markup is copied by hand.** There's no templating, so `<head>`, sidebar/top bar, footer and pager exist in every HTML file (`index.html`, `404.html`, `work/*.html`). A change to one must be repeated in all of them; list every file.
- Colors only as CSS variables defined in `:root` in `style.css`. Text sizes are set in the "Type roles" block at the top of `style.css`, not on individual components.
- No JS libraries. Modern syntax for new code.
- Any edit to CV text in `index.html` means `cv.pdf` must be rebuilt (`node scripts/cv-pdf.js`).
- Any change to the simulator (`risk-model.js`, `risk-sim.js`, `risk-sim.css`) must pass `npm test` and `npm run test:ui`.
- Output: a unified diff or the exact before/after snippet per file. No full-file rewrites unless asked.

Key files:

```
index.html        home: bio, case cards, #cv, #contact (+ inline scroll-spy script)
work/*.html       case pages
style.css         the whole site's styles
case-nav.js       case pages: hiding top bar, contents list
case-media.js     carousels, galleries, looping videos
copy-email.js     click-to-copy email + toast
risk-model.js     simulator math (no UI); docs/risk-model.md explains it
risk-sim.js/.css  simulator UI, Brighty page only
_redirects, _headers   Netlify redirects and cache rules
CLAUDE.md         detailed working rules for Claude Code (same facts, more detail)
```
