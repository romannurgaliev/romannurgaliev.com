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

  // Stops the browser's own image drag, and swallows the click that
  // follows a mouse drag so it doesn't also jump to a slide
  function noDragClicks(root, wasDrag) {
    root.addEventListener('dragstart', function (event) { event.preventDefault(); });
    root.addEventListener('click', function (event) {
      if (wasDrag()) {
        event.stopPropagation();
        event.preventDefault();
      }
    }, true);
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

    // Swipe on touch screens, drag with a held mouse button
    var startX = null;
    var dragged = false;
    stage.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      startX = event.clientX;
      dragged = false;
    });
    // Capture the mouse only once it moves, so a plain click still
    // reaches the card under it
    stage.addEventListener('pointermove', function (event) {
      if (startX === null || event.pointerType !== 'mouse') return;
      if (Math.abs(event.clientX - startX) > 6 && !stage.classList.contains('is-dragging')) {
        stage.classList.add('is-dragging');
        stage.setPointerCapture(event.pointerId);
      }
    });
    function endSwipe(event) {
      if (startX === null) return;
      var dx = event.clientX - startX;
      if (Math.abs(dx) > 6) dragged = true;
      if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
      startX = null;
      stage.classList.remove('is-dragging');
    }
    stage.addEventListener('pointerup', endSwipe);
    stage.addEventListener('pointercancel', function () {
      startX = null;
      stage.classList.remove('is-dragging');
    });
    noDragClicks(stage, function () { return dragged; });

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

    // Drag with a held mouse button. Touch and trackpads scroll natively.
    // Snapping is paused while the track follows the cursor, then the
    // nearest slide in the drag direction is scrolled to the centre.
    var drag = null;
    var dragged = false;
    var snapTimer = null;

    function restoreSnap() {
      clearTimeout(snapTimer);
      track.removeEventListener('scrollend', restoreSnap);
      track.style.scrollSnapType = '';
    }

    track.addEventListener('pointerdown', function (event) {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      restoreSnap();
      drag = {
        x: event.clientX,
        left: track.scrollLeft,
        from: index,
        lastX: event.clientX,
        lastT: event.timeStamp,
        v: 0
      };
      dragged = false;
    });

    track.addEventListener('pointermove', function (event) {
      if (!drag) return;
      var dx = event.clientX - drag.x;
      if (!dragged && Math.abs(dx) < 6) return;
      if (!dragged) {
        dragged = true;
        track.style.scrollSnapType = 'none';
        track.classList.add('is-dragging');
        // Captured only now, so a plain click still reaches a slide
        track.setPointerCapture(event.pointerId);
      }
      var dt = event.timeStamp - drag.lastT;
      if (dt > 0) drag.v = (event.clientX - drag.lastX) / dt;
      drag.lastX = event.clientX;
      drag.lastT = event.timeStamp;
      track.scrollLeft = drag.left - dx;
    });

    function endDrag(event) {
      if (!drag) return;
      var d = drag;
      drag = null;
      if (!dragged) return;
      track.classList.remove('is-dragging');
      var dx = d.lastX - d.x;
      var fresh = event.timeStamp - d.lastT < 100;
      var flick = fresh && Math.abs(d.v) > 0.4;
      var far = Math.abs(dx) > slides[d.from].offsetWidth * 0.15;
      // A long drag lands on the nearest slide; a short one or a flick
      // still moves one step in the drag direction
      var target = index;
      if (target === d.from && (flick || far)) target += dx < 0 ? 1 : -1;
      target = Math.min(Math.max(target, 0), slides.length - 1);
      goTo(target);
      // Put snapping back once the smooth scroll settles
      requestAnimationFrame(function () {
        track.addEventListener('scrollend', restoreSnap);
      });
      snapTimer = setTimeout(restoreSnap, 800);
    }
    track.addEventListener('pointerup', endDrag);
    track.addEventListener('pointercancel', endDrag);
    noDragClicks(track, function () { return dragged; });

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

  // ---------- Looping screen recordings ----------
  // <video data-loop> replaces animated webp at a fraction of the weight.
  // Nothing downloads until the video nears the window (preload="none");
  // it plays while in view and pauses when scrolled away. With reduced
  // motion it never plays, and the poster stays as a still screen.
  function initLoops() {
    var videos = Array.prototype.slice.call(document.querySelectorAll('video[data-loop]'));
    if (!videos.length || !window.IntersectionObserver) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var video = entry.target;
        if (entry.isIntersecting && !reduceMotion.matches) {
          var played = video.play();
          // Autoplay can still be refused (Low Power Mode); the poster stays
          if (played && played.catch) played.catch(function () {});
        } else {
          video.pause();
        }
      });
    }, { rootMargin: '200px 0px' });

    videos.forEach(function (video) { observer.observe(video); });

    reduceMotion.addEventListener('change', function () {
      if (reduceMotion.matches) videos.forEach(function (video) { video.pause(); });
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.case-carousel'), initCarousel);
  Array.prototype.forEach.call(document.querySelectorAll('.case-gallery'), initGallery);
  initLoops();
})();
