// Mechanical site checks for the periodic audit (see .claude/skills/audit).
// Catches what drifts after many small edits: broken file references,
// orphaned images, copies of shared markup that no longer match,
// pager order, image attributes, CSS rules from CLAUDE.md, stale sitemap.
//
//   node scripts/audit.js        (or: npm run audit)
//
// Exit code 1 if anything is found. No dependencies.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const exists = f => fs.existsSync(path.join(root, f));

const problems = [];
const report = (file, msg) => problems.push(`${file}: ${msg}`);

const cases = fs.readdirSync(path.join(root, 'work'))
  .filter(f => f.endsWith('.html'))
  .map(f => `work/${f}`);
const pages = ['index.html', '404.html', ...cases];
const html = Object.fromEntries(pages.map(p => [p, read(p)]));

// Visible text and attributes without scripts, styles and comments
const strip = s => s
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<!--[\s\S]*?-->/g, '');

const tags = (s, name) => [...strip(s).matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map(m => m[0]);
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}=("([^"]*)"|'([^']*)')`));
  return m ? (m[2] ?? m[3]) : null;
};
const block = (s, re) => (s.match(re) || [])[0] || '';

// ---------- 1. Every local file reference exists ----------
const resolve = (page, ref) => {
  ref = ref.split('#')[0].split('?')[0];
  if (!ref || /^(https?:|mailto:|tel:|data:|\/\/)/.test(ref)) return null;
  if (ref.startsWith('/')) return ref.slice(1) || 'index.html';
  return path.posix.normalize(path.posix.join(path.posix.dirname(page), ref));
};

const referenced = new Set();
for (const [page, s] of Object.entries(html)) {
  const refs = [];
  for (const t of strip(s).match(/<[a-z][^>]*>/g) || []) {
    for (const a of ['src', 'href', 'poster']) {
      const v = attr(t, a);
      if (v) refs.push(v);
    }
    const srcset = attr(t, 'srcset');
    if (srcset && !srcset.startsWith('data:')) srcset.split(',').forEach(c => refs.push(c.trim().split(/\s+/)[0]));
    const icons = attr(t, 'data-icons');
    if (icons) refs.push(icons);
  }
  for (const ref of refs) {
    const f = resolve(page, ref);
    if (f === null) continue;
    const target = f.endsWith('/') ? f.slice(0, -1) : f;
    referenced.add(target);
    if (!exists(target)) report(page, `missing file ${ref}`);
  }
}

