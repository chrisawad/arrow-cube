import { DEFAULT_THEME, THEME_LABELS, normalizeTheme, hexToHsv, hsvToHex } from './theme.js';

/** A shared, modeless palette. Only colors change; gameplay state stays with main. */
export function setupThemeControls({ document, initial, onChange, createWheel }) {
  const $ = id => document.getElementById(id);
  const panel = $('theme-dialog'), wheel = $('color-wheel');
  let theme = normalizeTheme(initial), selected = 'edge', hsv = hexToHsv(theme.edge);
  const picker = createWheel(wheel, { color: theme.edge, onChange: color => { hsv = color; commit(); } });
  const hasPopover = typeof panel.showPopover === 'function';
  if (!hasPopover) panel.removeAttribute('popover');

  function paintEditor() {
    $('color-name').textContent = THEME_LABELS[selected];
    $('color-preview').style.setProperty('--swatch', theme[selected]);
    $('color-hex').value = theme[selected];
    $('color-hex').setAttribute('aria-invalid', 'false');
    $('color-error').textContent = '';
    picker.setHsv(hsv);
    $('color-part').value = selected;
    $('color-brightness').value = String(Math.round(hsv.v * 100));
    $('color-brightness-value').textContent = `${Math.round(hsv.v * 100)}%`;
    $('color-brightness').style.setProperty('--bright-color', hsvToHex({ ...hsv, v: 1 }));
  }
  function paintTheme() {
    for (const key of Object.keys(DEFAULT_THEME)) {
      document.documentElement.style.setProperty(`--game-${key}`, theme[key]);
    }
    $('theme-color').setAttribute('content', theme.background);
    paintEditor();
  }
  function commit() {
    theme = { ...theme, [selected]: hsvToHex(hsv) };
    paintTheme(); onChange({ ...theme });
  }
  $('color-part').addEventListener('change', event => {
    if (!Object.hasOwn(DEFAULT_THEME, event.target.value)) return;
    selected = event.target.value; hsv = hexToHsv(theme[selected], hsv.h); paintTheme();
  });
  $('color-brightness').addEventListener('input', event => { hsv.v = Number(event.target.value) / 100; commit(); });
  function applyHex() {
    const value = $('color-hex').value.trim();
    if (!/^#[\da-f]{6}$/i.test(value)) {
      $('color-hex').setAttribute('aria-invalid', 'true');
      $('color-error').textContent = 'Use # and six hex digits, for example #ffff00.';
      return;
    }
    theme = { ...theme, [selected]: value.toLowerCase() };
    hsv = hexToHsv(theme[selected], hsv.h); paintTheme(); onChange({ ...theme });
  }
  $('color-hex').addEventListener('input', () => {
    if (/^#[\da-f]{6}$/i.test($('color-hex').value.trim())) applyHex();
  });
  $('color-hex').addEventListener('change', applyHex);
  $('color-hex').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); applyHex(); } });
  const open = () => {
    if ($('settings-dialog').open) $('settings-dialog').close();
    if (hasPopover) panel.showPopover(); else if (!panel.open) panel.showModal();
  };
  $('theme-open').addEventListener('click', open);
  $('theme-settings').addEventListener('click', open);
  $('theme-close').addEventListener('click', () => { if (hasPopover) panel.hidePopover(); else panel.close(); });
  $('theme-defaults').addEventListener('click', () => {
    theme = normalizeTheme(); hsv = hexToHsv(theme[selected]); paintTheme(); onChange({ ...theme });
  });
  paintTheme();
}
