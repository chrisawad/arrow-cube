/** Keep edge controls inside the visible window when a PWA resumes or updates. */
export function setupViewport({ window, document }) {
  const controller = new AbortController(), options = { signal: controller.signal };
  const root = document.documentElement, viewport = window.visualViewport;
  let frame = 0, settled = 0, previous = '';
  const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
  function measure() {
    frame = 0;
    if (controller.signal.aborted || document.visibilityState === 'hidden') return;
    const layoutWidth = positive(window.innerWidth, root.clientWidth);
    const layoutHeight = positive(window.innerHeight, root.clientHeight);
    if (!layoutWidth || !layoutHeight) return;
    // Browser zoom must keep magnifying the page, rather than shrink its layout.
    const visible = viewport && Math.abs((viewport.scale || 1) - 1) < .01;
    const width = visible ? Math.min(layoutWidth, positive(viewport.width, layoutWidth)) : layoutWidth;
    const height = visible ? Math.min(layoutHeight, positive(viewport.height, layoutHeight)) : layoutHeight;
    const left = visible ? Math.max(0, Math.min(viewport.offsetLeft || 0, layoutWidth - width)) : 0;
    const top = visible ? Math.max(0, Math.min(viewport.offsetTop || 0, layoutHeight - height)) : 0;
    const values = { width, height, left, top, bottom: Math.max(0, layoutHeight - height - top) };
    const signature = JSON.stringify(values);
    if (signature === previous) return;
    previous = signature;
    for (const [key, value] of Object.entries(values)) root.style.setProperty(`--game-viewport-${key}`, `${value}px`);
  }
  function schedule() { if (!frame) frame = window.requestAnimationFrame(measure); }
  function resume() {
    schedule();
    window.clearTimeout(settled);
    // Android can finish applying navigation-bar insets after the resume event.
    settled = window.setTimeout(schedule, 250);
  }
  viewport?.addEventListener('resize', schedule, options);
  viewport?.addEventListener('scroll', schedule, options);
  window.addEventListener('resize', schedule, options);
  for (const event of ['pageshow', 'focus', 'orientationchange']) window.addEventListener(event, resume, options);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') resume(); }, options);
  window.navigator?.serviceWorker?.addEventListener('controllerchange', resume, options);
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', resume, options);
  measure();
  resume();
  return () => { controller.abort(); window.cancelAnimationFrame(frame); window.clearTimeout(settled); };
}
