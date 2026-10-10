const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '../demo/prototype/prototype.css'), 'utf8');
function luminance(hex) {
  const raw = hex.slice(1); const expanded = raw.length === 3 ? [...raw].map(c => c + c).join('') : raw;
  const values = expanded.match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
}
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
for (const [theme, declaration] of [['light', css.split('* {')[0]], ['dark', css.split('body.dark {')[1].split('}')[0]]]) {
  test(`${theme} inactive tabs, timestamps, controls and footer links meet 4.5:1 contrast on row states`, () => {
    const tokens = Object.fromEntries([...declaration.matchAll(/--([\w-]+): (#[\da-f]+);/g)].map(m => [m[1], m[2]]));
    for (const foreground of ['text', 'muted', 'link']) {
      for (const background of ['surface', 'surface-soft', 'surface-hover', 'selected']) {
        assert.ok(contrast(tokens[foreground], tokens[background]) >= 4.5, `${theme} ${foreground}/${background}`);
      }
    }
    assert.ok(contrast(theme === 'light' ? '#fff' : '#172328', tokens.brand) >= 4.5, `${theme} calendar edge`);
  });
}
test('prototype honours reduced motion and distinguishes keyboard focus from selection', () => {
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.result-row\.keyboard-focus[^}]*box-shadow:/s);
  assert.match(css, /\.result-row\.selected::before[^}]*background:\s*var\(--focus\)/s);
});
