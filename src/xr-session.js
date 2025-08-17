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

  /**
   * Einmaliges Warmup: Alle Shader/Programme kompilieren, bevor das Spiel „richtig“ loslegt.
   * - Läuft nach Platzierung der Blöcke und nachdem die Münz-/Block-Modelle geladen sind.
   * - Legt kurz ein unsichtbares Coin-Exemplar an, damit Material-/Skin-Varianten kompiliert werden.
   */
  async _warmupPipelinesOnce() {
    if (this._didWarmup) return;
    try {
      // Sicherstellen, dass Templates geladen sind
      await this.blocks.ensureLoaded();
      await this.coins.ensureLoaded();

      // Temporäres, unsichtbares Coin-Exemplar hinzufügen, damit die Pipeline alle Pfade sieht
      const tempCoin = this.coins._makePreviewInstance?.();
      if (tempCoin) {
        tempCoin.visible = false;
        this.sceneRig.scene.add(tempCoin);
      }

      // WebXR-Kamera vom Renderer holen und compilieren
      const xrCam = this.renderer.xr.getCamera(this.sceneRig.camera);
      this.renderer.compile(this.sceneRig.scene, xrCam);

      // Ein „Trocken-Render“ (ohne sichtbare Änderung) hilft einigen Runtimes zusätzlich
      this.renderer.render(this.sceneRig.scene, this.sceneRig.camera);

      // Aufräumen
      if (tempCoin) tempCoin.removeFromParent();

      this._didWarmup = true;
      // Optionales Feedback
      // this.ui.toast('Pipelines vorgewärmt.');
    } catch (e) {
      console.warn('Warmup fehlgeschlagen (wird übersprungen):', e);
    }
  }

  cleanup() {
    // Renderloop stoppen
    try { this.renderer?.setAnimationLoop(null); } catch {}
    // Three-Objekte freigeben
    try { this.sceneRig?.dispose(); } catch {}

    // WebGL-Context explizit freigeben (wichtig gegen „Context-Leaks“)
    try {
      if (this.renderer) {
        this.renderer.forceContextLoss?.();
        this.renderer.domElement?.remove();
      }
    } catch {}

    // Referenzen löschen
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

    // Beim ersten gültigen ViewerPose: Blöcke platzieren → dann Warmup
    if (!this._placedBlocks) {
      const vp = frame.getViewerPose(this.refSpace);
      if (vp) {
        const p = vp.transform.position;
        const o = vp.transform.orientation;
        const viewerPos = new THREE.Vector3(p.x, p.y, p.z);
        const viewerQuat = new THREE.Quaternion(o.x, o.y, o.z, o.w);

        await this.blocks.ensureLoaded();
        this.blocks.placeAroundViewer(viewerPos, viewerQuat);
        this._placedBlocks = true;

        // Direkt nach Platzierung + geladenen Assets: Pipelines vorwärmen
        await this._warmupPipelinesOnce();
      }
    }

    // Eingabe-Sphären (Controller/Hand)
    const session = this.renderer.xr.getSession();
    const spheres = getInteractionSpheres(frame, this.refSpace, session.inputSources);

    // Idle-Rotation + Bounce/Hit
    this.blocks.updateIdle(dtMs);
    const coinBursts = this.blocks.testHitsAndGetBursts(spheres);
    for (const b of coinBursts) {
      this.coins.spawnBurst(b.spawnPos, b.upNormal);
      this.ui.setScore(this.coins.score);
    }

    // Coins animieren (Flug/Rotation/Auflösen)
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
