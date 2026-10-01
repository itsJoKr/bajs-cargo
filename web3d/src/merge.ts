// Fewer draw calls: every mesh costs a draw call (two when it casts a shadow), and through ANGLE a
// call costs far more than its few triangles. These merge meshes that never move relative to each
// other into one mesh per parent and material.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Merges the static meshes under [root]: children of one parent that share a material, shadow flags
 * and attribute set become one mesh in the parent's frame. A mesh stays as it is when it has children,
 * is instanced, mirrored, or flagged `userData.moves` (posed every frame); groups are never merged, so
 * whatever turns a group (a wheel, a crank) keeps turning everything under it.
 */
export function mergeStatic(root: THREE.Object3D) {
  const parents: THREE.Object3D[] = [];
  root.traverse((o) => parents.push(o));
  let before = 0, after = 0;
  for (const parent of parents) {
    const buckets = new Map<string, THREE.Mesh[]>();
    for (const c of parent.children) {
      const m = c as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || m.children.length || m.userData.moves) continue;
      if (Array.isArray(m.material) || Object.keys(m.geometry.morphAttributes).length) continue;
      m.updateMatrix();
      if (m.matrix.determinant() < 0) continue;
      const attrs = Object.keys(m.geometry.attributes).sort().join(',');
      const key = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}|${m.visible}|${attrs}`;
      let list = buckets.get(key);
      if (!list) buckets.set(key, (list = []));
      list.push(m);
    }
    for (const list of buckets.values()) {
      before += list.length;
      if (list.length < 2) {
        after += list.length;
        continue;
      }
      const indexed = list.every((m) => m.geometry.index);
      const geos = list.map((m) => {
        const g = indexed ? m.geometry.clone() : m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        return g.applyMatrix4(m.matrix);
      });
      const merged = mergeGeometries(geos, false);
      if (!merged) {
        after += list.length;
        continue;
      }
      const first = list[0];
      const mesh = new THREE.Mesh(merged, first.material);
      mesh.castShadow = first.castShadow;
      mesh.receiveShadow = first.receiveShadow;
      mesh.renderOrder = first.renderOrder;
      mesh.name = first.name;
      for (const m of list) parent.remove(m);
      parent.add(mesh);
      after++;
    }
  }
  return { before, after };
}

/**
 * Lets opaque standard materials that differ only in colour share one material, the colour going into
 * the vertices instead, so mergeStatic can merge their meshes. For hand-built scenery where every piece
 * was given its own material (features: one per awning, box, sign arm).
 */
export function shareMaterials(root: THREE.Object3D) {
  const shared = new Map<string, THREE.MeshStandardMaterial>();
  const id = (t: THREE.Texture | null) => (t ? t.uuid : '-');
  for (const c of root.children) {
    const m = c as THREE.Mesh;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (!m.isMesh || m.children.length || Array.isArray(mat) || !mat.isMeshStandardMaterial) continue;
    if (mat.type !== 'MeshStandardMaterial' || mat.transparent || mat.vertexColors || m.geometry.getAttribute('color')) continue;
    const key = [
      id(mat.map), id(mat.emissiveMap), id(mat.bumpMap), id(mat.normalMap), id(mat.roughnessMap), id(mat.alphaMap),
      mat.roughness, mat.metalness, mat.side, mat.alphaTest, mat.emissive.getHex(), mat.emissiveIntensity,
      mat.opacity, mat.depthWrite, mat.envMapIntensity, mat.flatShading,
    ].join('|');
    let s = shared.get(key);
    if (!s) {
      s = mat.clone();
      s.color.set(1, 1, 1);
      s.vertexColors = true;
      shared.set(key, s);
    }
    const g = m.geometry.clone();
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) colors.set([mat.color.r, mat.color.g, mat.color.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    m.geometry = g;
    m.material = s;
  }
}
