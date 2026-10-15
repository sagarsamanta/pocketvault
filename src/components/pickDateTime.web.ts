/** Browser fallback: a native datetime-local input in a lightweight overlay. */
export function pickDateTime(initial: number): Promise<number | null> {
  return new Promise((resolve) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = new Date(initial);
    const value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Pick date and time');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9999;font-family:system-ui';
    const box = document.createElement('div');
    box.style.cssText = 'background:#fff;color:#111;padding:20px;border-radius:14px;display:flex;flex-direction:column;gap:12px;min-width:280px';
    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.value = value;
    input.setAttribute('data-testid', 'datetime-input');
    input.style.cssText = 'font-size:16px;padding:8px';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.textContent = 'Set';
    ok.setAttribute('data-testid', 'datetime-ok');
    row.append(cancel, ok);
    box.append(input, row);
    overlay.append(box);
    document.body.append(overlay);

    const done = (result: number | null) => {
      overlay.remove();
      resolve(result);
    };
    cancel.onclick = () => done(null);
    ok.onclick = () => {
      const ts = new Date(input.value).getTime();
      done(Number.isFinite(ts) ? ts : null);
    };
  });
}
