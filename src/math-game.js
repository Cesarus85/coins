// ./math-game.js
import * as THREE from 'three';

export class MathGame {
  constructor(ui, scene) {
    this.ui = ui;
    this.scene = scene;
    this.blocks = [];
    this.correctIndex = 0;
    this.current = { a: 1, b: 1, sum: 2 };
    this.texCache = new Map();
  }

  attachBlocks(blocks) {
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
    this._newProblem(true);
  }

  handleHit(blockIndex) {
    if (blockIndex == null || !this.blocks[blockIndex]) return false;
    const isCorrect = (blockIndex === this.correctIndex);
    if (isCorrect) {
      this._newProblem(false);
    }
    return isCorrect;
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
    this.texCache.forEach(tex => tex.dispose?.());
    this.texCache.clear();
  }

  // ---------- intern ----------

  _newProblem() {
    // a + b, Summe <= 20
    const a = 1 + Math.floor(Math.random() * 10);
    const bMax = Math.min(20 - a, 10);
    const b = 1 + Math.floor(Math.random() * Math.max(1, bMax));
    const sum = a + b;
    this.current = { a, b, sum };
    this.ui?.setEquation?.(`${a} + ${b} = ?`);

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
    // Geometrie ist egal – wir skalieren/positionieren später je Block
    const geom = new THREE.PlaneGeometry(1, 1);

    const makeMat = () => {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        toneMapped: false,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2
      });
      return mat;
    };

    const planes = [];
    for (let i=0;i<6;i++) {
      const m = new THREE.Mesh(geom, makeMat());
      m.renderOrder = 100; // über der Blockoberfläche
      m.name = `label_face_${i}`;
      planes.push(m); g.add(m);
    }
    return g;
  }

  _resizeLabelGroupToBlock(block) {
    const mesh = block.mesh;
    const box = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    box.getSize(size);

    // Kantenlänge des Würfels (heuristisch: größte Dimension)
    const L = Math.max(size.x, size.y, size.z);
    const half = L * 0.5;

    // Sichtfläche ~ 70% der Seite
    const faceSize = L * 0.7;
    const eps = L * 0.02; // Abstand zur Oberfläche

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
