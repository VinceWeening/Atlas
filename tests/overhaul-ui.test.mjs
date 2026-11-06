import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the real focus helper with a minimal DOM: no browser and no house controls.
function fixture() {
  const doc = { activeElement: null };
  class Element {
    constructor(tag = 'div', children = []) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
      this.dataset = {}; this.attributes = {}; this.scrollTop = 0; this.disabled = false;
      this.replaceChildren(...children);
    }
    contains(el) { return el === this || this.children.some((child) => child.contains(el)); }
    replaceChildren(...children) {
      if (this.contains(doc.activeElement) && doc.activeElement !== this) doc.activeElement = null;
      for (const child of this.children) child.parentElement = null;
      this.children = children;
      for (const child of children) child.parentElement = this;
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    querySelectorAll() {
      return this.children.flatMap((child) => [
        ...(['BUTTON', 'INPUT', 'SELECT', 'A'].includes(child.tagName) || child.attributes.tabindex != null ? [child] : []),
        ...child.querySelectorAll(),
      ]);
    }
    focus(options) { if (!this.disabled) { doc.activeElement = this; this.focusOptions = options; } }
  }
  class Button extends Element { constructor() { super('button'); } }
  const code = ts.transpileModule(readFileSync(new URL('../web/src/dom.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { exports: {}, document: doc, HTMLElement: Element, HTMLButtonElement: Button };
  vm.runInNewContext(code, context);
  const control = (key, label) => {
    const el = new Button();
    if (key != null) el.dataset.focus = key;
    if (label != null) el.attributes['aria-label'] = label;
    return el;
  };
  return { doc, Element, control, replace: context.exports.vervangMetFocus };
}

test('focus follows the entity when live rows change order and labels change', () => {
  const f = fixture();
  const old = f.control('light.desk', 'Desk on');
  const list = new f.Element('div', [old, f.control('light.hall', 'Hall on')]);
  old.focus(); list.scrollTop = 120;
  const desk = f.control('light.desk', 'Desk off');
  f.replace(list, f.control('light.hall', 'Hall on'), desk);
  assert.equal(f.doc.activeElement, desk);
  assert.equal(desk.focusOptions.preventScroll, true);
  assert.equal(list.scrollTop, 120);
});

test('updating a different panel never steals focus', () => {
  const f = fixture(); const outside = f.control('search'); outside.focus();
  const list = new f.Element();
  f.replace(list, f.control('light.desk'));
  assert.equal(f.doc.activeElement, outside);
});

test('a removed entity must not move focus onto another device at the same position', () => {
  const f = fixture(); const old = f.control('light.desk', 'Desk on');
  const list = new f.Element('div', [old]); old.focus();
  const hall = f.control('light.hall', 'Hall on');
  f.replace(list, hall);
  assert.notEqual(f.doc.activeElement, hall);
});

test('a disabled replacement is not focused', () => {
  const f = fixture(); const old = f.control('light.desk');
  const list = new f.Element('div', [old]); old.focus();
  const next = f.control('light.desk'); next.disabled = true;
  f.replace(list, next);
  assert.notEqual(f.doc.activeElement, next);
});

test('unkeyed controls keep focus when their accessible label stays the same', () => {
  const f = fixture(); const old = f.control(null, 'Begane grond');
  const list = new f.Element('div', [old]); old.focus();
  const next = f.control(null, 'Begane grond');
  f.replace(list, next);
  assert.equal(f.doc.activeElement, next);
});
