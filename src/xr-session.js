// ./src/xr-session.js
import * as THREE from 'three';
import { SceneRig } from './scene.js';
import { BlocksManager } from './blocks.js';
import { CoinManager } from './coins.js';
import { getInteractionSpheres } from './input.js';
import { MathGame } from './math-game.js';
import { FailManager } from './fails.js';

export class XRApp {
  constructor(ui) {
    this.ui = ui;

    // Render / Scene
    this.rig = new SceneRig();
    this.scene = this.rig.scene;
    this.camera = this.rig.camera;
    this.renderer = this.rig.renderer;

    // Managers
    this.blocks = new BlocksManager(this.scene);
    this.coins = new CoinManager(this.scene);
    this.fails = new FailManager(this.scene);
    this.math = new MathGame(this.ui, this.scene);

    // XR
    this.xrRefSpace = null;
    this.session = null;

    // tick
    this._boundOnXRFrame = this._onXRFrame.bind(this);
    this._lastTime = 0;
    this._frameCount = 0;
  }

  async startAR() {
    // DOM Overlay aktivieren, damit die Gleichung in AR sichtbar ist
    const root = document.getElementById('ui-root') || document.body;

    this.session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor', 'dom-overlay'],
      domOverlay: { root }
    });

    this.renderer.xr.enabled = true;
    await this.renderer.xr.setSession(this.session);
    this.xrRefSpace = await this.session.requestReferenceSpace('local-floor');

    // UI in AR sichtbar machen
    this.ui.setHudVisible(true);
    this.ui.setEquationVisible(true);

    // Assets vorbereiten
    await Promise.all([
      this.blocks.preload(),
      this.coins.preload(),
      this.fails.preload()
    ]);

    // drei Blöcke spawnen
    const spawned = await this.blocks.spawnGroup();
    // Liste für MathGame registrieren
    this.math.setBlocks(spawned);

    this.session.addEventListener('end', () => this.end());
    this.renderer.setAnimationLoop(this._boundOnXRFrame);
  }

  end() {
    try { this.renderer.setAnimationLoop(null); } catch {}
    if (this.session) { this.session.end().catch(()=>{}); this.session = null; }
    this.math.dispose();
    this.blocks.dispose();
    this.coins.dispose();
    this.fails.dispose();
    this.ui.setHudVisible(false);
    this.ui.setEquationVisible(false);
    this.rig.dispose();
  }

  // ------------- frame loop -------------

  _onXRFrame(time, frame) {
    // FPS
    if (++this._frameCount % 30 === 0 && this._lastTime) {
      const dt = (time - this._lastTime) / 1000;
      const fps = (30 / dt).toFixed(0);
      this.ui.setFps(fps);
    }
    this._lastTime = time;

    // Spieler-Interaktionssphären (Hände/Controller)
    const spheres = getInteractionSpheres(this.renderer.xr);

    // Block-Update & Hit-Test
    const dtSec = this.renderer.xr.isPresenting ? this.renderer.xr.getFrame().deltaTime ?? 16.6 : 16.6;
    const bursts = this.blocks.update(dtSec / 1000, spheres);

    // Treffer auswerten
    if (bursts?.length) {
      for (const hit of bursts) {
        const wasRight = this.math.handleHit(hit.blockIndex);
        if (wasRight) {
          this.coins.spawnBurst(hit.blockWorldPos);
        } else {
          this.fails.spawn(hit.blockWorldPos);
        }
      }
    }

    this.coins.update(dtSec / 1000);
    this.fails.update(dtSec / 1000);

    // Render
    this.renderer.autoClear = false;
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
  }
}
