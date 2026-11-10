// Builds cv.pdf from the CV section of index.html, so the PDF never drifts
// from the site. Run after any CV edit:
//   npm i --no-save playwright && npx playwright install chromium
//   node scripts/cv-pdf.js
// Set CHROMIUM_PATH to use an already installed Chromium instead.
// Layout follows the old read.cv profile: dates in a narrow left column,
// "Role at Company ↗" with a muted second line, contacts at the end.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://romannurgaliev.com';
// Not on the home page any more, so it lives here
const SUBTITLE = 'Product Designer in Almaty, Kazakhstan · Open to remote work or relocation';
// Entries that have a case page get a link to it
const CASES = {
  'VPN service': 'vpn', 'Brighty': 'brighty', 'DeDust.io': 'dedust', 'donuts.tg': 'donuts',
  'Antara Health': 'antara-health', 'Дизайн Такой': 'podcast',
};
const CONTACTS = [
  ['Email', 'romannurgaliev@gmail.com', 'mailto:romannurgaliev@gmail.com'],
  ['Website', 'romannurgaliev.com', SITE],
  ['LinkedIn', 'linkedin.com/in/romannurgaliev', 'https://linkedin.com/in/romannurgaliev'],
  ['Telegram', 't.me/romannurgaliev', 'https://t.me/romannurgaliev'],
];

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const src = await b.newPage();
  await src.goto('file://' + ROOT + '/index.html');
  // Reads hidden sections too (Earlier is hidden on the site but belongs in the PDF)
  const data = await src.evaluate(() => {
    const t = (el, s) => (el.querySelector(s)?.textContent || '').trim();
    return [...document.querySelectorAll('#cv .cv-section')].map(sec => ({
      label: t(sec, '.cv-section-label'),
      entries: [...sec.querySelectorAll('.cv-entry')].map(e => ({
        company: t(e, '.cv-entry-company'), period: t(e, '.cv-entry-period'), role: t(e, '.cv-entry-role'),
        bullets: [...e.querySelectorAll('.cv-entry-list li')].map(li => li.textContent.trim()),
        note: t(e, '.cv-entry-note'),
      })),
    }));
  });
  await src.close();

  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // "Oct 2025–Apr 2026" → "Oct 2025 — Apr 2026", "Present" → "Now", as on read.cv
  const period = p => esc(p.replace(/\s*–\s*/g, ' — ').replace('Present', 'Now'));
  const link = (text, href) => `<a href="${href}">${esc(text)}<span class="arrow">↗</span></a>`;

  const entry = (e, label) => {
    const slug = CASES[e.company];
    const company = slug ? link(e.company, `${SITE}/work/${slug}.html`) : esc(e.company);
    // Site format "Product Designer · Remote" → title "Product Designer at X", second line "Remote".
    // Side projects keep the project as the title and the role underneath.
    let title, sub;
    if (label === 'Side Projects') { title = company; sub = e.role; }
    else {
      const [role, place] = e.role.split(' · ');
      title = `${esc(role)} at ${company}`; sub = place || '';
    }
    return `<div class="row entry">
      <div class="date">${period(e.period)}</div>
      <div>
        <div class="title">${title}</div>
        ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
        ${e.bullets.length ? `<ul>${e.bullets.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}
      </div>
    </div>`;
  };

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Roman Nurgaliev — CV</title>
<style>
@font-face { font-family: Inter; src: url('file://${ROOT}/fonts/InterVariable.woff2') format('woff2'); font-weight: 100 900; }
@page { size: A4; margin: 15mm 20mm 15mm; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Inter, sans-serif; font-size: 9pt; line-height: 1.42; color: #111; letter-spacing: 0;
  font-optical-sizing: auto; -webkit-print-color-adjust: exact; }
a { color: inherit; text-decoration: none; }
.arrow { font-size: 0.75em; margin-left: 2px; vertical-align: 0.35em; }
header { margin-bottom: 24px; }
h1 { font-size: 12.5pt; font-weight: 500; letter-spacing: -0.012em; line-height: 1.3; }
.subtitle { color: #737373; margin-top: 2px; }
.chip { display: inline-block; margin-top: 7px; padding: 1px 7px; border-radius: 6px;
  background: rgba(17,17,17,.05); color: #737373; font-size: 8pt; }
section { margin-top: 22px; }
h2 { font-size: 9pt; font-weight: 500; margin-bottom: 14px; }
.row { display: grid; grid-template-columns: 34mm 1fr; column-gap: 5mm; }
.entry { margin-bottom: 13px; }
li, .note { break-inside: avoid; }
.title, .sub { break-after: avoid; }
.note { break-before: avoid; }
.contact { break-inside: avoid; }
.entry:last-child { margin-bottom: 0; }
.date { color: #737373; font-variant-numeric: tabular-nums; white-space: nowrap; }
.sub { color: #737373; }
ul { list-style: none; margin-top: 5px; }
li { padding-left: 10px; text-indent: -10px; margin-top: 1.5px; }
li::before { content: "–"; display: inline-block; width: 10px; text-indent: 0; color: #9a9a9a; }
.note { color: #737373; margin-top: 5px; }
.contact .row { margin-bottom: 5px; }
.contact .date { white-space: normal; }
</style></head><body>
<header>
  <h1>Roman Nurgaliev</h1>
  <div class="subtitle">${esc(SUBTITLE)}</div>
  <a class="chip" href="${SITE}">romannurgaliev.com</a>
</header>
${data.map(s => `<section><h2>${esc(s.label)}</h2>${s.entries.map(e => entry(e, s.label)).join('')}</section>`).join('')}
<section class="contact"><h2>Contact</h2>
${CONTACTS.map(([k, v, href]) => `<div class="row"><div class="date">${k}</div><div>${link(v, href)}</div></div>`).join('')}
</section>
</body></html>`;
  // Loaded from a file so the page may read the local Inter font
  const tmp = path.join(os.tmpdir(), 'cv-print.html');
  fs.writeFileSync(tmp, html);
  const p = await b.newPage();
  await p.goto('file://' + tmp, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.pdf({ path: ROOT + '/cv.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true });
  await b.close();
  console.log('cv.pdf written;', data.map(s => s.label + ':' + s.entries.length).join(' '));
})();
