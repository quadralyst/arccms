/*
 * The screenshot tabs of Arc CMS's own marketing home page
 * (docs/examples/arc-cms-home.html). Copy it to src/custom/site/assets/ with the
 * page; the page loads it as /site/arc-cms-home.js.
 *
 * A click shows that tab. The active tab's bar fills in 5 seconds (the
 * progressBarAnimation in arc-cms-home.css), then the next tab shows, round and round.
 */
(function () {
    'use strict';

    function start() {
        var buttons = Array.prototype.slice.call(document.querySelectorAll('.screenshot-tabs .tab-btn'));
        if (!buttons.length) return;

        function show(index) {
            buttons.forEach(function (button, i) {
                var active = i === index;
                button.classList.toggle('active', active);
                button.setAttribute('aria-selected', active ? 'true' : 'false');
                var panel = document.getElementById('tab-' + button.getAttribute('data-tab'));
                if (panel) panel.classList.toggle('active', active);
                // Restart the bar's animation on the tab that becomes active.
                var bar = button.querySelector('.tab-progress-bar');
                if (bar && active) {
                    bar.style.animation = 'none';
                    void bar.offsetWidth;
                    bar.style.animation = '';
                }
            });
        }

        buttons.forEach(function (button, i) {
            button.setAttribute('type', 'button');
            button.setAttribute('role', 'tab');
            button.addEventListener('click', function () { show(i); });
            var bar = button.querySelector('.tab-progress-bar');
            if (bar) {
                bar.addEventListener('animationend', function () {
                    if (button.classList.contains('active')) show((i + 1) % buttons.length);
                });
            }
        });
        show(Math.max(0, buttons.findIndex(function (b) { return b.classList.contains('active'); })));
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
