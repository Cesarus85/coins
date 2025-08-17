export class UI {
  constructor() {
    this.hud = document.getElementById('hud');
    this.scoreEl = document.getElementById('score');
    this.fpsEl = document.getElementById('fps');
    this._toastTimer = null;
  }

  setHudVisible(v) { if (this.hud) this.hud.hidden = !v; }
  setScore(v) { if (this.scoreEl) this.scoreEl.textContent = `Score: ${v}`; }
  setFps(fps) { if (this.fpsEl) this.fpsEl.textContent = `FPS: ${fps}`; }

  toast(msg, ms = 2500) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      Object.assign(el.style, {
        position: 'fixed', top: '18px', left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(10,10,10,0.75)', color: '#fff', padding: '10px 14px',
        borderRadius: '10px', border: '1px solid rgba(255,255,255,0.15)', zIndex: 9999, fontWeight: 600
      });
      document.body.appendChild(el);
    }
    el.textContent = msg; el.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el && (el.style.opacity = '0'), ms);
  }
}
