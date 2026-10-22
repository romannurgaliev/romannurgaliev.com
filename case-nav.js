// Case pages:
// 1. The top bar hides while scrolling down and comes back on scroll up.
// 2. A contents list on the left, built from the section headings,
//    marks the section being read (shown from 1240px, see style.css).
(function () {
  var bar = document.querySelector('.sidebar');
  var sections = Array.prototype.slice.call(document.querySelectorAll('.case-section'))
    .filter(function (section) { return section.querySelector('h2'); });

  // ---------- Contents ----------
  var toc = null;
  var links = [];
  // Full-width blocks the contents list steps aside for: galleries and the footer
  var wide = Array.prototype.slice.call(document.querySelectorAll('.case-gallery, .site-footer'));

  function slug(text) {
    return text.toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  if (sections.length > 1) {
    toc = document.createElement('nav');
    toc.className = 'case-toc';
    toc.setAttribute('aria-label', 'On this page');
    var list = document.createElement('ol');

    sections.forEach(function (section) {
      var title = section.querySelector('h2').textContent;
      if (!section.id) section.id = slug(title);

      var item = document.createElement('li');
      var link = document.createElement('a');
      link.href = '#' + section.id;
      link.textContent = title;
      item.appendChild(link);
      list.appendChild(item);
      links.push(link);
    });

    toc.appendChild(list);
    document.body.appendChild(toc);
  }

  function updateToc() {
    if (!toc) return;
    var line = window.innerHeight * 0.4;
    var first = sections[0].getBoundingClientRect();
    var last = sections[sections.length - 1].getBoundingClientRect();

    // Visible once the page has scrolled at least one full screen and a
    // section is on screen, until the last section has scrolled by
    var visible = window.scrollY >= window.innerHeight &&
      first.top < window.innerHeight * 0.6 && last.bottom > line;

    // Step aside while a gallery or the footer passes under the list
    var band = toc.getBoundingClientRect();
    wide.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < band.bottom && r.bottom > band.top) visible = false;
    });
    toc.classList.toggle('is-visible', visible);

    // Current section: the last one whose top has passed the reading line
    var current = 0;
    sections.forEach(function (section, i) {
      if (section.getBoundingClientRect().top <= line) current = i;
    });
    // At the very bottom, the last section is the current one
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
      current = sections.length - 1;
    }
    links.forEach(function (link, i) {
      if (i === current) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }

  // ---------- Top bar ----------
  var lastY = window.scrollY;

  function updateBar() {
    if (!bar) return;
    var y = window.scrollY;
    var delta = y - lastY;
    // Ignore tiny jitters (trackpads, iOS bounce)
    if (Math.abs(delta) > 4) {
      bar.classList.toggle('is-hidden', delta > 0 && y > bar.offsetHeight);
      lastY = y;
    }
    if (y <= 0) bar.classList.remove('is-hidden');
  }

  if (bar) {
    // Keyboard users tabbing into the bar always see it
    bar.addEventListener('focusin', function () {
      bar.classList.remove('is-hidden');
    });
  }

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      updateBar();
      updateToc();
      ticking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  updateToc();
})();
