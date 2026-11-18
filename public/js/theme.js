/* Scroll-reveal for the Fancy Raccoon storefront (progressive enhancement). */
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;

  var targets = document.querySelectorAll('.section, .hero-copy, .hero-visual, .compare-card, .contact-card, .footer-grid');

  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
  );

  targets.forEach(function (el, i) {
    el.classList.add('reveal');
    if (i % 4) el.setAttribute('data-d', String(i % 4));
    // anything already in view on load plays immediately
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) {
      el.classList.add('in');
    } else {
      io.observe(el);
    }
  });

  // failsafe: never leave content un-animated or hidden if the observer is throttled
  setTimeout(function () {
    targets.forEach(function (el) { el.classList.add('in'); });
  }, 2500);
})();
