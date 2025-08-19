// ./math-game.js
import * as THREE from 'three';
import { EquationDisplay } from './equation-display.js';

export class MathGame {
  constructor(ui, scene, failManager = null) {
    this.ui = ui;
    this.scene = scene;
    this.failManager = failManager;
    this.blocks = [];
    this.correctIndex = 0;
    this.current = { a: 1, b: 1, sum: 2 };
    this.texCache = new Map();
    this.equationDisplay = new EquationDisplay(scene);
  }

  attachBlocks(blocks, viewerPos = null, viewerQuat = null) {
    this.blocks = blocks || [];
    // Label-Gruppen anlegen/skalieren
    this.blocks.forEach((b) => {
      if (!b?.mesh) return;
      if (!b.labelGroup) {
        b.labelGroup = this._createLabelGroup();
        b.mesh.add(b.labelGroup);
      }
      this._resizeLabelGroupToBlock(b);
    });

    // 3D Gleichungsanzeige erstellen falls Viewer-Position verfügbar
    if (viewerPos && viewerQuat) {
      this.equationDisplay.createDisplay(viewerPos, viewerQuat);
    }

    this._newProblem(true);
  }

  handleHit(blockIndex, hitPosition = null) {
    if (blockIndex == null || !this.blocks[blockIndex]) return false;
    const isCorrect = (blockIndex === this.correctIndex);
    if (isCorrect) {
      this._newProblem(false);
    } else {
      // Falsche Antwort: Spawn Fail-Animation
      if (this.failManager && hitPosition) {
        this.failManager.spawn(hitPosition, new THREE.Vector3(0, 1, 0));
      }
    }
    return isCorrect;
  }

  updateEquationPosition(viewerPos, viewerQuat) {
    this.equationDisplay.updatePosition(viewerPos, viewerQuat);
  }

  dispose() {
    for (const b of this.blocks) {
      if (b?.labelGroup) {
        b.labelGroup.traverse(o => {
          if (o.isMesh && o.material?.map) o.material.map.dispose?.();
          if (o.isMesh && o.material) o.material.dispose?.();
          if (o.geometry) o.geometry.dispose?.();
        });
        b.labelGroup.removeFromParent();
        b.labelGroup = undefined;
      }
    }
    this.equationDisplay.dispose();
    this.texCache.forEach(tex => tex.dispose?.());
    this.texCache.clear();
  }

  // ---------- intern ----------

  _newProblem(isFirst = false) {
    // a + b, Summe <= 20
    const a = 1 + Math.floor(Math.random() * 10);
    const bMax = Math.min(20 - a, 10);
    const b = 1 + Math.floor(Math.random() * Math.max(1, bMax));
    const sum = a + b;
    this.current = { a, b, sum };
    const equationText = `${a} + ${b} = ?`;
    this.ui?.setEquation?.(equationText);
    this.equationDisplay.updateEquation(equationText);

    // Zufälliger Index für korrekte Antwort
    this.correctIndex = Math.floor(Math.random() * Math.min(4, this.blocks.length));

    // 3 plausible Falschantworten
    const answers = new Set([sum]);
    const candidates = new Set();
    for (const d of [-3,-2,-1,1,2,3,4,-4]) {
      const v = sum + d; if (v >= 0 && v <= 20) candidates.add(v);
    }
    while (candidates.size < 8) candidates.add(Math.floor(Math.random() * 21));
    const wrong = [];
    for (const v of candidates) { if (!answers.has(v)) { wrong.push(v); answers.add(v); } if (wrong.length >= 3) break; }

    // 4 Werte verteilen
    const values = Array(Math.min(4, this.blocks.length)).fill(null);
    if (values.length > 0) values[this.correctIndex] = sum;
    let wi = 0;
    for (let i=0;i<values.length;i++) { if (i !== this.correctIndex) values[i] = wrong[wi++]; }

    // Auf die Blöcke mappen
    for (let i=0;i<values.length;i++) this._setBlockNumber(this.blocks[i], values[i]);
  }

