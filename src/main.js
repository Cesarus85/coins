import { XRApp } from './xr-session.js';
import { UI } from './ui.js';

const ui = new UI();
const app = new XRApp(ui);

const startBtn = document.getElementById('start-ar');
const respawnBtn = document.getElementById('respawn');
const endBtn = document.getElementById('end');
const debugPlanesToggle = document.getElementById('debugPlanes');

startBtn.addEventListener('click', async () => {
  if (!navigator.xr) {
    ui.toast('WebXR wird nicht unterstützt.');
    return;
  }
  try {
    startBtn.disabled = true;
    await app.startAR();
    ui.setHudVisible(true);
    startBtn.classList.add('hidden');
  } catch (err) {
    console.error(err);
    ui.toast('Konnte AR-Session nicht starten: ' + (err?.message ?? err));
    startBtn.disabled = false;
  }
});

respawnBtn.addEventListener('click', () => app.respawnCoins());
endBtn.addEventListener('click', () => app.end());
debugPlanesToggle.addEventListener('change', (e) => app.setDebugPlanes(e.target.checked));
