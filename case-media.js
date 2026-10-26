// Case pages: two kinds of carousels (styles in style.css).
// .case-carousel — half-size screens in a deck, with a counter and arrows.
// .case-gallery  — full-width screens on a scroll-snap track, arrows above.
// Also: smooth open / close for .case-details, and full-screen view for img[data-zoom].
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

    function goTo(i, instant) {
      var slide = slides[i];
      if (!slide) return;
      track.scrollTo({
        left: centreOf(slide) - track.clientWidth / 2,
        behavior: instant ? 'instant' : reduceMotion.matches ? 'auto' : 'smooth'
      });
    }

    function go(step) {
      goTo(Math.min(Math.max(index + step, 0), slides.length - 1));
    }

    if (prev) prev.addEventListener('click', function () { go(-1); });
    if (next) next.addEventListener('click', function () { go(1); });
    // After the full-screen view closes, the gallery jumps to the screen
    // seen last
    figure.addEventListener('gallery-go', function (event) {
      goTo(event.detail, true);
      update();
    });

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

  // ---------- Collapsible details ----------
  // A <details> opens and closes in one frame. Here a click animates the
  // panel's height and fades the list in, so the page below glides instead
  // of jumping. A second click mid-animation turns it around smoothly.
  // With reduced motion (or no Web Animations) it toggles as usual.
  function initDetails(details) {
    var summary = details.querySelector('summary');
    var body = summary.nextElementSibling;
    var heightAnim = null;
    var bodyAnim = null;
    var closing = false;

    summary.addEventListener('click', function (event) {
      if (reduceMotion.matches || !details.animate) return;
      event.preventDefault();

      // Start from the height on screen right now, even mid-animation
      var from = details.offsetHeight;
      var open = closing || !details.open;
      if (heightAnim) heightAnim.cancel();
      if (bodyAnim) bodyAnim.cancel();

      details.open = true;
      closing = !open;
      // The icon follows the click at once, not the end of the animation
      details.classList.toggle('is-closing', closing);
      var to = open ? details.offsetHeight : summary.offsetHeight;
      details.style.overflow = 'hidden';

      heightAnim = details.animate(
        { height: [from + 'px', to + 'px'] },
        open
          ? { duration: 380, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
          : { duration: 280, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
      );
      if (body) {
        bodyAnim = body.animate(
          open
            ? { opacity: [0, 1], transform: ['translateY(-6px)', 'none'] }
            : { opacity: [1, 0], transform: ['none', 'translateY(-6px)'] },
          open
            ? { duration: 320, delay: 60, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'backwards' }
            : { duration: 160, easing: 'ease-in', fill: 'forwards' }
        );
      }

      heightAnim.onfinish = function () {
        if (closing) details.open = false;
        closing = false;
        details.classList.remove('is-closing');
        details.style.overflow = '';
        heightAnim = null;
        if (bodyAnim) { bodyAnim.cancel(); bodyAnim = null; }
      };
    });
  }

  // ---------- Full-screen view ----------
  // Any img[data-zoom] opens full screen on click, Enter or Space.
  // One shared <dialog>: showModal() traps focus, Esc closes it, and the
  // page behind becomes inert. A click anywhere but the arrows closes it;
  // in a gallery, the arrows and arrow keys step through its screens.
  function largestSource(img) {
    var best = img.currentSrc || img.src;
    var bestW = 0;
    (img.getAttribute('srcset') || '').split(',').forEach(function (part) {
      var bits = part.trim().split(/\s+/);
      var w = parseInt(bits[1], 10);
      if (bits[0] && w > bestW) { best = bits[0]; bestW = w; }
    });
    // srcset paths are relative to the page; resolve them the same way
    return new URL(best, document.baseURI).href;
  }

  function captionFor(img) {
    var slide = img.closest('.case-gallery-slide');
    var el = slide ? slide.querySelector('.case-gallery-caption')
                   : img.closest('figure') && img.closest('figure').querySelector('figcaption');
    return el ? el.textContent.trim() : '';
  }

  function ownSource(img) {
    var own = img.getAttribute('data-zoom');
    return own ? new URL(own, document.baseURI).href : '';
  }

  function initZoom() {
    var images = document.querySelectorAll('img[data-zoom]');
    if (!images.length || typeof HTMLDialogElement !== 'function') return;

    var arrow = function (cls, label, path) {
      return '<button type="button" class="case-arrow ' + cls + '" aria-label="' + label + '">' +
        '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="' + path + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</button>';
    };

    var dialog = document.createElement('dialog');
    dialog.className = 'zoom';
    dialog.tabIndex = -1;
    dialog.setAttribute('aria-label', 'Full-screen view');
    dialog.innerHTML =
      arrow('zoom-close', 'Close full-screen view', 'M5 5l10 10M15 5L5 15') +
      arrow('zoom-prev', 'Previous screen', 'M16 10H4M9 5l-5 5 5 5') +
      arrow('zoom-next', 'Next screen', 'M4 10h12M11 5l5 5-5 5') +
      '<div class="zoom-stage"><img class="zoom-img" alt="" decoding="async"></div>' +
      '<p class="zoom-caption"></p>';
    document.body.appendChild(dialog);

    var stage = dialog.querySelector('.zoom-stage');
    var big = dialog.querySelector('.zoom-img');   // the screen in view
    var caption = dialog.querySelector('.zoom-caption');
    var prev = dialog.querySelector('.zoom-prev');
    var next = dialog.querySelector('.zoom-next');
    var opener = null;   // the picture on the page now shown full screen
    var moving = false;  // a slide transition is running
    var set = [];        // its gallery's pictures, or just itself
    var pos = 0;

    function fitMode() {
      return dialog.classList.contains('zoom--fit');
    }

    // Room for a gallery screen: the window minus padding and the caption
    function room() {
      var style = getComputedStyle(dialog);
      var h = dialog.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (!caption.hidden) h -= caption.offsetHeight + parseFloat(style.rowGap || 0);
      return {
        w: dialog.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        h: h
      };
    }

    // Own pictures differ in width; one scale (1.5 file pixels per screen
    // pixel) keeps neighbouring slides the same size
    function widest(el, own) {
      return own ? el.naturalWidth / 1.5 : 1600;
    }

    function fitWidth(el, own) {
      var r = room();
      return Math.floor(Math.min(widest(el, own), r.w, r.h * el.naturalWidth / el.naturalHeight));
    }

    // Gallery screens fit the window whole: no scrolling, and the arrows
    // step through them. The stage takes all the height, so the caption
    // stays put whatever the screen's proportions. A single tall screen
    // fills the width and scrolls.
    function layout() {
      var own = opener && ownSource(opener);
      stage.style.height = '';
      big.style.width = big.style.maxWidth = '';
      if (!fitMode()) {
        if (big.naturalWidth) big.style.maxWidth = Math.round(widest(big, own)) + 'px';
        return;
      }
      stage.style.height = room().h + 'px';
      if (!big.naturalWidth) return;
      big.style.width = fitWidth(big, own) + 'px';
      big.style.maxWidth = 'none';
    }

    function setArrows() {
      prev.disabled = pos === 0;
      next.disabled = pos === set.length - 1;
    }

    function setCaption(img) {
      caption.textContent = captionFor(img);
      caption.hidden = !caption.textContent;
    }

    function show(img) {
      opener = img;
      // data-zoom="file" names a picture just for this view: the gallery
      // screens bake in a grey frame that the dark scrim makes redundant,
      // so they open as the white card alone
      var own = ownSource(img);
      if (own) {
        big.src = own;
      } else {
        // Show the copy already on the page at once, then swap in the
        // largest one when it has loaded, so there's never an empty frame
        var large = largestSource(img);
        big.src = img.currentSrc || img.src;
        if (large !== big.src) {
          var loader = new Image();
          loader.onload = function () {
            if (opener === img) big.src = large;
          };
          loader.src = large;
        }
      }
      // Alt text only once the picture is in, so a slow load shows an empty
      // space of the right size rather than a line of text
      big.alt = '';
      big.onload = function () {
        big.alt = img.alt;
        layout();
      };
      setCaption(img);
      setArrows();
      if (big.complete) layout();
    }

    function open(img) {
      var gallery = img.closest('.case-gallery');
      set = gallery ? Array.prototype.slice.call(gallery.querySelectorAll('img[data-zoom]')) : [img];
      pos = Math.max(set.indexOf(img), 0);
      dialog.classList.toggle('zoom--fit', !!gallery);
      prev.hidden = next.hidden = set.length < 2;
      show(img);
      dialog.showModal();
      // Focus the view itself, not the close button, so no focus ring
      // appears around a button nobody pressed; Tab still reaches them
      dialog.focus();
      layout();
    }

    // Like a carousel: the next screen is loaded and decoded off-screen
    // first, then both move together, the current one out the far side
    // and the next one in from the near side, with no fade and no gap.
    // The caption cross-fades. With reduced motion it simply swaps.
    function step(by) {
      var to = pos + by;
      if (to < 0 || to >= set.length || moving) return;
      var img = set[to];
      pos = to;
      setArrows();
      if (reduceMotion.matches || !big.animate || typeof Promise !== 'function') {
        show(img);
        return;
      }
      moving = true;
      var own = !!ownSource(img);
      var incoming = document.createElement('img');
      incoming.className = 'zoom-img zoom-img--incoming';
      incoming.alt = img.alt;
      var ready = new Promise(function (done) {
        incoming.onload = incoming.onerror = done;
        incoming.src = ownSource(img) || largestSource(img);
      }).then(function () {
        // decode() keeps the first frame from stuttering; capped, since it
        // never settles in a background tab
        if (!incoming.decode) return null;
        return Promise.race([
          incoming.decode().catch(function () {}),
          new Promise(function (done) { setTimeout(done, 250); })
        ]);
      });
      var capOut = caption.animate([{ opacity: 1 }, { opacity: 0 }],
        { duration: 160, easing: 'ease-in', fill: 'forwards' });

      ready.then(function () {
        if (!dialog.open) { moving = false; return; }
        var old = big;
        var w = fitWidth(incoming, own);
        var h = w * incoming.naturalHeight / incoming.naturalWidth;
        incoming.style.width = w + 'px';
        incoming.style.maxWidth = 'none';
        incoming.style.marginLeft = -w / 2 + 'px';
        incoming.style.marginTop = -h / 2 + 'px';
        // Far enough that each screen is fully outside the window at its end
        var far = (dialog.clientWidth + Math.max(w, old.offsetWidth)) / 2 + 24;
        var timing = { duration: 560, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' };
        stage.appendChild(incoming);
        old.animate([
          { transform: 'translateX(0)' },
          { transform: 'translateX(' + -by * far + 'px)' }
        ], { duration: timing.duration, easing: timing.easing, fill: 'forwards' });
        var slide = incoming.animate([
          { transform: 'translateX(' + by * far + 'px)' },
          { transform: 'translateX(0)' }
        ], timing);

        setCaption(img);
        capOut.cancel();
        caption.animate([{ opacity: 0 }, { opacity: 1 }],
          { duration: 280, delay: 140, easing: 'ease-out', fill: 'backwards' });

        slide.finished.then(function () {
          // The incoming screen stays the same element and takes the old
          // one's place in the layout, so nothing is redrawn at the end
          old.remove();
          incoming.classList.remove('zoom-img--incoming');
          incoming.style.marginLeft = incoming.style.marginTop = '';
          big = incoming;
          opener = img;
          moving = false;
          layout();
        });
      });
    }

    prev.addEventListener('click', function (event) { event.stopPropagation(); step(-1); });
    next.addEventListener('click', function (event) { event.stopPropagation(); step(1); });
    dialog.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    });
    window.addEventListener('resize', function () { if (dialog.open && !moving) layout(); });

    // Any other click closes: on the picture, the backdrop, or the close button
    dialog.addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('close', function () {
      // The gallery on the page catches up only now, in one jump, so
      // nothing moves behind the scrim while the view is open
      var gallery = opener && opener.closest('.case-gallery');
      if (gallery) gallery.dispatchEvent(new CustomEvent('gallery-go', { detail: pos }));
      // Stop a transition halfway: drop the incoming screen, reset the old
      moving = false;
      Array.prototype.forEach.call(stage.querySelectorAll('.zoom-img--incoming'), function (el) { el.remove(); });
      big.getAnimations().forEach(function (a) { a.cancel(); });
      big.removeAttribute('src');
      big.style.width = big.style.maxWidth = '';
      stage.style.height = '';
      // Back to the picture shown last, without jumping the page
      if (opener) opener.focus({ preventScroll: true });
      opener = null;
    });

    Array.prototype.forEach.call(images, function (img) {
      img.tabIndex = 0;
      img.setAttribute('aria-haspopup', 'dialog');
      img.addEventListener('click', function () {
        // A neighbour peeking at the gallery edge scrolls into place first
        var slide = img.closest('.case-gallery-slide');
        if (slide && !slide.classList.contains('is-active')) return;
        open(img);
      });
      // Fetch the gallery's own pictures on hover, so they're ready by the click
      img.addEventListener('pointerenter', function () {
        var gallery = img.closest('.case-gallery');
        var all = gallery ? gallery.querySelectorAll('img[data-zoom]') : [img];
        Array.prototype.forEach.call(all, function (each) {
          if (ownSource(each)) new Image().src = ownSource(each);
        });
      }, { once: true });
      img.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open(img);
      });
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.case-carousel'), initCarousel);
  Array.prototype.forEach.call(document.querySelectorAll('.case-gallery'), initGallery);
  Array.prototype.forEach.call(document.querySelectorAll('.case-details'), initDetails);
  initLoops();
  initZoom();
})();
