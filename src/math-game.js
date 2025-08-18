// ./src/math-game.js
import * as THREE from 'three';

/**
 * Erzeugt Additionsaufgaben (Summe <= 20), verteilt die Ergebnisse auf 4 Würfel,
 * rendert die Zahlen als Canvas-Texturen und klebt sie als 6 Planes auf die Würfelflächen.
 * Richtige Antwort triggert sofort die nächste Aufgabe.
 */
export class MathGame {
  constructor(ui, scene) {
    this.ui = ui;
    this.scene = scene;

    /** @type {{mesh: THREE.Object3D, labelGroup?: THREE.Group, answer?: number}[]} */
    this.blocks = [];
    this.correctIndex = 0;

    this.problem = { a: 1, b: 1, sum: 2 };
    this.texCache = new Map(); // Map<string, THREE.Texture>
  }

  /** Von außen: Blöcke registrieren (Array mit { mesh: Object3D }) */
  setBlocks(blocks) {
    this.blocks = blocks;
    // eventuelle alte Labels entfernen
    for (const b of this.blocks) this._clearLabels(b);
    this._newProblem();
  }

  /** Wird vom XR-Loop aufgerufen, wenn ein Block getroffen wurde. */
  handleHit(blockIndex) {
    if (blockIndex === this.correctIndex) {
      this.ui.toast('Richtig! 🎉', 900);
      this._newProblem();
      return true; // korrekt
    } else {
      this.ui.toast('Leider falsch!', 900);
      return false;
    }
  }

  /** Aufräumen */
  dispose() {
    for (const b of this.blocks) this._clearLabels(b);
    this.blocks.length = 0;
    this.texCache.forEach(t => t.dispose?.());
    this.texCache.clear();
  }

  // ---------- intern ----------

  _newProblem() {
    // a + b, Summe <= 20, a,b >= 1
    const a = 1 + Math.floor(Math.random() * 10);         // 1..10
    const bMax = Math.min(20 - a, 10);
    const b = 1 + Math.floor(Math.random() * Math.max(1, bMax)); // 1..bMax (mind. 1)
    const sum = a + b;

    this.problem = { a, b, sum };
    this.ui.setEquation(`${a} + ${b} = ?`, true);

    // Antworten zusammenstellen
    const answers = new Set([sum]);
    while (answers.size < Math.min(4, this.blocks.length)) {
      const r = 1 + Math.floor(Math.random() * 20);
      if (r !== sum) answers.add(r);
    }
    const arr = Array.from(answers);
    // auf verfügbare Blockanzahl kürzen/auffüllen
    while (arr.length < this.blocks.length) {
      let r = 1 + Math.floor(Math.random() * 20);
      if (r === sum) r = ((r + 1) % 20) + 1;
      arr.push(r);
    }

    // richtige Position mischen
    this.correctIndex = Math.floor(Math.random() * this.blocks.length);
    [arr[0], arr[this.correctIndex]] = [arr[this.correctIndex], arr[0]];

    // Labels aktualisieren
    for (let i = 0; i < this.blocks.length; i++) {
      const b = this.blocks[i];
      b.answer = arr[i];
      this._applyLabelsToCube(b.mesh, b, String(arr[i]));
    }
  }

  _applyLabelsToCube(cube, blockEntry, text) {
    // alte Labels weg
    this._clearLabels(blockEntry);

    // Dimensionen des Würfels ermitteln
    const box = new THREE.Box3().setFromObject(cube);
    const size = new THREE.Vector3();
    box.getSize(size);
    const half = size.multiplyScalar(0.5);

    // kleine Epsilon-Abstandsverschiebung, damit Planes nicht mit der Oberfläche z-fighting haben
    const eps = 0.002;
    const planeSize = Math.min(half.x, half.y, half.z) * 1.8; // etwas kleiner als Kante

    const geo = new THREE.PlaneGeometry(planeSize, planeSize);
    const tex = this._getTextTexture(text);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: true });

    // 6 Flächen: +X, -X, +Y, -Y, +Z, -Z
    const group = new THREE.Group();

    // +X
    group.add(this._makeFace(geo, mat, new THREE.Vector3( half.x + eps, 0, 0), new THREE.Euler(0, -Math.PI/2, 0)));
    // -X
    group.add(this._makeFace(geo, mat, new THREE.Vector3(-half.x - eps, 0, 0), new THREE.Euler(0,  Math.PI/2, 0)));
    // +Y
    group.add(this._makeFace(geo, mat, new THREE.Vector3(0,  half.y + eps, 0), new THREE.Euler(-Math.PI/2, 0, 0)));
    // -Y
    group.add(this._makeFace(geo, mat, new THREE.Vector3(0, -half.y - eps, 0), new THREE.Euler( Math.PI/2, 0, 0)));
    // +Z (Front)
    group.add(this._makeFace(geo, mat, new THREE.Vector3(0, 0,  half.z + eps), new THREE.Euler(0, Math.PI, 0)));
    // -Z (Back)
    group.add(this._makeFace(geo, mat, new THREE.Vector3(0, 0, -half.z - eps), new THREE.Euler(0, 0, 0)));

    cube.add(group);
    blockEntry.labelGroup = group;
  }

  _makeFace(geo, mat, pos, rot) {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    m.rotation.set(rot.x, rot.y, rot.z);
    // leichte Polygon-Offset gegen Z-Fighting (falls Materialien der Würfel stark glitzern)
    m.material.polygonOffset = true;
    m.material.polygonOffsetFactor = -1;
    m.material.polygonOffsetUnits = -1;
    return m;
  }

  _clearLabels(b) {
    if (b?.labelGroup) {
      b.labelGroup.removeFromParent();
      b.labelGroup.traverse(o => {
        if (o.isMesh) {
          o.geometry?.dispose?.();
          o.material?.map?.dispose?.();
          o.material?.dispose?.();
        }
      });
      b.labelGroup = undefined;
    }
  }

  _getTextTexture(text) {
    if (this.texCache.has(text)) return this.texCache.get(text);

    const size = 256;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    // Schatten
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;

    // Umriss
    ctx.font = 'bold 170px system-ui, Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 12;
    ctx.strokeStyle = '#111';
    ctx.strokeText(text, size/2, size/2);

    // Füllung
    ctx.fillStyle = '#fff';
    ctx.fillText(text, size/2, size/2);

    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this.texCache.set(text, tex);
    return tex;
  }
}
