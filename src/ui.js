// /src/ui.js
export class UI {
  constructor() {
    // Optional vorhandene HUD-Elemente (können in index.html liegen)
    this.hud = document.getElementById('hud');
    this.scoreEl = document.getElementById('score');
    this.fpsEl = document.getElementById('fps');
    this._toastTimer = null;

    // Equation-Banner immer im DOM overlay verfügbar machen
    this.eqEl = document.getElementById('equation');
    if (!this.eqEl) {
      this.eqEl = document.createElement('div');
      this.eqEl.id = 'equation';
      Object.assign(this.eqEl.style, {
        position: 'fixed',
        top: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '10px 14px',
        borderRadius: '12px',
        background: 'rgba(10,10,10,0.65)',
        backdropFilter: 'blur(6px)',
        border: '1px solid rgba(255,255,255,0.12)',
        color: '#fff',
        fontWeight: '800',
        fontSize: '1.1rem',
        zIndex: 10000,
        pointerEvents: 'none',
      });
      this.eqEl.hidden = true;
      document.body.appendChild(this.eqEl);
    }
  }

  setHudVisible(v) {
    if (this.hud) this.hud.hidden = !v;
    if (this.eqEl) this.eqEl.hidden = !v;
  }

  setScore(v) {
    if (this.scoreEl) this.scoreEl.textContent = `Score: ${v}`;
  }

  setFps(fps) {
    if (this.fpsEl) this.fpsEl.textContent = `FPS: ${fps}`;
  }

  setEquation(text) {
    if (this.eqEl) {
      this.eqEl.textContent = text;
      this.eqEl.hidden = false;
    }
  }

  toast(msg, ms = 2200) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      Object.assign(el.style, {
        position: 'fixed',
        top: '18px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(10,10,10,0.75)',
        color: '#fff',
        padding: '10px 14px',
        borderRadius: '10px',
        border: '1px solid rgba(255,255,255,0.15)',
        zIndex: 9999,
        fontWeight: 600,
        pointerEvents: 'none'
      });
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { if (el) el.style.opacity = '0'; }, ms);
  }
}
