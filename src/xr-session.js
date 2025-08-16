import { SceneRig } from './scene.js';
import { PlaneTracker } from './planes.js';
import { choosePlacements } from './placement.js';
import { CoinManager } from './coins.js';
import { getInteractionSpheres } from './input.js';

const THREE_URL = 'https://unpkg.com/three@0.166.1/build/three.module.js';
const { Scene, Group, Matrix4, Vector3, Quaternion } = await import(THREE_URL);

export class XRApp {
  constructor(ui) {
    this.ui = ui;
    this.renderer = null;
    this.sceneRig = null;
    this.refSpace = null;
    this.viewerSpace = null;

    this.support = {
      planes: false,
      anchors: false,
      hitTest: false,
      hands: false,
      domOverlay: false,
    };

    this.planeTracker = null;
    this.coins = null;
    this.world = new Group(); // Root for app content
    this.debugPlanes = false;

    this._lastFpsSample = performance.now();
    this._frameCount = 0;
  }

  async startAR() {
    // Session features
    const sessionInit = {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['plane-detection', 'hit-test', 'anchors', 'hand-tracking', 'dom-overlay'],
      domOverlay: { root: document.body }
    };

    const session = await navigator.xr.requestSession('immersive-ar', sessionInit);

    // Renderer + Scene
    this.sceneRig = new SceneRig();
    this.renderer = this.sceneRig.renderer;
    this.sceneRig.scene.add(this.world);

    // Reference spaces
    this.refSpace = await session.requestReferenceSpace('local-floor');
    this.viewerSpace = await session.requestReferenceSpace('viewer');

    // Feature availability (best-effort)
    this.support.domOverlay = !!session.domOverlayState;
    this.support.hitTest = typeof session.requestHitTestSource === 'function';
    this.support.anchors = 'createAnchor' in XRFrame.prototype || 'createAnchor' in XRHitTestResult.prototype;
    // Plane detection becomes visible only within frames; assume true if requested.
    this.support.planes = true;
    // Hands availability is per inputSource; we will probe per-frame.

    // Set up managers
    this.planeTracker = new PlaneTracker();
    this.coins = new CoinManager(this.sceneRig.scene);

    // XR binding
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');
    await this.renderer.xr.setSession(session);

    // Events
    session.addEventListener('end', () => {
      this.ui.setHudVisible(false);
      document.getElementById('start-ar').classList.remove('hidden');
      document.getElementById('start-ar').disabled = false;
      this.cleanup();
    });

    // Animation loop (Three.js passes XRFrame as 2nd arg in XR)
    this.renderer.setAnimationLoop((t, frame) => this.onXRFrame(t, frame));

    // Initial hint
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
    this.world = new Group();
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
    // Re-run placement on latest planes (or fallback)
    this._placeCoinsFromLatest();
  }

  async _placeCoinsFromLatest() {
    const frame = this._lastFrame;
    if (!frame) return;

    const { floorPlane, wallPlanes, planeCount } = this.planeTracker.classify(frame, this.refSpace);
    this.ui.setPlanes(planeCount);

    // If we have no detected planes, try hit-test fallback with viewer ray
    if (!floorPlane && !wallPlanes.length && this.support.hitTest) {
      const hitSource = await this.renderer.xr.getSession().requestHitTestSource({ space: this.viewerSpace });
      const hits = frame.getHitTestResults(hitSource);
      if (hits.length) {
        const hitPose = hits[0].getPose(this.refSpace);
        // Place a simple radial cluster around hit
        this.coins.spawnClusterAtPose(hitPose, { floorCount: 24, radius: 1.5 });
        hitSource.cancel();
        return;
      }
      hitSource.cancel();
      this.ui.toast('Keine Ebenen erkannt – bewege dich oder beleuchte den Raum besser.');
      return;
    }

    // Compute placements on planes
    const placements = choosePlacements(frame, this.refSpace, floorPlane, wallPlanes, {
      floorCount: 28, // anpassbar
      wallCountPerPlane: 6,
      minSpacing: 0.35
    });

    // Spawn coins at placements (create anchors if supported)
    const session = this.renderer.xr.getSession();
    const useAnchors = this.support.anchors;

    this.coins.clear();
    for (const p of placements) {
      await this.coins.spawnAtPose(frame, this.refSpace, p.pose, { useAnchors, session });
    }
  }

  async onXRFrame(t, frame) {
    this._lastFrame = frame;

    // Plane tracking update (populate tracker map, draw debug if enabled)
    const planeCount = this.planeTracker.update(frame, this.refSpace, this.sceneRig.scene);
    this.ui.setPlanes(planeCount);

    // First time we see planes → place coins
    if (!this._didPlaceInitial && (planeCount > 0 || !this.support.planes)) {
      this._didPlaceInitial = true;
      await this._placeCoinsFromLatest();
    }

    // Interaction spheres from controllers/hands
    const session = this.renderer.xr.getSession();
    const spheres = getInteractionSpheres(frame, this.refSpace, session.inputSources);
    this.coins.testCollect(spheres, frame, this.refSpace, this.ui);

    // Stats
    this._frameCount++;
    const now = performance.now();
    if (now - this._lastFpsSample > 500) {
      const fps = Math.round((this._frameCount * 1000) / (now - this._lastFpsSample));
      this._frameCount = 0;
      this._lastFpsSample = now;
      this.ui.setFps(fps);
    }

    // Render
    this.renderer.render(this.sceneRig.scene, this.sceneRig.camera);
  }
}
