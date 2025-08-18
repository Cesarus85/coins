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
      optionalFeatures: ['dom-overlay', 'hand-tracking'], // Hand-Tracking bleibt aktiv
      domOverlay: { root: document.body }
    };

    // Renderer + Szene
    this.sceneRig = new SceneRig();
    this.renderer = this.sceneRig.renderer;
    this.sceneRig.scene.add(this.world);

    // Manager
    this.blocks = new BlocksManager(this.sceneRig.scene);
    this.coins = new CoinManager(this.sceneRig.scene);

    // ⏳ Assets & Pools vorab laden/aufbauen
    const preload = Promise.all([
      this.blocks.ensureLoaded(),
      this.coins.ensureLoaded() // baut auch den Pool
    ]);

    // XR-Session starten
    const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    await this.renderer.xr.setSession(session);

    // XR-Downscale/Foveation (nach setSession)
    this.sceneRig.xrTweak?.(this.renderer);

    this.refSpace = await session.requestReferenceSpace('local-floor');
    this.viewerSpace = await session.requestReferenceSpace('viewer');

    session.addEventListener('end', () => {
      this.ui.setHudVisible(false);
      const start = document.getElementById('start-ar');
      start.classList.remove('hidden'); start.disabled = false;
      this.cleanup();
    });

    // Warten bis GLBs & Pool fertig sind, dann Pipelines vorwärmen
    await preload;
    await this._warmupPipelinesOnce();

    // Render-Loop starten
    this.renderer.setAnimationLoop((t, frame) => this.onXRFrame(t, frame));
    this.ui.toast('Blöcke werden platziert …');
    return true;
  }

  async _warmupPipelinesOnce() {
    if (this._didWarmup) return;
    try {
      const tempCoin = this.coins._makePreviewInstance?.();
      if (tempCoin) { tempCoin.visible = false; this.sceneRig.scene.add(tempCoin); }
      const xrCam = this.renderer.xr.getCamera(this.sceneRig.camera);
      this.renderer.compile(this.sceneRig.scene, xrCam);
      if (tempCoin) tempCoin.removeFromParent();
      this._didWarmup = true;
    } catch (e) {
      console.warn('Warmup übersprungen:', e);
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

    // Platzierung erst bei gültiger ViewerPose (nach Preload/Warmup)
    if (!this._placedBlocks) {
      const vp = frame.getViewerPose(this.refSpace);
      if (vp) {
        const p = vp.transform.position;
        const o = vp.transform.orientation;
        const viewerPos = new THREE.Vector3(p.x, p.y, p.z);
        const viewerQuat = new THREE.Quaternion(o.x, o.y, o.z, o.w);
        this.blocks.clear();
        this.blocks.placeAroundViewer(viewerPos, viewerQuat);
        this._placedBlocks = true;
        console.log('[Blocks] placed:', this.blocks.blocks.length);
      }
    }

    // Eingabe-Sphären (mit Hand-Tracking)
    const session = this.renderer.xr.getSession();
    const spheres = getInteractionSpheres(frame, this.refSpace, session.inputSources);

    // Blöcke & Coins
    this.blocks.updateIdle(dtMs);

    const bursts = this.blocks.testHitsAndGetBursts(spheres);
    if (bursts.length) {
      for (const b of bursts) this.coins.spawnBurst(b.spawnPos, b.upNormal);
      this.ui.setScore(this.coins.score);
    }

    this.coins.update(dtMs);

    // FPS
    this._frameCount++;
    if (now - this._lastFpsSample > 500) {
      const fps = Math.round((this._frameCount * 1000) / (now - this._lastFpsSample));
      this._frameCount = 0; this._lastFpsSample = now;
      this.ui.setFps(fps);
    }

    this.renderer.render(this.sceneRig.scene, this.sceneRig.camera);
  }
}
