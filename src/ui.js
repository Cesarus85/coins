// ./src/ui.js
export class UI {
  constructor() {
    this.hud = document.getElementById('hud');
    this.scoreEl = document.getElementById('score');
    this.fpsEl = document.getElementById('fps');

    // Equation-Banner (DOM-Overlay)
    this.eqEl = document.getElementById('equation');
    if (!this.eqEl) {
      this.eqEl = document.createElement('div');
      this.eqEl.id = 'equation';
      document.body.appendChild(this.eqEl);
    }
    Object.assign(this.eqEl.style, {
      position: 'fixed',
      top: '16px',
      left: '50%',
      transform: 'translateX(-50%)',
      padding: '8px 14px',
      borderRadius: '12px',
      fontWeight: '700',
      fontSize: '18px',
      color: '#fff',
      background: 'rgba(0,0,0,0.6)',
      border: '1px solid rgba(255,255,255,0.2)',
      zIndex: 9999
    });
    this.eqEl.hidden = true;
  }

  setHudVisible(v) { if (this.hud) this.hud.hidden = !v; }
  setFps(text) { if (this.fpsEl) this.fpsEl.textContent = `FPS: ${text}`; }

  setEquation(str, show = true) {
    this.eqEl.textContent = str;
    this.eqEl.hidden = !show;
  }
  setEquationVisible(show) {
    this.eqEl.hidden = !show;
  }

  toast(msg, ms = 1200) {
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
        zIndex: 10000,
        fontWeight: 600,
        transition: 'opacity 180ms',
        opacity: '1'
      });
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => (el.style.opacity = '0'), ms);
  }
}
