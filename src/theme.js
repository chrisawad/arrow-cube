export const DEFAULT_THEME = Object.freeze({
  edge: '#ffff00', ink: '#15191f', end1: '#37b487', end2: '#f1c643',
  fixed: '#74ccef', flip: '#b64bed', background: '#e2f1f8',
  ghost: '#ffffff', crash: '#e16457', hint: '#5b55e7',
});

export const THEME_LABELS = Object.freeze({
  edge: 'Slide edges', ink: 'Arrows', end1: 'Double arrow · first end', end2: 'Double arrow · second end',
  fixed: 'Fixed turn markers', flip: 'Reversing turn markers', background: 'Background',
  ghost: 'Far-side arrows', crash: 'Crashed arrows', hint: 'Hint',
});

export function normalizeTheme(value) {
  const theme = { ...DEFAULT_THEME };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(theme)) {
      if (typeof value[key] === 'string' && /^#[\da-f]{6}$/i.test(value[key])) theme[key] = value[key].toLowerCase();
    }
  }
  return theme;
}

export function hexToRgb(hex) {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
}

export function hexToHsv(hex, fallbackHue = 0) {
  const [r, g, b] = hexToRgb(hex).map(channel => channel / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let h = fallbackHue;
  if (delta) h = ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
  return { h, s: max ? delta / max : 0, v: max };
}

export function hsvToHex({ h, s, v }) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s)); v = Math.max(0, Math.min(1, v));
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + rgb.map(channel => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('');
}

