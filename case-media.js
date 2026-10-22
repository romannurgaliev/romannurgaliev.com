// Case pages: two kinds of carousels (styles in style.css).
// .case-carousel — half-size screens in a deck, with a counter and arrows.
// .case-gallery  — full-width screens on a scroll-snap track, arrows above.
(function () {
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // Left / right arrow keys move a carousel while focus is inside it
  function arrowKeys(root, go) {
    root.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowLeft') { go(-1); event.preventDefault(); }
      if (event.key === 'ArrowRight') { go(1); event.preventDefault(); }
    });
  }

  // ---------- Card carousel ----------
  function initCarousel(figure) {
    var slides = Array.prototype.slice.call(figure.querySelectorAll('.case-carousel-slide'));
    var stage = figure.querySelector('.case-carousel-stage');
    var caption = figure.querySelector('figcaption');
    var current = figure.querySelector('[data-current]');
    var prev = figure.querySelector('[data-prev]');
    var next = figure.querySelector('[data-next]');
    var count = slides.length;
    var index = 0;

    figure.setAttribute('data-count', count);

    function render() {
      slides.forEach(function (slide, i) {
        var offset = i - index;
        slide.style.setProperty('--offset', Math.max(offset, 0));
        slide.style.zIndex = count - Math.abs(offset);
        slide.classList.toggle('is-before', offset < 0);
        slide.classList.toggle('is-next', offset === 1);
        slide.classList.toggle('is-far', offset > 2);
        // Only the front card is read out and reachable by keyboard
        slide.setAttribute('aria-hidden', offset === 0 ? 'false' : 'true');
        slide.inert = offset !== 0;
      });
      if (current) current.textContent = pad(index + 1);
      if (caption) caption.textContent = slides[index].getAttribute('data-caption');
      if (prev) prev.disabled = index === 0;
      if (next) next.disabled = index === count - 1;
    }

    function go(step) {
      var target = Math.min(Math.max(index + step, 0), count - 1);
      if (target === index) return;
      index = target;
      render();
    }

    if (prev) prev.addEventListener('click', function () { go(-1); });
    if (next) next.addEventListener('click', function () { go(1); });

    // Clicking the card peeking out behind brings it forward
    slides.forEach(function (slide, i) {
      slide.addEventListener('click', function () {
        if (i === index + 1) go(1);
      });
    });

    // Swipe on touch screens
    var startX = null;
    stage.addEventListener('pointerdown', function (event) {
      if (event.pointerType !== 'mouse') startX = event.clientX;
    });
    stage.addEventListener('pointerup', function (event) {
      if (startX === null) return;
      var dx = event.clientX - startX;
      if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
      startX = null;
    });
    stage.addEventListener('pointercancel', function () { startX = null; });

    arrowKeys(figure, go);
    render();
  }

  // ---------- Gallery ----------
  function initGallery(figure) {
    var track = figure.querySelector('.case-gallery-track');
    var slides = Array.prototype.slice.call(figure.querySelectorAll('.case-gallery-slide'));
    var prev = figure.querySelector('[data-prev]');
    var next = figure.querySelector('[data-next]');
    var index = 0;

    function centreOf(slide) {
      return slide.offsetLeft + slide.offsetWidth / 2;
    }

    function update() {
      var centre = track.scrollLeft + track.clientWidth / 2;
      var nearest = 0;
      slides.forEach(function (slide, i) {
        if (Math.abs(centreOf(slide) - centre) < Math.abs(centreOf(slides[nearest]) - centre)) {
          nearest = i;
        }
      });
      index = nearest;
      slides.forEach(function (slide, i) {
        slide.classList.toggle('is-active', i === index);
      });
      if (prev) prev.disabled = index === 0;
      if (next) next.disabled = index === slides.length - 1;
    }

    function goTo(i) {
      var slide = slides[i];
      if (!slide) return;
      track.scrollTo({
        left: centreOf(slide) - track.clientWidth / 2,
        behavior: reduceMotion.matches ? 'auto' : 'smooth'
      });
    }

    function go(step) {
      goTo(Math.min(Math.max(index + step, 0), slides.length - 1));
    }

    if (prev) prev.addEventListener('click', function () { go(-1); });
    if (next) next.addEventListener('click', function () { go(1); });

    // Clicking a neighbour peeking at the edge brings it to the centre
    slides.forEach(function (slide, i) {
      slide.addEventListener('click', function () {
        if (i !== index) goTo(i);
      });
    });

    var ticking = false;
    track.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        update();
        ticking = false;
      });
    }, { passive: true });
    window.addEventListener('resize', function () { goTo(index); });

    arrowKeys(figure, go);
    update();
  }

  Array.prototype.forEach.call(document.querySelectorAll('.case-carousel'), initCarousel);
  Array.prototype.forEach.call(document.querySelectorAll('.case-gallery'), initGallery);
})();
