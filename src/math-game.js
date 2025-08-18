// ./src/math-game.js
import * as THREE from 'three';

/**
 * Erzeugt Additionsaufgaben (Summe <= 20), verteilt die Ergebnisse auf 4 Würfel,
 * rendert die Zahlen als Canvas-Texturen auf ALLEN 6 Seiten je Würfel,
 * wertet Treffer aus und erzeugt bei richtig sofort die nächste Aufgabe.
 *
 * Erwartet, dass attachBlocks() mit dem Array aus BlocksManager.blocks aufgerufen wird.
 * Jedes Block-Objekt benötigt mindestens { mesh: THREE.Object3D }.
 */
export class MathGame {
  constructor(ui, scene) {
    this.ui = ui;
    this.scene = scene;

    /** @type {{mesh: THREE.Object3D, labelGroup?: THREE.Group}[]} */
    this.blocks = [];
    this.correctIndex = 0;
    this.current = { a: 1, b: 1, sum: 2 };

    /** Cache für Canvas-Texturen pro Zahl */
    this.texCache = new Map();
  }

  /** Muss nach dem Platzieren der Blöcke aufgerufen werden. */
  attachBlocks(blocks) {
    this.blocks = blocks || [];
    for (const b of this.blocks) {
      if (!b?.mesh) continue;
      if (!b.labelGroup) {
        b.labelGroup = this._createLabelGroup();
        b.mesh.add(b.labelGroup);
      }
      this._resizeLabelGroupToBlock(b);
    }
    this._newProblem(true);
  }

  /** true, wenn der getroffene Block korrekt war (dann direkt neue Aufgabe). */
  handleHit(blockIndex) {
    if (blockIndex == null || !this.blocks[blockIndex]) return false;
    const ok = (blockIndex === this.correctIndex);
    if (ok) this._newProblem(false);
    return ok;
  }

  /** Ressourcen aufräumen (Labels/Textures) */
  dispose() {
    for (const b of this.blocks) {
      if (!b?.labelGroup) continue;
      b.labelGroup.traverse(o => {
        if (o.isMesh && o.material?.map) o.material.map.dispose?.();
        if (o.isMesh && o.material) o.material.dispose?.();
        if (o.geometry) o.geometry.dispose?.();
      });
      b.labelGroup.removeFromParent();
      b.labelGroup = undefined;
    }
    this.texCache.forEach(t => t.dispose?.());
    this.texCache.clear();
  }

  // --------- intern ------------

  _newProblem() {
    // a + b mit Summe <= 20, a,b >= 1
    const a = 1 + Math.floor(Math.random() * 10); // 1..10
    const bMax = Math.min(20 - a, 10);
    const b = 1 + Math.floor(Math.random() * Math.max(1, bMax));
    const sum = a + b;

    this.current = { a, b, sum };
    this.ui?.setEquation?.(`${a} + ${b} = ?`);

    const n = Math.min(4, this.blocks.length);
    if (n === 0) return;

    // korrekter Index
    this.correctIndex = Math.floor(Math.random() * n);

    // falsche Werte generieren (einzigartig, != sum)
    const wrongs = new Set();
    while (wrongs.size < n - 1) {
      const delta = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 5));
      const val = Math.max(0, Math.min(20, sum + delta));
      if (val !== sum) wrongs.add(val);
    }
    const values = [];
    for (let i = 0, w = 0; i < n; i++) {
      if (i === this.correctIndex) values.push(sum);
      else values.push([...wrongs][w++]);
    }

    // Labels aktualisieren
    for (let i = 0; i < n; i++) this._setBlockNumber(this.blocks[i], values[i]);
  }

  _createLabelGroup() {
    const g = new THREE.Group();

    // Geometrie (Skalierung folgt block-spezifisch)
    const geom = new THREE.PlaneGeometry(1, 1);

    const makeMat = () => {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        toneMapped: false,
        depthTest: true,      // wichtig: nicht durch den Würfel hindurch zeichnen
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      });
      mat.opacity = 1.0;
      return mat;
    };

    // 6 Planes (eine pro Seite)
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geom, makeMat());
      m.renderOrder = 10; // vor dem Block
      g.add(m);
    }

    return g;
  }

  /** Positioniert & skaliert die Label-Gruppe exakt auf die Außenflächen (unabhängig vom Pivot). */
  _resizeLabelGroupToBlock(block) {
    const mesh = block.mesh;
    if (!mesh) return;

    // Welt-BBox des Blocks
    const worldBox = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3(); worldBox.getSize(size);
    const worldCenter = new THREE.Vector3(); worldBox.getCenter(worldCenter);

    // BBox-Zentrum in lokale Koordinaten des Blocks
    const localCenter = mesh.worldToLocal(worldCenter.clone());
    block.labelGroup.position.copy(localCenter);

    // Kantenlänge & Offsets
    const L = Math.max(size.x, size.y, size.z);
    const half = L * 0.5;
    const faceSize = L * 0.70;   // 70% der Fläche
    const eps = L * 0.02;        // vor die Oberfläche (gegen Z-Fighting)

    // Planes skalieren
    const planes = block.labelGroup.children;
    for (const p of planes) p.scale.set(faceSize, faceSize, 1);

    // Seiten korrekt positionieren/ausrichten (relativ zum lokalen Zentrum)
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
      if (o.isMesh && o.material) {
        o.material.map = tex;
        o.material.needsUpdate = true;
      }
    });
  }

  _getOrMakeNumberTexture(text) {
    if (this.texCache.has(text)) return /** @type {THREE.Texture} */(this.texCache.get(text));

    const size = 512;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');

    // transparent
    ctx.clearRect(0, 0, size, size);

    // Outline
    ctx.font = `${size * 0.62}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.06;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, size / 2, size / 2);

    // Füllung
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, size / 2, size / 2);

    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    tex.needsUpdate = true;

    this.texCache.set(text, tex);
    return tex;
  }
}
