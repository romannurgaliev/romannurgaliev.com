// Builds cv.pdf from the CV section of index.html, so the PDF never drifts
// from the site. Run after any CV edit:
//   npm i --no-save playwright && npx playwright install chromium
//   node scripts/cv-pdf.js
// Set CHROMIUM_PATH to use an already installed Chromium instead.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const src = await b.newPage();
  await src.goto('file://' + ROOT + '/index.html');
  const data = await src.evaluate(() => {
    const t = (el, s) => (el.querySelector(s)?.textContent || '').trim();
    const title = document.title.split('—').pop().trim();
    const location = t(document, '.home-location');
    const sections = [...document.querySelectorAll('#cv .cv-section')].map(sec => ({
      label: t(sec, '.cv-section-label'),
      entries: [...sec.querySelectorAll('.cv-entry')].map(e => ({
        inline: e.classList.contains('cv-entry--inline'),
        company: t(e, '.cv-entry-company'), period: t(e, '.cv-entry-period'), role: t(e, '.cv-entry-role'),
        bullets: [...e.querySelectorAll('.cv-entry-list li')].map(li => li.textContent.trim()),
        note: t(e, '.cv-entry-note'),
      })),
    }));
    return { title, location, sections };
  });
  await src.close();

  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const entry = e => e.inline
    ? `<div class="inline"><b>${esc(e.company)}</b> · ${esc(e.role)}<span class="period">${esc(e.period)}</span></div>`
    : `<div class="entry">
        <div class="head"><b>${esc(e.company)}</b><span class="period">${esc(e.period)}</span></div>
        <div class="role">${esc(e.role)}</div>
        <ul>${e.bullets.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>
        ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}
      </div>`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Roman Nurgaliev — CV</title>
<style>
@font-face { font-family: Inter; src: url('file://${ROOT}/fonts/InterVariable.woff2') format('woff2'); font-weight: 100 900; }
@page { size: A4; margin: 16mm 17mm 16mm; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Inter, sans-serif; font-size: 9.4pt; line-height: 1.42; color: #111; letter-spacing: -0.005em;
  font-optical-sizing: auto; -webkit-print-color-adjust: exact; }
a { color: inherit; text-decoration: none; }
header { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px;
  padding-bottom: 12px; border-bottom: 1px solid rgba(17,17,17,.14); margin-bottom: 18px; }
h1 { font-size: 21pt; font-weight: 500; letter-spacing: -0.025em; line-height: 1.05; }
.title { font-size: 11pt; color: #737373; margin-top: 4px; }
.contacts { text-align: right; font-size: 8.6pt; color: #737373; line-height: 1.5; }
.contacts a { color: #111; }
h2 { font-size: 7.8pt; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #737373;
  margin: 16px 0 8px; }
section:first-of-type h2 { margin-top: 0; }
.entry { margin-bottom: 11px; break-inside: avoid; }
.head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
.head b { font-weight: 600; font-size: 10pt; }
.period { color: #737373; font-size: 8.6pt; white-space: nowrap; font-variant-numeric: tabular-nums; }
.role { color: #737373; margin-top: 1px; }
ul { list-style: none; margin-top: 4px; }
li { position: relative; padding-left: 11px; margin-top: 2.5px; }
li::before { content: "–"; position: absolute; left: 0; color: #9a9a9a; }
.note { color: #737373; margin-top: 4px; font-size: 8.6pt; }
.inline { display: flex; gap: 6px; align-items: baseline; margin-bottom: 4px; }
.inline b { font-weight: 600; }
.inline .period { margin-left: auto; }
</style></head><body>
<header>
  <div><h1>Roman Nurgaliev</h1><div class="title">${esc(data.title)}</div></div>
  <div class="contacts">
    <a href="mailto:romannurgaliev@gmail.com">romannurgaliev@gmail.com</a><br>
    <a href="https://romannurgaliev.com">romannurgaliev.com</a> · <a href="https://linkedin.com/in/romannurgaliev">linkedin.com/in/romannurgaliev</a> · <a href="https://t.me/romannurgaliev">t.me/romannurgaliev</a><br>
    ${esc(data.location.replace(/^Based in /,''))}
  </div>
</header>
${data.sections.map(s => `<section><h2>${esc(s.label)}</h2>${s.entries.map(entry).join('')}</section>`).join('')}
</body></html>`;
  // Loaded from a file so the page may read the local Inter font
  const tmp = path.join(os.tmpdir(), 'cv-print.html');
  fs.writeFileSync(tmp, html);
  const p = await b.newPage();
  await p.goto('file://' + tmp, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.pdf({ path: ROOT + '/cv.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true });
  await b.close();
  console.log('cv.pdf written;', data.sections.map(s => s.label + ':' + s.entries.length).join(' '));
})();
