const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createNotificationController } = require('../src/ui/notifications');

function createFakeDom() {
  const elementsById = new Map();

  function createClassList(el) {
    const classes = new Set();
    return {
      add(...names) {
        names.forEach((n) => classes.add(n));
        el._syncClass();
      },
      remove(...names) {
        names.forEach((n) => classes.delete(n));
        el._syncClass();
      },
      contains(n) {
        return classes.has(n);
      },
      _resetFromString(str) {
        classes.clear();
        String(str || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
      },
      _toString() {
        return Array.from(classes).join(' ');
      }
    };
  }

  function createEl(tagName) {
    const children = [];
    const attrs = new Map();
    const listeners = new Map();
    let _id = '';
    let _innerHTML = '';
    let _textContent = '';

    const el = {
      tagName: tagName.toUpperCase(),
      parentNode: null,
      children,
      _classListObj: null,
      _textSpan: null,
      get id() { return _id; },
      set id(val) {
        if (_id) elementsById.delete(_id);
        _id = String(val);
        if (_id) elementsById.set(_id, el);
      },
      get lastElementChild() {
        return children.length > 0 ? children[children.length - 1] : null;
      },
      get className() {
        return el._classListObj._toString();
      },
      set className(val) {
        el._classListObj._resetFromString(val);
      },
      get classList() {
        return el._classListObj;
      },
      set innerHTML(html) {
        _innerHTML = html;
        const m = /<span class="cloud-notification-text">([\s\S]*?)<\/span>/.exec(html);
        if (m) {
          el._textSpan = {
            _text: m[1],
            get textContent() { return this._text; },
            set textContent(v) { this._text = String(v); }
          };
        }
      },
      get innerHTML() { return _innerHTML; },
      get textContent() {
        return el._textSpan ? el._textSpan.textContent : _textContent;
      },
      set textContent(v) {
        _textContent = String(v);
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      querySelector(sel) {
        if (sel === '.cloud-notification-text') return el._textSpan;
        return null;
      },
      appendChild(child) {
        const idx = children.indexOf(child);
        if (idx !== -1) children.splice(idx, 1);
        child.parentNode = el;
        children.push(child);
        return child;
      },
      remove() {
        if (el.parentNode) {
          const idx = el.parentNode.children.indexOf(el);
          if (idx !== -1) el.parentNode.children.splice(idx, 1);
          el.parentNode = null;
        }
      },
      addEventListener(evt, fn) {
        if (!listeners.has(evt)) listeners.set(evt, []);
        listeners.get(evt).push(fn);
      },
      dispatchEvent(evtName, evtObj = { stopPropagation() {} }) {
        for (const fn of (listeners.get(evtName) || [])) fn(evtObj);
      },
      _syncClass() {}
    };
    el._classListObj = createClassList(el);
    return el;
  }

  const body = createEl('body');
  const doc = {
    body,
    getElementById: (id) => elementsById.get(id) || null,
    createElement: (tag) => createEl(tag)
  };
  return { doc, body };
}

test('Notifications with replaceKey keep a single element and update its text cleanly', () => {
  const { doc } = createFakeDom();
  const ctrl = createNotificationController({ doc });
  const container = ctrl.getOrCreateContainer();

  const sequence = [110, 120, 130, 140, 150, 140, 130, 120, 110, 100];
  for (const pct of sequence) {
    ctrl.showNotification(`Zoom: ${pct}%`, 'info', { replaceKey: 'ui-zoom', duration: 60000 });
  }

  assert.equal(container.children.length, 1, 'Only one zoom notification element must exist');
  assert.equal(container.children[0].textContent, 'Zoom: 100%', 'Displayed text reflects latest value');
  assert.equal(container.children[0].getAttribute('data-notif-key'), 'ui-zoom');
});

test('Notifications without replaceKey still stack without removing keyed notifications', () => {
  const { doc } = createFakeDom();
  const ctrl = createNotificationController({ doc });
  const container = ctrl.getOrCreateContainer();

  ctrl.showNotification('Zoom: 110%', 'info', { replaceKey: 'ui-zoom', duration: 60000 });
  ctrl.showNotification('File salvato', 'info', { duration: 60000 });
  ctrl.showNotification('Compilazione completata', 'info', { duration: 60000 });

  assert.equal(container.children.length, 3);

  // Subsequent zoom update replaces only the existing zoom notification and moves it to front
  ctrl.showNotification('Zoom: 120%', 'info', { replaceKey: 'ui-zoom', duration: 60000 });

  assert.equal(container.children.length, 3, 'Total count stays 3 (2 regular + 1 zoom)');
  assert.equal(container.lastElementChild.textContent, 'Zoom: 120%');
  assert.ok(container.lastElementChild.classList.contains('cloud-no-enter'));
});

test('Pressing zoom during fade-out removes dismissing element immediately so only 1 exists', () => {
  const { doc } = createFakeDom();
  const ctrl = createNotificationController({ doc });
  const container = ctrl.getOrCreateContainer();

  const first = ctrl.showNotification('Zoom: 110%', 'info', { replaceKey: 'ui-zoom', duration: 60000 });
  assert.equal(container.children.length, 1);

  // Simulate user clicking to start 320ms cloud-dismiss animation
  first.dispatchEvent('click', { stopPropagation() {} });
  assert.ok(first.classList.contains('cloud-dismiss'));

  // Immediately zoom again during the fade-out window
  const second = ctrl.showNotification('Zoom: 120%', 'info', { replaceKey: 'ui-zoom', duration: 60000 });
  assert.notEqual(second, first, 'Creates a fresh notification when previous is dismissing');
  assert.equal(container.children.length, 1, 'Dismissing notification removed synchronously');
  assert.equal(container.children[0].textContent, 'Zoom: 120%');
});

test('Dismissing clears keyed entry cleanly so timer timeout can finish', async () => {
  const { doc } = createFakeDom();
  const ctrl = createNotificationController({ doc });
  const container = ctrl.getOrCreateContainer();

  ctrl.showNotification('Zoom: 130%', 'info', { replaceKey: 'ui-zoom', duration: 25 });
  assert.equal(container.children.length, 1);

  await new Promise((r) => setTimeout(r, 420));
  assert.equal(container.children.length, 0, 'Notification dismissed and removed after timeout + fade');
  assert.equal(ctrl._getKeyedCount(), 0, 'Keyed map cleaned up after dismissal');
});

test('renderer.js applies unified replaceKey ui-zoom across zoom helpers', () => {
  const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  assert.ok(rendererSrc.includes("replaceKey: 'ui-zoom'") || rendererSrc.includes('replaceKey: "ui-zoom"'));
  const zoomNotifMatches = rendererSrc.match(/showNotification\(`Zoom:/g) || [];
  const zoom100Matches = rendererSrc.match(/showNotification\("Zoom: 100%"/g) || [];
  assert.equal(zoomNotifMatches.length + zoom100Matches.length, 1, 'All UI zoom paths share a single applyUiZoom helper');
});
