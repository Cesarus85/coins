import * as THREE from 'https://unpkg.com/three@0.166.1/build/three.module.js';
import { SceneRig } from './scene.js';
import { PlaneTracker } from './planes.js';
import { choosePlacements } from './placement.js';
import { CoinManager } from './coins.js';
import { getInteractionSpheres } from './input.js';

export class XRApp {
  constructor(ui) {
    this.ui = ui;
    this.renderer = null;
    this.sceneRig = null;
    this.refSpace = null;
    this.viewerSpace = null;

    this.support = { planes: false, anchors: false, hitTest: false, hands: false, domOverlay: false };
    this.planeTracker = null;
    this.coins = null;
    this.world = new THREE.Group();
    this.debugPlanes = false;

    this._lastFpsSample = performance.now();
    this._frameCount = 0;
    this._didPlaceInitial = false;
    this._lastFrame = null;
  }

  async startAR() {
    const sessionInit = {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['plane-detection', 'hit-test', 'anchors', 'hand-tracking', 'dom-overlay'],
      domOverlay: { root: document.body }
    };
    const session = await navigator.xr.requestSession('immersive-ar', sessionInit);

    this.sceneRig = new SceneRig();
    this.renderer = this.sceneRig.renderer;
    this.sceneRig.scene.add(this.world);

    this.refSpace = await session.requestReferenceSpace('local-floor');
    this.viewerSpace = await session.requestReferenceSpace('viewer');

    this.support.domOverlay = !!session.domOverlayState;
    this.support.hitTest = typeof session.requestHitTestSource === 'function';
    this.support.anchors = ('createAnchor' in XRFrame.prototype) || ('createAnchor' in XRHitTestResult.prototype);
    this.support.planes = true;

    this.planeTracker = new PlaneTracker();
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
    this.ui.toast('Scanne Boden & Wände – Münzen erscheinen automatisch.');
    return true;
  }

  cleanup() {
    this.renderer?.setAnimationLoop(null);
    this.renderer?.dispose();
    this.sceneRig?.dispose();
    this.renderer = null;
    this.sceneRig = null;
    this.planeTracker = null;
    this.coins = null;
    this.world = new THREE.Group();
    this._didPlaceInitial = false;
  }

  end() {
    const session = this.renderer?.xr?.getSession();
    if (session) session.end();
  }

  setDebugPlanes(enabled) {
    this.debugPlanes = enabled;
    this.planeTracker?.setDebug(enabled, this.sceneRig?.scene);
  }

  respawnCoins() {
    this._placeCoinsFromLatest();
  }

  async _placeCoinsFromLatest() {
    const frame = this._lastFrame;
    if (!frame) return;

    const { floorPlane, wallPlanes, planeCount } = this.planeTracker.classify(frame, this.refSpace);
    this.ui.setPlanes(planeCount);

    const viewerPose = frame.getViewerPose(this.refSpace);
    const viewerPos = viewerPose ? new THREE.Vector3(
      viewerPose.transform.position.x,
      viewerPose.transform.position.y,
      viewerPose.transform.position.z
    ) : new THREE.Vector3();

    if (!floorPlane && !wallPlanes.length && this.support.hitTest) {
      const hitSource = await this.renderer.xr.getSession().requestHitTestSource({ space: this.viewerSpace });
      const hits = frame.getHitTestResults(hitSource);
      if (hits.length) {
        const hitPose = hits[0].getPose(this.refSpace);
        this.coins.spawnClusterAtPose(hitPose, { floorCount: 10, radius: 0.8 });
        hitSource.cancel();
        return;
      }
      hitSource.cancel();
      this.ui.toast('Keine Ebenen erkannt – bewege dich oder beleuchte den Raum besser.');
      return;
    }

    // Placements bestimmen
    let placements = choosePlacements(frame, this.refSpace, floorPlane, wallPlanes, {
      floorCount: 16,
      wallCountPerPlane: 3,
      minSpacing: 0.5
    });

    // **Spielbereich einschränken**: max. Distanz zum Viewer (z. B. 4 m)
    const MAX_DIST = 4.0;
    placements = placements.filter(p => {
      const d = viewerPos.distanceTo(p.pose.position);
      return d <= MAX_DIST;
    });

    const useAnchors = this.support.anchors;
    this.coins.clear();
    for (const p of placements) {
      await this.coins.spawnAtPose(frame, this.refSpace, p.pose, {
        useAnchors,
        meta: { kind: p.kind, normal: p.normal }
      });
    }
  }

  async onXRFrame(t, frame) {
    this._lastFrame = frame;

    const planeCount = this.planeTracker.update(frame, this.refSpace, this.sceneRig.scene);
    this.ui.setPlanes(planeCount);

    if (!this._didPlaceInitial && (planeCount > 0 || !this.support.planes)) {
      this._didPlaceInitial = true;
      await this._placeCoinsFromLatest();
    }

    const session = this.renderer.xr.getSession();
    const spheres = getInteractionSpheres(frame, this.refSpace, session.inputSources);
    this.coins.testCollect(spheres, frame, this.refSpace, this.ui);

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
