/*
 * Arc CMS developer docs: the page furniture. Every page is a plain HTML document with a
 * <main>; this script adds the header, the sidebar (from nav.js), search (from
 * search-index.js), "On this page", previous and next, copy buttons and the theme switch.
 * Without JavaScript a page is still readable, just without the menu.
 *
 * The heading id rules (slug, assignIds) are also read by the docs checks and by
 * `npm run docs:index` in Node, so links to a heading are checked with the same ids the
 * browser gives it. Everything below them only runs in a page that has data-root.
 */
(function (root) {
  'use strict';

  function slug(text) {
    var s = String(text).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s || 'section';
  }

  /** Final ids for a list of headings [{ id?, text }]: an explicit id is kept, others get a unique slug. */
  function assignIds(items) {
    var used = {};
    items.forEach(function (it) { if (it.id) used[it.id] = true; });
    return items.map(function (it) {
      if (it.id) return it.id;
      var base = slug(it.text);
      var id = base;
      var n = 2;
      while (used[id]) { id = base + '-' + n; n += 1; }
      used[id] = true;
      return id;
    });
  }

  root.ARC_DOCS_TOOLS = { slug: slug, assignIds: assignIds };

  if (typeof document === 'undefined' || !document.body || !document.body.hasAttribute('data-root')) return;

  var body = document.body;
  var ROOT = body.getAttribute('data-root') || '';
  var PAGE = body.getAttribute('data-page') || 'index.html';
  var NAV = root.ARC_DOCS_NAV || [];
  var INDEX = root.ARC_DOCS_INDEX || [];
  var main = document.querySelector('main');
  if (!main) return;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function store(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      window.localStorage.setItem(key, value);
    } catch (e) { /* storage can be blocked: the docs work without it */ }
    return null;
  }

  /* ---------- theme ---------- */

  var savedTheme = store('arc-docs-theme');
  if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.setAttribute('data-theme', savedTheme);

  function currentTheme() {
    var set = document.documentElement.getAttribute('data-theme');
    if (set) return set;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /* ---------- page facts ---------- */

  var flat = [];
  var section = null;
  NAV.forEach(function (sec) {
    sec.pages.forEach(function (p) {
      flat.push({ path: p.path, title: p.title, section: sec.title });
      if (p.path === PAGE) section = sec;
    });
  });
  var here = flat.filter(function (p) { return p.path === PAGE; })[0];
  var isHome = PAGE === 'index.html';

  /* ---------- headings, ids, contents ---------- */

  var heads = Array.prototype.slice.call(main.querySelectorAll('h2, h3'));
  var ids = assignIds(heads.map(function (h) {
    return { id: h.getAttribute('id'), text: h.textContent.replace(/\s+/g, ' ').trim() };
  }));
  heads.forEach(function (h, i) { h.setAttribute('id', ids[i]); });

  /* ---------- header ---------- */

  var menuBtn = el('button', { class: 'arc-btn arc-menu-btn', type: 'button', 'aria-label': 'Menu', text: 'Menu' });
  var brand = el('a', { class: 'arc-brand', href: ROOT + 'index.html' }, []);
  brand.innerHTML = 'Arc <span>CMS</span> docs';
  var searchBtn = el('button', { class: 'arc-btn', type: 'button', 'aria-label': 'Search the docs' }, [
    el('span', { class: 'label', text: 'Search' }),
    el('kbd', { text: '/' })
  ]);
  var themeBtn = el('button', { class: 'arc-btn', type: 'button', 'aria-label': 'Switch light and dark' });
  function paintTheme() { themeBtn.textContent = currentTheme() === 'dark' ? 'Light' : 'Dark'; }
  paintTheme();
  themeBtn.addEventListener('click', function () {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    store('arc-docs-theme', next);
    paintTheme();
  });
  var header = el('header', { class: 'arc-header' }, [menuBtn, brand, el('span', { class: 'spacer' }), searchBtn, themeBtn]);

  /* ---------- sidebar ---------- */

  var sidebar = el('nav', { class: 'arc-sidebar', 'aria-label': 'Documentation' });
  NAV.forEach(function (sec) {
    var details = el('details', {});
    var links = sec.pages.map(function (p) {
      var a = el('a', { href: ROOT + p.path, text: p.title });
      if (p.path === PAGE) { a.setAttribute('aria-current', 'page'); details.setAttribute('open', ''); }
      return el('li', {}, [a]);
    });
    details.appendChild(el('summary', { text: sec.title }));
    details.appendChild(el('ul', {}, links));
    sidebar.appendChild(details);
  });
  if (isHome) {
    var first = sidebar.querySelector('details');
    if (first) first.setAttribute('open', '');
  }

  /* ---------- "On this page" ---------- */

  var toc = el('aside', { class: 'arc-toc', 'aria-label': 'On this page' });
  if (heads.length > 1) {
    toc.appendChild(el('h2', { text: 'On this page' }));
    heads.forEach(function (h) {
      toc.appendChild(el('a', { href: '#' + h.id, class: h.tagName.toLowerCase(), text: h.textContent.replace(/\s+/g, ' ').trim() }));
    });
  }

  /* ---------- assemble ---------- */

  var layout = el('div', { class: 'arc-layout' });
  main.parentNode.insertBefore(header, main);
  main.parentNode.insertBefore(layout, main);
  layout.appendChild(sidebar);
  layout.appendChild(main);
  layout.appendChild(toc);
  if (isHome) main.classList.add('home');

  if (here && !isHome) {
    var crumbs = el('p', { class: 'crumbs' });
    crumbs.innerHTML = '<a href="' + ROOT + 'index.html">Docs</a> / ' + (section ? section.title + ' / ' : '');
    crumbs.appendChild(document.createTextNode(here.title));
    main.insertBefore(crumbs, main.firstChild);
  }

  /* previous and next, in navigation order */
  if (here && !isHome) {
    var at = flat.indexOf(here);
    var pager = el('nav', { class: 'pager', 'aria-label': 'Previous and next page' });
    if (flat[at - 1]) {
      var prev = el('a', { class: 'prev', href: ROOT + flat[at - 1].path }, [el('small', { text: 'Previous' }), document.createTextNode(flat[at - 1].title)]);
      pager.appendChild(prev);
    }
    if (flat[at + 1]) {
      var next = el('a', { class: 'next', href: ROOT + flat[at + 1].path }, [el('small', { text: 'Next' }), document.createTextNode(flat[at + 1].title)]);
      pager.appendChild(next);
    }
    if (pager.children.length) main.appendChild(pager);
  }

  /* ---------- tables and code ---------- */

  Array.prototype.forEach.call(main.querySelectorAll('table'), function (t) {
    if (t.parentNode.classList.contains('table-wrap')) return;
    var wrap = el('div', { class: 'table-wrap' });
    t.parentNode.insertBefore(wrap, t);
    wrap.appendChild(t);
  });

  Array.prototype.forEach.call(main.querySelectorAll('pre'), function (pre) {
    var btn = el('button', { class: 'copy', type: 'button', text: 'Copy', 'aria-label': 'Copy this code' });
    btn.addEventListener('click', function () {
      var code = pre.querySelector('code');
      var text = (code || pre).textContent;
      var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
      else {
        var area = el('textarea', {});
        area.value = text; document.body.appendChild(area); area.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* copy is a convenience */ }
        document.body.removeChild(area);
      }
    });
    pre.appendChild(btn);
  });

  /* ---------- contents highlight ---------- */

  if ('IntersectionObserver' in window && heads.length > 1) {
    var links = {};
    Array.prototype.forEach.call(toc.querySelectorAll('a'), function (a) { links[a.getAttribute('href').slice(1)] = a; });
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        Object.keys(links).forEach(function (k) { links[k].classList.remove('active'); });
        if (links[e.target.id]) links[e.target.id].classList.add('active');
      });
    }, { rootMargin: '-10% 0px -80% 0px' });
    heads.forEach(function (h) { obs.observe(h); });
  }

  /* ---------- menu on small screens ---------- */

  menuBtn.addEventListener('click', function () { body.classList.toggle('menu-open'); });
  sidebar.addEventListener('click', function (e) { if (e.target.tagName === 'A') body.classList.remove('menu-open'); });

  /* ---------- search ---------- */

  var overlay = null;
  var input = null;
  var list = null;
  var results = [];
  var picked = 0;

  function terms(q) { return q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }

  function find(q) {
    var ts = terms(q);
    if (!ts.length) return [];
    var out = [];
    INDEX.forEach(function (page) {
      var title = page.t.toLowerCase();
      var desc = (page.d || '').toLowerCase();
      var sec = (page.s || '').toLowerCase();
      var pageScore = 0;
      var ok = true;
      ts.forEach(function (t) {
        var s = 0;
        if (title.indexOf(t) >= 0) s += 10;
        if (desc.indexOf(t) >= 0) s += 2;
        if (sec.indexOf(t) >= 0) s += 1;
        if (!s) ok = false;
        pageScore += s;
      });
      if (ok) out.push({ score: pageScore + 5, title: page.t, sub: page.s, href: page.p });
      (page.h || []).forEach(function (h) {
        var text = h[1].toLowerCase();
        var hs = 0;
        var all = true;
        ts.forEach(function (t) {
          if (text.indexOf(t) >= 0) hs += 4;
          else if (title.indexOf(t) >= 0) hs += 1;
          else all = false;
        });
        if (all && hs) out.push({ score: hs, title: h[1], sub: page.t, href: page.p + '#' + h[0] });
      });
    });
    out.sort(function (a, b) { return b.score - a.score || a.title.localeCompare(b.title); });
    return out.slice(0, 14);
  }

  function paint() {
    list.innerHTML = '';
    if (!input.value.trim()) { list.appendChild(el('li', { class: 'empty', text: 'Type to search page titles and headings.' })); return; }
    if (!results.length) { list.appendChild(el('li', { class: 'empty', text: 'Nothing found. Try fewer or different words.' })); return; }
    results.forEach(function (r, i) {
      var a = el('a', { href: ROOT + r.href, 'aria-selected': i === picked ? 'true' : 'false' }, [
        document.createTextNode(r.title), el('small', { text: r.sub })
      ]);
      list.appendChild(el('li', {}, [a]));
    });
  }

  function openSearch() {
    if (!overlay) {
      input = el('input', { type: 'search', placeholder: 'Search the docs', 'aria-label': 'Search the docs', autocomplete: 'off' });
      list = el('ul', {});
      overlay = el('div', { class: 'arc-search', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search' }, [el('div', { class: 'arc-search-box' }, [input, list])]);
      document.body.appendChild(overlay);
      overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeSearch(); });
      input.addEventListener('input', function () { results = find(input.value); picked = 0; paint(); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') { picked = Math.min(picked + 1, results.length - 1); paint(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { picked = Math.max(picked - 1, 0); paint(); e.preventDefault(); }
        else if (e.key === 'Enter' && results[picked]) { window.location.href = ROOT + results[picked].href; }
      });
    }
    overlay.classList.add('open');
    input.value = '';
    results = [];
    paint();
    input.focus();
  }

  function closeSearch() { if (overlay) overlay.classList.remove('open'); }

  searchBtn.addEventListener('click', openSearch);
  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);
    if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openSearch(); }
    else if (e.key === 'Escape') { closeSearch(); body.classList.remove('menu-open'); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