// ---------- 2. Images and videos nobody uses ----------
const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(d =>
  d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`]);
const ignored = f => {
  try { execSync(`git check-ignore -q "${f}"`, { cwd: root }); return true; } catch { return false; }
};
const simIcons = [...referenced].filter(r => !path.extname(r));
for (const f of walk('work/images')) {
  if (!/\.(webp|png|jpe?g|svg|mp4|gif)$/.test(f) || ignored(f)) continue;
  if (referenced.has(f) || simIcons.some(d => f.startsWith(d + '/'))) continue;
  report(f, 'not used on any page (delete it, or keep the source outside the repo)');
}
for (const f of walk('work/images')) {
  if (/\.gif$/.test(f)) report(f, 'GIF: animations must be looping video (CLAUDE.md)');
}

// ---------- 3. Image and video attributes ----------
const webpSize = file => {
  const b = fs.readFileSync(path.join(root, file));
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  }
  if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  return null;
};
const isAnimatedWebp = file => {
  const b = fs.readFileSync(path.join(root, file));
  return b.toString('ascii', 12, 16) === 'VP8X' && (b[20] & 0x02) !== 0;
};

for (const [page, s] of Object.entries(html)) {
  const media = strip(s).match(/<(img|video)\b[^>]*>/g) || [];
  media.forEach((t, i) => {
    const isImg = t.startsWith('<img');
    const name = attr(t, 'src') || attr(t, 'poster') || '(video)';
    for (const a of ['width', 'height']) if (!attr(t, a)) report(page, `${name}: no ${a}`);
    if (isImg && attr(t, 'alt') === null) report(page, `${name}: no alt`);
    if (!isImg && !attr(t, 'aria-label')) report(page, `${name}: video without aria-label`);

    const first = i === 0;
    if (isImg) {
      if (first && attr(t, 'loading') === 'lazy') report(page, `${name}: first image is lazy; use fetchpriority="high"`);
      if (first && attr(t, 'fetchpriority') !== 'high') report(page, `${name}: first image needs fetchpriority="high"`);
      if (!first && attr(t, 'loading') !== 'lazy') report(page, `${name}: not the first image, needs loading="lazy"`);
      if (!first && attr(t, 'fetchpriority')) report(page, `${name}: fetchpriority on an image that isn't first`);
      if (attr(t, 'srcset') && !attr(t, 'sizes')) report(page, `${name}: srcset without sizes`);
    } else {
      const w = +attr(t, 'width'), h = +attr(t, 'height');
      if (w % 2 || h % 2) report(page, `${name}: video width and height must be even`);
      for (const a of ['data-loop', 'muted', 'loop', 'playsinline']) {
        if (!new RegExp(`\\s${a}[\\s>=]`).test(t)) report(page, `${name}: video without ${a}`);
      }
      if (attr(t, 'preload') !== 'none') report(page, `${name}: video should have preload="none"`);
    }

    // Declared size vs the file itself, and srcset widths vs file names
    const src = attr(t, 'src') || attr(t, 'poster');
    const f = src && resolve(page, src);
    if (f && f.endsWith('.webp') && exists(f)) {
      const size = webpSize(f);
      if (isAnimatedWebp(f)) report(page, `${src}: animated webp; use looping video (CLAUDE.md)`);
      if (size) {
        const [fw, fh] = size;
        const ratio = Math.abs(fw / fh - attr(t, 'width') / attr(t, 'height'));
        if (ratio > 0.01) report(page, `${src}: width/height ${attr(t, 'width')}×${attr(t, 'height')} don't match the file's shape ${fw}×${fh}`);
      }
    }
    const srcset = attr(t, 'srcset');
    if (srcset) for (const c of srcset.split(',')) {
      const [u, w] = c.trim().split(/\s+/);
      const uf = resolve(page, u);
      if (!uf || !exists(uf) || !w) continue;
      const size = webpSize(uf);
      if (size && size[0] !== parseInt(w)) report(page, `${u}: srcset says ${w}, file is ${size[0]}px wide`);
    }
  });

  // Each video source exists in both codecs
  for (const v of strip(s).match(/<video\b[\s\S]*?<\/video>/g) || []) {
    const sources = v.match(/<source\b[^>]*>/g) || [];
    const av1 = sources.find(x => /av01/.test(x));
    if (!av1 || sources.length < 2) report(page, `video ${attr(v, 'poster')}: needs AV1 first and an H.264 fallback`);
  }
}

