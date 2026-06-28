"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type Floor3D = { label: string; hasRooms: boolean };

const FLOOR_H = 2.6;
const GAP = 0.35;
const W = 11; // stylised footprint (no real width/depth in the data)
const BASE = 0x3a4a5e; // slate slab
const BASE_NO_DATA = 0x2a323d; // dimmer for floors without explication
const SELECTED = 0xff8c1a; // accent (matches "high" risk token)

/**
 * Procedural 3D massing of one building: a stack of floor slabs you can orbit and
 * click. Built from the floor list (no external 3D assets) — a pre-incident
 * "pre-plan" model and a stepping stone to a real interior walkthrough.
 */
export default function Building3D({
  floors,
  selected,
  onSelect,
  className,
}: {
  floors: Floor3D[];
  selected: number;
  onSelect: (i: number) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const meshesRef = useRef<THREE.Mesh[]>([]);

  // Build scene once per floor-count change.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || floors.length === 0) return;

    const scene = new THREE.Scene();
    const totalH = floors.length * (FLOOR_H + GAP);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(W * 2.4, totalH * 0.7 + 6, W * 2.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x33404d, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(20, 40, 25);
    scene.add(dir);

    // Floor slabs, stacked.
    const meshes: THREE.Mesh[] = [];
    const geom = new THREE.BoxGeometry(W, FLOOR_H, W);
    floors.forEach((f, i) => {
      const mat = new THREE.MeshStandardMaterial({
        color: f.hasRooms ? BASE : BASE_NO_DATA,
        roughness: 0.7,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.y = i * (FLOOR_H + GAP) + FLOOR_H / 2;
      mesh.userData.index = i;
      scene.add(mesh);
      meshes.push(mesh);
      // thin edge outline
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geom),
        new THREE.LineBasicMaterial({ color: 0x0b0f14, transparent: true, opacity: 0.35 }),
      );
      mesh.add(edges);
    });
    meshesRef.current = meshes;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, totalH * 0.45, 0);
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // don't go under ground

    // Click → select floor.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downXY: [number, number] | null = null;
    const onDown = (e: PointerEvent) => (downXY = [e.clientX, e.clientY]);
    const onUp = (e: PointerEvent) => {
      if (!downXY) return;
      const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
      downXY = null;
      if (moved > 5) return; // it was a drag/orbit, not a click
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes, false)[0];
      if (hit) onSelect(hit.object.userData.index as number);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      geom.dispose();
      meshes.forEach((m) => (m.material as THREE.Material).dispose());
      renderer.dispose();
      el.removeChild(renderer.domElement);
      meshesRef.current = [];
    };
  }, [floors, onSelect]);

  // Highlight the selected floor without rebuilding the scene.
  useEffect(() => {
    meshesRef.current.forEach((m, i) => {
      const mat = m.material as THREE.MeshStandardMaterial;
      if (i === selected) {
        mat.color.setHex(SELECTED);
        mat.emissive.setHex(0x4a2a00);
      } else {
        mat.color.setHex(floors[i]?.hasRooms ? BASE : BASE_NO_DATA);
        mat.emissive.setHex(0x000000);
      }
    });
  }, [selected, floors]);

  return <div ref={containerRef} className={className} />;
}
