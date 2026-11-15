import iro from '@jaames/iro';

// iro owns the wheel's rendering and mouse/touch interaction. The adjacent
// native range and hex field provide keyboard access to the same color.
export function createColorWheel(element, { color, onChange }) {
  const picker = new iro.ColorPicker(element, {
    width: 190, color, wheelLightness: false, borderWidth: 1, borderColor: '#526575',
    layout: [{ component: iro.ui.Wheel }],
  });
  picker.on('input:change', color => onChange({ h: color.hue, s: color.saturation / 100, v: color.value / 100 }));
  return { setHsv({ h, s, v }) { picker.color.hsv = { h, s: s * 100, v: v * 100 }; } };
}
