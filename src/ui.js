// ./ui.js
export class UI {
  constructor() {
    this.hud = document.getElementById('hud');
    this.scoreEl = document.getElementById('score');
    this.fpsEl = document.getElementById('fps');
    this._toastTimer = null;

    // Equation-Banner (immer sichtbar im DOM Overlay)
    this.eqEl = document.getElementById('equation');
    if (!this.eqEl) {
      this.eqEl = document.createElement('div');
      this.eqEl.id = 'equation';
      this.eqEl.style.position = 'fixed';
      this.eqEl.style.top = '16px';
      this.eqEl.style.left = '50%';
      this.eqEl.style.transform = 'translateX(-50%)';
      this.eqEl.style.padding = '10px 14px';
      this.eqEl.style.borderRadius = '12px';
      this.eqEl.style.background = 'rgba(10,10,10,0.65)';
      this.eqEl.style.backdropFilter = 'blur(6px)';
      this.eqEl.style.border = '1px solid rgba(255,255,255,0.12)';
      this.eqEl.style.color = '#fff';
      this.eqEl.style.fontWeight = '800';
      this.eqEl.style.fontSize = '1.1rem';
      this.eqEl.style.zIndex = '10000';
      this.eqEl.hidden = true;
      document.body.appendChild(this.eqEl);
    }
  }

  setHudVisible(v) {
    if (this.hud) this.hud.hidden = !v;
    if (this.eqEl) this.eqEl.hidden = !v;
  }

  setScore(v) { if (this.scoreEl) this.scoreEl.textContent = `Score: ${v}`; }
  setFps(fps) { if (this.fpsEl) this.fpsEl.textContent = `FPS: ${fps}`; }

  setEquation(text) {
    if (this.eqEl) { this.eqEl.textContent = text; this.eqEl.hidden = false; }
  }

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