// ---------- 4. Shared markup is the same everywhere ----------
const normalise = s => s.replace(/\s+/g, ' ').replace(/(href|src)="(?:\.\.\/|\/)?(?!https?:)/g, '$1="/').trim();

const sidebarOf = s => normalise(block(s, /<aside class="sidebar[\s\S]*?<\/aside>/)
  .replace(/ class="active"( aria-current="true")?/g, '')
  .replace(/href="#(home|cv|contact)"/g, (m, id) => `href="/${id === 'home' ? '' : '#' + id}"`));
const footerOf = s => normalise(block(s, /<footer class="site-footer[\s\S]*?<\/footer>/));
const headOf = s => normalise(block(s, /<head>[\s\S]*?<\/head>/)
  .replace(/<title>.*?<\/title>/, '')
  .replace(/<meta (name|property)="(description|og:title|og:description|og:url|og:type|robots)"[^>]*>/g, '')
  .replace(/<link rel="canonical"[^>]*>/, '')
  .replace(/<link rel="stylesheet" href="[^"]*risk-sim\.css">/, ''));

const compare = (label, fn, list) => {
  const ref = fn(html[list[0]]);
  for (const p of list.slice(1)) {
    const v = fn(html[p]);
    if (!v) report(p, `${label} is missing`);
    else if (v !== ref) report(p, `${label} differs from ${list[0]}`);
  }
};
compare('sidebar', sidebarOf, pages);
compare('footer', footerOf, cases);
compare('<head> (shared part)', headOf, ['index.html', ...cases]);
// 404 has no OG tags on purpose; the rest of its head must match
const headCore = s => headOf(s).replace(/<meta property="og:[^>]*>|<meta name="twitter:[^>]*>/g, '').replace(/\s+/g, ' ');
if (headCore(html['404.html']) !== headCore(html['index.html'])) report('404.html', '<head> differs from index.html (beyond OG tags)');

// Case pages: title, canonical and og:url agree with the file
for (const p of cases) {
  const s = html[p];
  const url = `https://romannurgaliev.com/${p}`;
  const canon = (s.match(/<link rel="canonical" href="([^"]*)"/) || [])[1];
  const og = (s.match(/<meta property="og:url" content="([^"]*)"/) || [])[1];
  if (canon !== url) report(p, `canonical is ${canon}, expected ${url}`);
  if (og !== url) report(p, `og:url is ${og}, expected ${url}`);
  const d = (s.match(/<meta name="description" content="([^"]*)"/) || [])[1];
  const od = (s.match(/<meta property="og:description" content="([^"]*)"/) || [])[1];
  if (d !== od) report(p, 'description and og:description differ');
  const t = (s.match(/<title>([^<]*)<\/title>/) || [])[1];
  const ot = (s.match(/<meta property="og:title" content="([^"]*)"/) || [])[1];
  if (t !== ot) report(p, 'title and og:title differ');
}

// ---------- 5. Pager follows the home card order ----------
const order = [...html['index.html'].matchAll(/<a class="case-card" href="([^"]+)"/g)].map(m => m[1]);
order.forEach((href, i) => {
  const p = href;
  if (!html[p]) return report('index.html', `card links to missing ${href}`);
  const s = html[p];
  const prev = (s.match(/case-pager-prev" href="([^"]+)"/) || [])[1];
  const next = (s.match(/case-pager-next" href="([^"]+)"/) || [])[1];
  const want = j => order[j] && path.posix.basename(order[j]);
  if (prev !== want(i - 1)) report(p, `pager Previous is ${prev}, expected ${want(i - 1)}`);
  if (next !== want(i + 1)) report(p, `pager Up next is ${next}, expected ${want(i + 1)}`);
});
for (const p of cases) if (!order.includes(p)) report(p, 'has no card on the home page');

// ---------- 6. Accessibility and links ----------
for (const [page, s] of Object.entries(html)) {
  for (const t of tags(s, 'nav')) if (!attr(t, 'aria-label')) report(page, 'a <nav> without aria-label');
  for (const t of tags(s, 'a')) {
    if (attr(t, 'target') === '_blank' && !/noopener/.test(attr(t, 'rel') || '')) report(page, `${attr(t, 'href')}: target=_blank without rel=noopener`);
  }
  for (const t of tags(s, 'iframe')) if (!attr(t, 'title')) report(page, 'an <iframe> without title');
  if (!/class="skip-link" href="#main"/.test(s)) report(page, 'no skip link');
  if (!/<main[^>]*id="main"/.test(s)) report(page, 'no <main id="main">');
  const h1 = (strip(s).match(/<h1\b/g) || []).length;
  if (h1 !== 1) report(page, `${h1} h1 elements`);

  // Typography: straight quotes in visible text (curly ones are the house style)
  const text = strip(s).replace(/<[^>]+>/g, ' ');
  const straight = text.match(/[A-Za-z]'[A-Za-z]|"[A-Za-z]/g);
  if (straight) report(page, `straight quote or apostrophe in text: ${[...new Set(straight)].slice(0, 5).join(' ')} (use ’ “ ”)`);
  for (const t of strip(s).match(/(alt|aria-label|data-caption|title|content)="[^"]*'[^"]*"/g) || []) {
    report(page, `straight apostrophe in an attribute: ${t.slice(0, 70)}…`);
  }
}

// ---------- 7. style.css rules from CLAUDE.md ----------
const css = read('style.css');
const rootEnd = css.indexOf('}', css.indexOf(':root {'));
// Comments blanked out but newlines kept, so line numbers stay right
const blank = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
const body = blank(css.slice(rootEnd));
const lineOf = i => css.slice(0, rootEnd + i).split('\n').length;
const cssRule = (re, msg) => { for (const m of body.matchAll(re)) report(`style.css:${lineOf(m.index)}`, `${msg}: ${m[0].trim()}`); };

cssRule(/#[0-9a-fA-F]{3,8}\b(?![\w-])|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(white|black)\b(?=\s*[;,)])/g, 'hardcoded colour outside :root');
cssRule(/text-transform:\s*uppercase/g, 'uppercase');
cssRule(/font-weight:[ \t]*(?![ \t]|400|500|inherit)[^;]+/g, 'weight other than 400/500');
cssRule(/letter-spacing:[ \t]*(?![ \t]|var\(--ls-|inherit|0[;\s]|normal)[^;]+/g, 'letter-spacing outside the tokens');
// html { font-size: 16px } stays until the scale moves to rem (CLAUDE.md, Later)
cssRule(/font-size:[ \t]*(?![ \t]|var\(--fs-|inherit|16px;\s*-webkit-text-size-adjust)[^;]+/g, 'font-size outside the type scale');

// Font sizes may only be set inside the Type roles block (and the one phone override)
const rolesStart = css.indexOf('Type roles');
const rolesEnd = css.indexOf('/* ====', css.indexOf('*/', rolesStart) + 2);
for (const m of css.matchAll(/font-size:\s*var\(--fs-[a-z]+\)/g)) {
  if (m.index > rolesStart && m.index < rolesEnd) continue;
  const before = css.slice(Math.max(0, m.index - 400), m.index);
  if (/compact bar keeps M|first screen is set in M/.test(before) || /^body\s*\{/m.test(css.slice(m.index - 200, m.index))) continue;
  report(`style.css:${css.slice(0, m.index).split('\n').length}`, 'font-size set on a component, not in Type roles');
}

// Class selectors nobody uses
const code = Object.values(html).join('\n') + ['case-media.js', 'case-nav.js', 'copy-email.js'].map(read).join('\n');
const classes = new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-zA-Z][\w-]*)(?=[^{}]*\{)/g)].map(m => m[1]));
for (const c of classes) {
  if (!new RegExp(`[\\s"'.]${c}(?![\\w-])`).test(code)) report('style.css', `.${c} is not used in any page or script`);
}

// Same selector defined twice at the top level (outside media queries)
{
  let depth = 0, top = '', seen = new Map();
  const flat = blank(css);
  let buf = '';
  for (let i = 0; i < flat.length; i++) {
    const ch = flat[i];
    if (ch === '{') {
      if (depth === 0) {
        top = buf.trim();
        // The Type roles block sets only the type; components add the rest
        const inRoles = i > rolesStart && i < rolesEnd;
        if (!top.startsWith('@') && top !== ':root' && !inRoles) {
          const key = top.replace(/\s+/g, ' ');
          if (seen.has(key)) report(`style.css:${flat.slice(0, i).split('\n').length}`, `"${key}" is also defined at line ${seen.get(key)}; merge them`);
          else seen.set(key, flat.slice(0, i).split('\n').length);
        }
      }
      depth++; buf = '';
    } else if (ch === '}') { depth--; buf = ''; }
    else if (ch === ';' && depth > 0) buf = '';
    else buf += ch;
  }
}

// ---------- 8. sitemap.xml is up to date ----------
const sitemap = read('sitemap.xml');
for (const p of ['index.html', ...cases]) {
  const loc = p === 'index.html' ? 'https://romannurgaliev.com/' : `https://romannurgaliev.com/${p}`;
  const m = sitemap.match(new RegExp(`<loc>${loc.replace(/[.]/g, '\\.')}</loc>\\s*<lastmod>([^<]+)</lastmod>`));
  if (!m) { report('sitemap.xml', `no entry for ${p}`); continue; }
  let changed;
  try {
    const dirty = execSync(`git status --porcelain -- "${p}"`, { cwd: root }).toString().trim();
    changed = dirty ? new Date().toLocaleDateString('sv')
      : execSync(`git log -1 --format=%cs -- "${p}"`, { cwd: root }).toString().trim();
  } catch { continue; }
  if (changed && m[1] < changed) report('sitemap.xml', `${p} lastmod ${m[1]}, page changed ${changed}`);
}

// ---------- 9. CV PDF is newer than the CV ----------
try {
  const cvChanged = execSync('git log -1 --format=%ct -G"cv-entry|cv-section" -- index.html', { cwd: root }).toString().trim();
  const pdfChanged = execSync('git log -1 --format=%ct -- cv.pdf', { cwd: root }).toString().trim();
  if (+cvChanged > +pdfChanged) report('cv.pdf', 'older than the last CV edit in index.html; run node scripts/cv-pdf.js');
} catch {}

// ---------- Result ----------
if (problems.length) {
  console.log(`${problems.length} problem(s):\n`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('Audit: all mechanical checks pass.');