  _createLabelGroup() {
    const g = new THREE.Group();
    const makeMat = () => {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        toneMapped: false,
        depthTest: false,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -10,
        polygonOffsetUnits: -10
      });
      return mat;
    };

    const planes = [];
    for (let i = 0; i < 6; i++) {
      const geom = this._createPlaneGeometryForFace(i);
      const m = new THREE.Mesh(geom, makeMat());
      m.renderOrder = 1000; // sehr hohe Priorität über der Blockoberfläche
      m.name = `label_face_${i}`;
      m.frustumCulled = false; // immer rendern
      planes.push(m); g.add(m);
    }
    return g;
  }

  _createPlaneGeometryForFace(faceIndex) {
    const geom = new THREE.PlaneGeometry(1, 1);
    const uvs = geom.attributes.uv.array;

    // Define UV transform function for each face to make text upright and unmirrored
    let transform = (u, v) => ({ u, v }); // Default: no change
    switch (faceIndex) {
      case 0: // +X (right face): Rotate UV 90° counterclockwise to counteract the -90° Y rotation
        transform = (u, v) => ({ u: 1 - v, v: u });
        break;
      case 1: // -X (left face): Rotate UV 90° clockwise to counteract the +90° Y rotation
        transform = (u, v) => ({ u: v, v: 1 - u });
        break;
      case 2: // +Y (top face): Flip U if text appears reversed; alternative: (u, 1 - v) if upside down
        transform = (u, v) => ({ u: 1 - u, v: v });
        break;
      case 3: // -Y (bottom face): Flip V if upside down; alternative: (1 - u, v) if reversed
        transform = (u, v) => ({ u: u, v: 1 - v });
        break;
      case 4: // +Z (front face): No change needed
        break;
      case 5: // -Z (back face): Flip U horizontally to fix mirroring from 180° Y rotation
        transform = (u, v) => ({ u: 1 - u, v: v });
        break;
    }

    // Apply transform to the 4 UV coordinates (original: [0,0, 1,0, 0,1, 1,1])
    const origUvs = [0, 0, 1, 0, 0, 1, 1, 1];
    for (let j = 0; j < 4; j++) {
      const ou = origUvs[j * 2];
      const ov = origUvs[j * 2 + 1];
      const tv = transform(ou, ov);
      uvs[j * 2] = tv.u;
      uvs[j * 2 + 1] = tv.v;
    }

    geom.attributes.uv.needsUpdate = true;
    return geom;
  }

  _resizeLabelGroupToBlock(block) {
    const mesh = block.mesh;
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);

    // Kantenlänge des Würfels (heuristisch: größte Dimension)
    const L = Math.max(size.x, size.y, size.z);
    const half = L * 0.5;

    // Sichtfläche ~ 80% der Seite, aber größerer Abstand zur Oberfläche
    const faceSize = L * 0.8;
    const eps = L * 0.1; // Größerer Abstand zur Oberfläche

    // Alle 6 Planes passend anordnen
    const planes = block.labelGroup.children;
    for (const p of planes) { p.scale.set(faceSize, faceSize, 1); }

    // +X / -X
    planes[0].position.set( half + eps, 0, 0); planes[0].rotation.set(0, -Math.PI/2, 0);
    planes[1].position.set(-half - eps, 0, 0); planes[1].rotation.set(0,  Math.PI/2, 0);
    // +Y / -Y
    planes[2].position.set(0,  half + eps, 0); planes[2].rotation.set( Math.PI/2, 0, 0);
    planes[3].position.set(0, -half - eps, 0); planes[3].rotation.set(-Math.PI/2, 0, 0);
    // +Z / -Z
    planes[4].position.set(0, 0,  half + eps); planes[4].rotation.set(0, 0, 0);
    planes[5].position.set(0, 0, -half - eps); planes[5].rotation.set(0,  Math.PI, 0);
  }

  _setBlockNumber(block, value) {
    if (!block?.labelGroup) return;
    const text = String(value);
    const tex = this._getOrMakeNumberTexture(text);
    block.labelGroup.traverse(o => {
      if (o.isMesh && o.material) { o.material.map = tex; o.material.needsUpdate = true; }
    });
  }

  _getOrMakeNumberTexture(text) {
    if (this.texCache.has(text)) return this.texCache.get(text);
    const size = 512;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0,0,size,size);

    // weiche Outline + Schatten
    ctx.font = 'bold 360px system-ui, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillText(text, size/2 + 6, size/2 + 8);

    // Stroke
    ctx.lineWidth = 18;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(text, size/2, size/2);

    // Fill
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, size/2, size/2);

    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4; tex.needsUpdate = true;
    this.texCache.set(text, tex);
    return tex;
  }
}
```