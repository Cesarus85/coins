// ./xr-session.js
import * as THREE from 'three';
import { SceneRig } from './scene.js';
import { BlocksManager } from './blocks.js';
import { CoinManager } from './coins.js';
import { getInteractionSpheres } from './input.js';

// NEU: Mathe-Spiel & Fail-Effekt
import { MathGame } from './math-game.js';
import { FailManager } from './fails.js';
import { GrooveCharacterManager } from './groove-character.js';

export class XRApp {
  constructor(ui) {
    this.ui = ui;

    // Renderer & Szene
    this.renderer = null;
    this.sceneRig = null;
    this.refSpace = null;
    this.viewerSpace = null;

    // Manager
    this.blocks = null;
    this.coins = null;
    this.math = null;     // NEU
    this.fails = null;    // NEU
    this.grooveCharacter = null;

    // Eigenes Wurzelobjekt (gut zum Aufräumen)
    this.world = new THREE.Group();

    // Takt / FPS
    this._lastFpsSample = performance.now();
    this._frameCount = 0;
    this._lastFrame = null;

    // Ablauf-Flags
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

    // Renderer + SceneRig
    this.sceneRig = new SceneRig();
    this.renderer = this.sceneRig.renderer;
    this.sceneRig.scene.add(this.world);

    // Manager anlegen
    this.blocks = new BlocksManager(this.sceneRig.scene);
    this.coins  = new CoinManager(this.sceneRig.scene);
    this.fails  = new FailManager(this.sceneRig.scene);
    this.math   = new MathGame(this.ui, this.sceneRig.scene, this.fails);
    this.grooveCharacter = new GrooveCharacterManager(this.sceneRig.scene);

    // Assets / Pools vorladen
    const preload = Promise.all([
      this.blocks.ensureLoaded(),
      this.coins.ensureLoaded(),
      this.fails.preload(),
      this.grooveCharacter.ensureLoaded()
    ]);

    // XR-Session
    const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    await this.renderer.xr.setSession(session);
    this.ui.setHudVisible?.(true);   // zeigt auch die Equation an


    // Optionales Tuning (Foveation/Scale) – falls in SceneRig implementiert
    this.sceneRig.xrTweak?.(this.renderer);

    // Referenzräume
    this.refSpace   = await session.requestReferenceSpace('local-floor');
    this.viewerSpace = await session.requestReferenceSpace('viewer');

    // Session-Ende sauber behandeln
    session.addEventListener('end', () => {
      try { this.ui.setHudVisible?.(false); } catch {}
      this.cleanup();
    });

    // Auf Preload warten und Pipelines „anschwitzen“ (Shader compile etc.)
    await preload;
    await this._warmupPipelinesOnce();

    // Render-Loop
    this.renderer.setAnimationLoop((t, frame) => this.onXRFrame(t, frame));
    this.ui.toast?.('Blöcke werden platziert …');
    return true;
  }

  end() {
    const session = this.renderer?.xr?.getSession();
    if (session) {
      try { session.end(); } catch (e) { console.warn('Session end error', e); }
    } else {
      this.cleanup();
    }
  }

  cleanup() {
    // Animations-Loop stoppen
    try { this.renderer?.setAnimationLoop(null); } catch {}

    // Manager entsorgen
    try { this.math?.dispose?.(); } catch {}
    try { this.fails?.dispose?.(); } catch {}
    try { this.blocks?.dispose?.(); } catch {}
    try { this.grooveCharacter?.dispose?.(); } catch {}

    // SceneRig entsorgen
    try { this.sceneRig?.dispose?.(); } catch {}

    // Renderer freigeben
    try {
      if (this.renderer) {
        this.renderer.forceContextLoss?.();
        this.renderer.domElement?.remove();
      }
    } catch {}

    // Felder zurücksetzen
    this.renderer = null;
    this.sceneRig = null;
    this.blocks = null;
    this.coins = null;
    this.math = null;
    this.fails = null;
    this.grooveCharacter = null;

    this.world = new THREE.Group();
    this._placedBlocks = false;
    this._prevTime = null;
    this._didWarmup = false;
  }

  async _warmupPipelinesOnce() {
    if (this._didWarmup) return;
    try {
      // Coins einmal „durch die Pipeline drücken“
      const tempCoin = this.coins._makePreviewInstance?.();
      if (tempCoin) { tempCoin.visible = false; this.sceneRig.scene.add(tempCoin); }

      // Compile im XR-Kontext
      const xrCam = this.renderer.xr.getCamera(this.sceneRig.camera);
      this.renderer.compile(this.sceneRig.scene, xrCam);

      if (tempCoin) tempCoin.removeFromParent();
      this._didWarmup = true;
    } catch (e) {
      console.warn('Warmup übersprungen:', e);
    }
  }

  onXRFrame(t, frame) {
    const now = performance.now();
    if (this._prevTime == null) this._prevTime = now;
    const dtMs = now - this._prevTime;
    this._prevTime = now;

    this._lastFrame = frame;

    // Einmalige Platzierung der Blöcke, wenn ViewerPose vorliegt
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

        // NEU: Zahlen-Labels auf alle Würfel & erste Aufgabe
        try { this.math?.attachBlocks(this.blocks.blocks, viewerPos, viewerQuat); } catch (e) { console.warn('Math attach failed', e); }

        // Groove-Charakter platzieren
        try { this.grooveCharacter?.placeCharacter(viewerPos, viewerQuat); } catch (e) { console.warn('Groove character placement failed', e); }

        console.log('[Blocks] placed:', this.blocks.blocks?.length ?? 0);
      }
    }

    // Eingabe-Sphären (Controller + Handtracking)
    const session = this.renderer.xr.getSession();
    const spheres = getInteractionSpheres(frame, this.refSpace, session.inputSources);

    // Gleichungsposition aktualisieren basierend auf Viewer-Position
    const vp = frame.getViewerPose(this.refSpace);
    if (vp && this.math) {
      const p = vp.transform.position;
      const o = vp.transform.orientation;
      const viewerPos = new THREE.Vector3(p.x, p.y, p.z);
      const viewerQuat = new THREE.Quaternion(o.x, o.y, o.z, o.w);
      this.math.updateEquationPosition(viewerPos, viewerQuat);
    }

    // Idle-Animation der Blöcke
    this.blocks.updateIdle(dtMs);

    // Treffer prüfen
    const bursts = this.blocks.testHitsAndGetBursts(spheres);
    if (bursts.length) {
      for (const b of bursts) {
        const hitIndex = this._nearestBlockIndex(b.spawnPos);
        const correct = !!this.math?.handleHit?.(hitIndex, b.spawnPos);

        if (correct) {
          // Richtiger Würfel → Coins + Score
          this.coins.spawnBurst(b.spawnPos, b.upNormal);
          this.ui.setScore?.(this.coins.score);
        }
        // Falscher Würfel wird bereits von MathGame.handleHit() behandelt
      }
    }

    // Effekte updaten
    this.coins.update(dtMs);
    this.fails.update(dtMs);
    this.grooveCharacter.update(dtMs);

    // FPS im HUD
    this._frameCount++;
    if (now - this._lastFpsSample > 500) {
      const fps = Math.round((this._frameCount * 1000) / (now - this._lastFpsSample));
      this._frameCount = 0; this._lastFpsSample = now;
      this.ui.setFps?.(fps);
    }

    // Rendern
    this.renderer.render(this.sceneRig.scene, this.sceneRig.camera);
  }

  // Ermittelt den index des am nächsten gelegenen Blocks zu einer Position (Trefferpunkt)
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
