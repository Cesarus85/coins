import * as THREE from 'three';
import { SceneRig } from './scene.js';
import { BlocksManager } from './blocks.js';
import { CoinManager } from './coins.js';
import { getInteractionSpheres } from './input.js';

export class XRApp {
  constructor(ui) {
    this.ui = ui;
    this.renderer = null;
    this.sceneRig = null;
    this.refSpace = null;
    this.viewerSpace = null;

    this.blocks = null;
    this.coins = null;
    this.world = new THREE.Group();

    this._lastFpsSample = performance.now();
    this._frameCount = 0;
    this._lastFrame = null;

    this._placedBlocks = false;
    this._prevTime = null;
    this._didWarmup = false;
  }

  async startAR() {
    const sessionInit = {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['dom-overlay', 'hand-tracking'],
      domOverlay: { root: document.body }
    };
    const session = await navigator.xr.requestSession('immersive-ar', sessionInit);

    this.sceneRig = new SceneRig();
    this.renderer = this.sceneRig.renderer;
    this.sceneRig.scene.add(this.world);

    this.refSpace = await session.requestReferenceSpace('local-floor');
    this.viewerSpace = await session.requestReferenceSpace('viewer');

    this.blocks = new BlocksManager(this.sceneRig.scene);
    this.coins = new CoinManager(this.sceneRig.scene);

    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    await this.renderer.xr.setSession(session);

    session.addEventListener('end', () => {
      this.ui.setHudVisible(false);
      const start = document.getElementById('start-ar');
      start.classList.remove('hidden'); start.disabled = false;
      this.cleanup();
    });

    this.renderer.setAnimationLoop((t, frame) => this.onXRFrame(t, frame));
    this.ui.toast('Vier Blöcke erscheinen um dich herum (1 m Abstand | +40 cm Höhe).');
    return true;
  }

  async _warmupPipelinesOnce() {
    if (this._didWarmup) return;
    try {
      await this.blocks.ensureLoaded();
      await this.coins.ensureLoaded?.();

      const tempCoin = this.coins._makePreviewInstance?.();
      if (tempCoin) { tempCoin.visible = false; this.sceneRig.scene.add(tempCoin); }

      const xrCam = this.renderer.xr.getCamera(this.sceneRig.camera);
      this.renderer.compile(this.sceneRig.scene, xrCam);
      this.renderer.render(this.sceneRig.scene, this.sceneRig.camera);
      if (tempCoin) tempCoin.removeFromParent();

      this._didWarmup = true;
    } catch (e) {
      console.warn('Warmup fehlgeschlagen:', e);
    }
  }

  cleanup() {
    try { this.renderer?.setAnimationLoop(null); } catch {}
    try { this.blocks?.dispose?.(); } catch {}
    try { this.sceneRig?.dispose(); } catch {}
    try {
      if (this.renderer) {
        this.renderer.forceContextLoss?.();
        this.renderer.domElement?.remove();
      }
    } catch {}
    this.renderer = null;
    this.sceneRig = null;
    this.blocks = null;
    this.coins = null;
    this.world = new THREE.Group();
    this._placedBlocks = false;
    this._prevTime = null;
    this._didWarmup = false;
  }

  end() {
    const session = this.renderer?.xr?.getSession();
    if (session) session.end();
  }

  async onXRFrame(t, frame) {
    const now = performance.now();
    if (this._prevTime == null) this._prevTime = now;
    const dtMs = now - this._prevTime;
    this._prevTime = now;

    this._lastFrame = frame;

    if (!this._placedBlocks) {
      const vp = frame.getViewerPose(this.refSpace);
      if (vp) {
        const p = vp.transform.position;
        const o = vp.transform.orientation;
        const viewerPos = new THREE.Vector3(p.x, p.y, p.z);
        const viewerQuat = new THREE.Quaternion(o.x, o.y, o.z, o.w);

        await this.blocks.ensureLoaded();

        // Safety: vorherige (evtl. verirrte) Blöcke löschen
        this.blocks.clear();

        this.blocks.placeAroundViewer(viewerPos, viewerQuat);
        this._placedBlocks = true;

        // Debug: verifizieren, dass es exakt 4 sind
        console.log('[Blocks] placed:', this.blocks.blocks.length);

        await this._warmupPipelinesOnce();
      }
    }

    const session = this.renderer.xr.getSession();
    const spheres = getInteractionSpheres(frame, this.refSpace, session.inputSources);

    this.blocks.updateIdle(dtMs);
    const coinBursts = this.blocks.testHitsAndGetBursts(spheres);
    for (const b of coinBursts) {
      this.coins.spawnBurst(b.spawnPos, b.upNormal);
      this.ui.setScore(this.coins.score);
    }

    this.coins.update(dtMs);

    this._frameCount++;
    if (now - this._lastFpsSample > 500) {
      const fps = Math.round((this._frameCount * 1000) / (now - this._lastFpsSample));
      this._frameCount = 0; this._lastFpsSample = now;
      this.ui.setFps(fps);
    }

    this.renderer.render(this.sceneRig.scene, this.sceneRig.camera);
  }
}
