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
    this.ui.toast('3 Blöcke erscheinen 1 m vor dir, 40 cm über dir.');
    return true;
  }

  cleanup() {
    this.renderer?.setAnimationLoop(null);
    this.renderer?.dispose();
    this.sceneRig?.dispose();
    this.renderer = null;
    this.sceneRig = null;
    this.blocks = null;
    this.coins = null;
    this.world = new THREE.Group();
    this._placedBlocks = false;
  }

  end() {
    const session = this.renderer?.xr?.getSession();
    if (session) session.end();
  }

  async onXRFrame(t, frame) {
    this._lastFrame = frame;

    // Beim ersten gültigen ViewerPose: Blöcke platzieren
    if (!this._placedBlocks) {
      const vp = frame.getViewerPose(this.refSpace);
      if (vp) {
        const p = vp.transform.position;
        const o = vp.transform.orientation;
        const viewerPos = new THREE.Vector3(p.x, p.y, p.z);
        const viewerQuat = new THREE.Quaternion(o.x, o.y, o.z, o.w);
        await this.blocks.ensureLoaded();
        this.blocks.placeRelativeTo(viewerPos, viewerQuat); // 1m vor, 0.4m über, 3 Stück
        this._placedBlocks = true;
      }
    }

    // Eingabe-Sphären (Controller/Hand)
    const session = this.renderer.xr.getSession();
    const spheres = getInteractionSpheres(frame, this.refSpace, session.inputSources);

    // Kollision Blöcke <-> Sphären → ggf. Coin-Burst
    const coinBursts = this.blocks.testHitsAndGetBursts(spheres);
    for (const b of coinBursts) {
      // Spawn Münze oberhalb des Blocks, normal nach oben
      this.coins.spawnBurst(b.spawnPos, b.upNormal);
      // Score erhöhen
      this.ui.setScore(this.coins.score);
    }

    // Coins animieren (Flug/Rotation/Auflösen)
    this.coins.update();

    // FPS
    this._frameCount++;
    const now = performance.now();
    if (now - this._lastFpsSample > 500) {
      const fps = Math.round((this._frameCount * 1000) / (now - this._lastFpsSample));
      this._frameCount = 0; this._lastFpsSample = now;
      this.ui.setFps(fps);
    }

    this.renderer.render(this.sceneRig.scene, this.sceneRig.camera);
  }
}
