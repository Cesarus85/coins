// /src/xr-session.js
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

    // XR/Render
    this.renderer = null;
    this.sceneRig = null;
    this.refSpace = null;

    // Manager
    this.blocks = null;
    this.coins  = null;
    this.math   = null;
    this.fails  = null;

    // Welt-Root (für sauberes Aufräumen)
    this.world = new THREE.Group();

    // Timing
    this._prevTime = null;
    this._lastFpsSample = performance.now();
    this._frameCount = 0;

    // State
    this._placedBlocks = false;
    this._didWarmup = false;
  }

  async startAR() {
    // DOM Overlay als required, damit das Equation-Banner sicher sichtbar ist
    const sessionInit = {
      requiredFeatures: ['local-floor', 'dom-overlay'],
      optionalFeatures: ['hand-tracking'],
      domOverlay: { root: document.body }
    };

    // Szene & Renderer
    this.sceneRig = new SceneRig();
    this.renderer = this.sceneRig.renderer;
    this.sceneRig.scene.add(this.world);

    // Manager
    this.blocks = new BlocksManager(this.sceneRig.scene);
    this.coins  = new CoinManager(this.sceneRig.scene);
    this.math   = new MathGame(this.ui, this.sceneRig.scene);
    this.fails  = new FailManager(this.sceneRig.scene);

    // Preloads
    const preload = Promise.all([
      this.blocks.ensureLoaded?.(),
      this.coins.ensureLoaded?.(),
      this.fails.preload?.()
    ]);

    // XR-Session
    const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    await this.renderer.xr.setSession(session);

    // HUD sichtbar → zeigt auch Equation-Banner
    this.ui?.setHudVisible?.(true);

    // Optionale Renderoptimierung (falls in SceneRig vorhanden)
    this.sceneRig.xrTweak?.(this.renderer);

    // Referenzraum
    this.refSpace = await session.requestReferenceSpace('local-floor');

    // Session-Ende
    session.addEventListener('end', () => {
      try { this.ui?.setHudVisible?.(false); } catch {}
      this.cleanup();
    });

    // Preload + Pipeline-Warmup
    await preload;
    await this._warmupPipelinesOnce();

    // Renderloop starten
    this.renderer.setAnimationLoop((t, frame) => this.onXRFrame(t, frame));

    this.ui?.toast?.('Blöcke werden platziert …');
    return true;
  }

  end() {
    const session = this.renderer?.xr?.getSession?.();
    if (session) {
      try { session.end(); } catch (e) { console.warn('XR session end error:', e); }
    } else {
      this.cleanup();
    }
  }

  cleanup() {
    try { this.renderer?.setAnimationLoop(null); } catch {}

    // Manager freigeben
    try { this.math?.dispose?.(); } catch {}
    try { this.fails?.dispose?.(); } catch {}
    try { this.blocks?.dispose?.(); } catch {}

    // SceneRig freigeben
    try { this.sceneRig?.dispose?.(); } catch {}

    // Renderer freigeben
    try {
      if (this.renderer) {
        this.renderer.forceContextLoss?.();
        this.renderer.domElement?.remove?.();
      }
    } catch {}

    // Felder zurücksetzen
    this.renderer = null;
    this.sceneRig = null;
    this.refSpace = null;
    this.blocks = null;
    this.coins = null;
    this.math = null;
    this.fails = null;
    this.world = new THREE.Group();
    this._placedBlocks = false;
    this._prevTime = null;
    this._didWarmup = false;
  }

  async _warmupPipelinesOnce() {
    if (this._didWarmup) return;
    try {
      const preview = this.coins?._makePreviewInstance?.();
      if (preview) { preview.visible = false; this.sceneRig.scene.add(preview); }
      const xrCam = this.renderer.xr.getCamera(this.sceneRig.camera);
      this.renderer.compile(this.sceneRig.scene, xrCam);
      if (preview) preview.removeFromParent();
      this._didWarmup = true;
    } catch (e) {
      console.warn('Warmup skipped:', e);
    }
  }

  onXRFrame(_t, frame) {
    const now = performance.now();
    if (this._prevTime == null) this._prevTime = now;
    const dtMs = now - this._prevTime;
    this._prevTime = now;

    // Einmalige Platzierung, sobald Pose da ist
    if (!this._placedBlocks) {
      const pose = frame.getViewerPose(this.refSpace);
      if (pose) {
        const t = pose.transform;
        const viewerPos  = new THREE.Vector3(t.position.x, t.position.y, t.position.z);
        const viewerQuat = new THREE.Quaternion(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w);

        this.blocks.clear?.();
        this.blocks.placeAroundViewer?.(viewerPos, viewerQuat);
        this._placedBlocks = true;

        // Zahlen-Layer an die Blöcke + erste Aufgabe
        try { this.math?.attachBlocks?.(this.blocks.blocks); } catch (e) {
          console.warn('MathGame attach failed:', e);
        }
      }
    }

    // Eingabe-Sphären (Controller/Handtracking)
    const session = this.renderer.xr.getSession();
    const spheres = getInteractionSpheres(frame, this.refSpace, session.inputSources);

    // Idle-Animation der Blöcke
    this.blocks.updateIdle?.(dtMs);

    // Treffer prüfen
    const bursts = this.blocks.testHitsAndGetBursts?.(spheres) || [];
    if (bursts.length) {
      for (const b of bursts) {
        const hitIndex = this._nearestBlockIndex(b.spawnPos);
        const correct = !!this.math?.handleHit?.(hitIndex);

        if (correct) {
          // Richtige Antwort → Coins + Score
          this.coins.spawnBurst?.(b.spawnPos, b.upNormal);
          this.ui?.setScore?.(this.coins.score);
        } else {
          // Falsche Antwort → rotes X
          this.fails.spawn?.(b.spawnPos, b.upNormal);
        }
      }
    }

    // Effekte updaten
    this.coins.update?.(dtMs);
    this.fails.update?.(dtMs);

    // FPS im HUD
    this._frameCount++;
    if (now - this._lastFpsSample > 500) {
      const fps = Math.round((this._frameCount * 1000) / (now - this._lastFpsSample));
      this._frameCount = 0;
      this._lastFpsSample = now;
      this.ui?.setFps?.(fps);
    }

    // Rendern
    this.renderer.render(this.sceneRig.scene, this.sceneRig.camera);
  }

  // Hilfsfunktion: index des Blocks, der dem Trefferpunkt am nächsten liegt
  _nearestBlockIndex(pos) {
    const list = this.blocks?.blocks;
    if (!list?.length) return null;

    let bestI = 0;
    let bestD = Infinity;
    const tmp = new THREE.Vector3();

    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b?.mesh) continue;
      b.mesh.getWorldPosition(tmp);
      const d = tmp.distanceTo(pos);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    return bestI;
  }
}
