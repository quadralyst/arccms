// Fades cards in as they scroll into view. Runs whether the page is still
// loading (the published page) or already loaded (the preview in npm run dev).
(function () {
    function start() {
        if (!('IntersectionObserver' in window)) return;
        var seen = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) { entry.target.style.opacity = 1; seen.unobserve(entry.target); }
            });
        });
        document.querySelectorAll('.card').forEach(function (card) {
            card.style.opacity = 0;
            card.style.transition = 'opacity .6s';
            seen.observe(card);
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
