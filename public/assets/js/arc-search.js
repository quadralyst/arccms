/**
 * Arc CMS public search widget.
 *
 * Runs on statically published pages, where no Angular bundle is loaded.
 * The publish pipeline replaces <arc-search> in the header partial with a
 * root element carrying data attributes (endpoint, language, strings) and
 * a plain GET form, so search works with JavaScript disabled too. This
 * script adds the type-ahead on top.
 *
 * It talks to the `search` callable directly over fetch using the callable
 * protocol ({ data } in, { result } out), so it needs no Firebase SDK.
 *
 * Spec: docs/search-spec.md, phase S5 item 1.
 */
(function () {
    'use strict';

    var DEBOUNCE_MS = 250;
    var MIN_LENGTH = 2;

    function init(root) {
        var endpoint = root.getAttribute('data-endpoint');
        var input = root.querySelector('.arc-search__input');
        if (!endpoint || !input) return;

        var lang = root.getAttribute('data-lang') || '';
        var resultsUrl = root.getAttribute('data-results-url') || '';
        var limit = parseInt(root.getAttribute('data-limit') || '8', 10) || 8;
        var strings = {
            empty: root.getAttribute('data-empty') || 'No results',
            showingFor: root.getAttribute('data-showing-for') || 'Showing results for "{{term}}"',
            allResults: root.getAttribute('data-all-results') || 'See all results',
        };

        var panel = document.createElement('div');
        panel.className = 'arc-search__panel';
        panel.hidden = true;
        root.appendChild(panel);

        var listId = 'arc-search-list-' + Math.random().toString(36).slice(2, 8);
        var timer = null;
        var ticket = 0;
        var results = [];
        var active = -1;
        var cache = {};

        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('aria-controls', listId);

        function escapeHtml(text) {
            return String(text)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }

        function highlight(text, ranges) {
            if (!text) return '';
            if (!ranges || !ranges.length) return escapeHtml(text);
            var sorted = ranges.slice().sort(function (a, b) { return a[0] - b[0]; });
            var html = '';
            var cursor = 0;
            for (var i = 0; i < sorted.length; i++) {
                var start = sorted[i][0];
                var end = Math.min(sorted[i][1], text.length);
                if (start < cursor || end <= start) continue;
                html += escapeHtml(text.slice(cursor, start));
                html += '<mark>' + escapeHtml(text.slice(start, end)) + '</mark>';
                cursor = end;
            }
            return html + escapeHtml(text.slice(cursor));
        }

        function close() {
            panel.hidden = true;
            input.setAttribute('aria-expanded', 'false');
            active = -1;
        }

        function render(response) {
            results = response.results || [];
            active = -1;
            var html = '';
            if (response.fallbackUsed) {
                html += '<p class="arc-search__note">' + escapeHtml(strings.showingFor.replace('{{term}}', response.fallbackUsed)) + '</p>';
            }
            if (results.length) {
                html += '<ul class="arc-search__list" role="listbox" id="' + listId + '">';
                for (var i = 0; i < results.length; i++) {
                    var r = results[i];
                    html += '<li class="arc-search__item" role="option" id="' + listId + '-' + i + '" data-index="' + i + '">'
                        + '<a class="arc-search__link" href="' + escapeHtml(r.link) + '">'
                        + '<span class="arc-search__title">' + highlight(r.title, r.highlights && r.highlights.title) + '</span>'
                        + (r.badge ? '<span class="arc-search__badge">' + escapeHtml(r.badge) + '</span>' : '')
                        + (r.snippet ? '<span class="arc-search__snippet">' + highlight(r.snippet, r.highlights && r.highlights.snippet) + '</span>' : '')
                        + '</a></li>';
                }
                html += '</ul>';
                if (resultsUrl) {
                    html += '<a class="arc-search__all" href="' + escapeHtml(resultsUrl + '?q=' + encodeURIComponent(input.value.trim())) + '">' + escapeHtml(strings.allResults) + '</a>';
                }
            } else {
                html += '<p class="arc-search__empty">' + escapeHtml(strings.empty) + '</p>';
            }
            panel.innerHTML = html;
            panel.hidden = false;
            input.setAttribute('aria-expanded', 'true');
            // Open to the right of the box unless that runs off the screen,
            // as it does for a box at the right end of a header.
            panel.classList.remove('arc-search__panel--right');
            if (panel.getBoundingClientRect().right > window.innerWidth - 8) {
                panel.classList.add('arc-search__panel--right');
            }
        }

        function setActive(index) {
            var items = panel.querySelectorAll('.arc-search__item');
            for (var i = 0; i < items.length; i++) {
                items[i].classList.toggle('is-active', i === index);
                items[i].setAttribute('aria-selected', i === index ? 'true' : 'false');
            }
            active = index;
            input.setAttribute('aria-activedescendant', index >= 0 ? listId + '-' + index : '');
        }

        function search(q) {
            var key = q.toLowerCase();
            if (cache[key]) { render(cache[key]); return; }
            var mine = ++ticket;
            root.classList.add('is-loading');
            fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: { q: q, lang: lang, scope: 'public', limit: limit } }),
            })
                .then(function (res) { return res.json(); })
                .then(function (body) {
                    if (mine !== ticket) return;
                    var response = (body && body.result) || { results: [] };
                    cache[key] = response;
                    if (document.activeElement === input && input.value.trim() === q) render(response);
                })
                .catch(function (error) {
                    if (window.console) console.error('Search failed:', error);
                    if (mine === ticket) render({ results: [] });
                })
                .then(function () { if (mine === ticket) root.classList.remove('is-loading'); });
        }

        input.addEventListener('input', function () {
            var q = input.value.trim();
            if (timer) clearTimeout(timer);
            if (q.length < MIN_LENGTH) { close(); return; }
            timer = setTimeout(function () { search(q); }, DEBOUNCE_MS);
        });

        input.addEventListener('focus', function () {
            var q = input.value.trim();
            if (q.length >= MIN_LENGTH && cache[q.toLowerCase()]) render(cache[q.toLowerCase()]);
        });

        input.addEventListener('keydown', function (event) {
            if (panel.hidden || !results.length) {
                if (event.key === 'Escape') { input.value = ''; close(); }
                return;
            }
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((active + 1) % results.length);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((active - 1 + results.length) % results.length);
            } else if (event.key === 'Enter' && active >= 0) {
                event.preventDefault();
                window.location.assign(results[active].link);
            } else if (event.key === 'Escape') {
                close();
            }
        });

        panel.addEventListener('mousemove', function (event) {
            var item = event.target.closest && event.target.closest('.arc-search__item');
            if (item) setActive(parseInt(item.getAttribute('data-index'), 10));
        });

        document.addEventListener('click', function (event) {
            if (!root.contains(event.target)) close();
        });
    }

    function boot() {
        var roots = document.querySelectorAll('.arc-search[data-endpoint]');
        for (var i = 0; i < roots.length; i++) init(roots[i]);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
