// Fades cards in as they scroll into view.
document.addEventListener('DOMContentLoaded', function () {
    var cards = document.querySelectorAll('.card');
    if (!('IntersectionObserver' in window)) return;
    var seen = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (entry.isIntersecting) { entry.target.style.opacity = 1; seen.unobserve(entry.target); }
        });
    });
    cards.forEach(function (card) { card.style.opacity = 0; card.style.transition = 'opacity .6s'; seen.observe(card); });
});
