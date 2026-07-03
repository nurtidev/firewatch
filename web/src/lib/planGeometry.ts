/**
 * Shared three.js geometry helpers for rendering calibrated floor-plan polygons
 * (web/src/data/floorplans/hayvill.ts). Kept in one place so the full building
 * stack / floor-detail view (Building3D.tsx) and the lightweight landing hero
 * (LandingHero3D.tsx) extrude rooms identically.
 */

import * as THREE from "three";

/**
 * Extrude a plan polygon into a solid. Coordinates are centred on the plan bbox
 * (so the footprint sits on the stack axis) and scaled by `scale`; the solid
 * rises `depth` world-units along +Y from the mesh origin. The −90° X rotation is
 * baked into the geometry so meshes need no per-instance rotation and raycasting
 * stays trivial.
 */
export function extrudePolygon(
  poly: [number, number][],
  cx: number,
  cy: number,
  scale: number,
  depth: number,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  poly.forEach(([px, py], i) => {
    const x = (px - cx) * scale;
    const y = (py - cy) * scale;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // plan XY (y-down) → world XZ; extrude → world +Y
  return geo;
}

export const hexColor = (css: string) => new THREE.Color(css);
