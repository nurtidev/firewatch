"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ArrowLeft, MousePointerClick } from "lucide-react";
import { cn } from "@/lib/cn";
import { roomTypeMeta } from "@/lib/floorplan";
import { planCenter } from "@/lib/realgeom";
import { extrudePolygon, hexColor } from "@/lib/planGeometry";
import type { RealFloorPlan, RealRoom } from "@/data/floorplans/hayvill";

export type Floor3D = { label: string; hasRooms: boolean };

const FLOOR_H = 2.6;
const GAP = 0.35;
const W = 11; // stylised footprint fallback (floors without real geometry)
const BASE = 0x3a4a5e; // slate slab
const BASE_NO_DATA = 0x2a323d; // dimmer for floors without explication
const SELECTED = 0xff8c1a; // accent (matches "high" risk token)

// Real footprints are in metres (~30–74 m). Scale the widest mapped plan to this
// many world units so the stack keeps a tower-like aspect next to FLOOR_H slabs.
const TARGET_FOOTPRINT = 15;
// Floor-detail view: fit the single plan to roughly this many world units.
const TARGET_DETAIL = 22;
const ROOM_WALL_M = 3; // extrusion height of a room volume, in plan metres

/* geometry helpers (extrudePolygon, hexColor) live in @/lib/planGeometry —
   shared with the lightweight landing hero. */

/* ── Public wrapper: stack ⇄ floor-detail with a way back ──────────────────── */

/**
 * Procedural 3D of one building. Two modes:
 *  • stack — floor slabs you orbit and click; floors mapped to a real plan render
 *    as that plan's true (centred) footprint instead of a uniform box.
 *  • floor-detail — the selected real plan, rooms extruded and coloured by type,
 *    click a room → onRoomSelect. A back button returns to the stack.
 * Without `plans` it behaves exactly like the original slab stack (other objects).
 */
export default function Building3D({
  floors,
  selected,
  onSelect,
  plans,
  onRoomSelect,
  className,
}: {
  floors: Floor3D[];
  selected: number;
  onSelect: (i: number) => void;
  /** Aligned with `floors`: real plan for that floor, or null to keep the slab. */
  plans?: (RealFloorPlan | null)[];
  /** Fired in floor-detail view when a room is clicked (null = deselected). */
  onRoomSelect?: (room: RealRoom | null) => void;
  className?: string;
}) {
  const [view, setView] = useState<"stack" | "floor">("stack");
  const activePlan = plans && view === "floor" ? plans[selected] ?? null : null;

  // If the selected floor has no real plan (e.g. switched via the tabs below),
  // never sit in a dead floor-detail view.
  useEffect(() => {
    if (view === "floor" && !(plans && plans[selected])) setView("stack");
  }, [view, plans, selected]);

  // Stable identities: BuildingStack rebuilds its scene when onSelect changes.
  const handleSelect = useCallback(
    (i: number) => {
      onSelect(i);
      if (plans?.[i]) {
        setView("floor");
        onRoomSelect?.(null);
      }
    },
    [onSelect, plans, onRoomSelect],
  );

  const backToStack = () => {
    setView("stack");
    onRoomSelect?.(null);
  };

  const selectedHasPlan = !!plans?.[selected];

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {view === "floor" && activePlan ? (
        <FloorDetail3D
          plan={activePlan}
          onRoomSelect={onRoomSelect}
          className="h-full w-full"
        />
      ) : (
        <BuildingStack
          floors={floors}
          plans={plans}
          selected={selected}
          onSelect={handleSelect}
          className="h-full w-full"
        />
      )}

      {/* Overlay controls — only meaningful when real geometry exists. */}
      {plans && (
        <>
          {view === "floor" && activePlan ? (
            <>
              <button
                onClick={backToStack}
                className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2/90 px-2.5 py-1 text-xs font-medium text-fg shadow-sm backdrop-blur transition-colors hover:border-border-strong"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden />К зданию
              </button>
              <div className="pointer-events-none absolute right-2 top-2 max-w-[60%] truncate rounded-md border border-accent/30 bg-accent-weak px-2.5 py-1 text-2xs font-medium text-accent">
                План этажа · реальная геометрия
              </div>
            </>
          ) : (
            selectedHasPlan && (
              <div className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2/85 px-2.5 py-1 text-2xs text-muted backdrop-blur">
                <MousePointerClick className="h-3.5 w-3.5" aria-hidden />
                Клик по этажу — раскрыть план в 3D
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

/* ── Whole-building stack ──────────────────────────────────────────────────── */

function BuildingStack({
  floors,
  plans,
  selected,
  onSelect,
  className,
}: {
  floors: Floor3D[];
  plans?: (RealFloorPlan | null)[];
  selected: number;
  onSelect: (i: number) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Per-floor materials (a footprint floor owns several meshes → several mats)
  // plus its resting colour, so selection can highlight without a rebuild.
  const floorMatsRef = useRef<{ mats: THREE.MeshStandardMaterial[]; base: number }[]>([]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || floors.length === 0) return;

    const scene = new THREE.Scene();
    const totalH = floors.length * (FLOOR_H + GAP);

    // Global footprint scale: widest mapped plan → TARGET_FOOTPRINT world units.
    const mappedDims = (plans ?? [])
      .filter((p): p is RealFloorPlan => !!p)
      .map((p) => Math.max(p.widthM, p.heightM));
    const maxDim = mappedDims.length ? Math.max(...mappedDims) : W;
    const fpScale = TARGET_FOOTPRINT / maxDim;
    const extent = mappedDims.length ? TARGET_FOOTPRINT : W;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    const orbitDist = Math.max(extent * 1.7, totalH * 0.95);
    camera.position.set(orbitDist, totalH * 0.55, orbitDist);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x33404d, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(20, 40, 25);
    scene.add(dir);

    const boxGeom = new THREE.BoxGeometry(W, FLOOR_H, W);
    const disposables: (THREE.BufferGeometry | THREE.Material)[] = [boxGeom];
    const clickTargets: THREE.Object3D[] = [];
    const floorMats: { mats: THREE.MeshStandardMaterial[]; base: number }[] = [];

    floors.forEach((f, i) => {
      const baseColor = f.hasRooms ? BASE : BASE_NO_DATA;
      const y = i * (FLOOR_H + GAP);
      const plan = plans?.[i] ?? null;

      if (plan) {
        // Real footprint: extrude every room polygon (their union reads as the
        // true floor outline). Centred on the stack axis — parking levels are NOT
        // survey-aligned (different calibration scales), so we don't pretend.
        const { cx, cy } = planCenter(plan);
        const mat = new THREE.MeshStandardMaterial({
          color: baseColor,
          roughness: 0.7,
          metalness: 0.05,
        });
        disposables.push(mat);
        plan.rooms.forEach((room) => {
          const geo = extrudePolygon(room.polygon, cx, cy, fpScale, FLOOR_H);
          disposables.push(geo);
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.y = y;
          mesh.userData.index = i;
          scene.add(mesh);
          clickTargets.push(mesh);
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geo),
            new THREE.LineBasicMaterial({ color: 0x0b0f14, transparent: true, opacity: 0.28 }),
          );
          mesh.add(edges);
          disposables.push(edges.geometry, edges.material as THREE.Material);
        });
        floorMats.push({ mats: [mat], base: baseColor });
      } else {
        const mat = new THREE.MeshStandardMaterial({
          color: baseColor,
          roughness: 0.7,
          metalness: 0.05,
        });
        disposables.push(mat);
        const mesh = new THREE.Mesh(boxGeom, mat);
        mesh.position.y = y + FLOOR_H / 2;
        mesh.userData.index = i;
        scene.add(mesh);
        clickTargets.push(mesh);
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(boxGeom),
          new THREE.LineBasicMaterial({ color: 0x0b0f14, transparent: true, opacity: 0.35 }),
        );
        mesh.add(edges);
        disposables.push(edges.geometry, edges.material as THREE.Material);
        floorMats.push({ mats: [mat], base: baseColor });
      }
    });
    floorMatsRef.current = floorMats;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, totalH * 0.5, 0);
    controls.maxPolarAngle = Math.PI / 2 - 0.02;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downXY: [number, number] | null = null;
    const onDown = (e: PointerEvent) => (downXY = [e.clientX, e.clientY]);
    const onUp = (e: PointerEvent) => {
      if (!downXY) return;
      const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
      downXY = null;
      if (moved > 5) return; // drag/orbit, not a click
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(clickTargets, false)[0];
      if (hit) onSelect(hit.object.userData.index as number);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      // updateStyle MUST stay true (default): on HiDPI/Retina the canvas needs an
      // explicit CSS size, else its layout width = device-pixel buffer width and
      // it blows up off-screen (blank). See original note.
      renderer.setSize(w, h);
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
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      el.removeChild(renderer.domElement);
      floorMatsRef.current = [];
    };
  }, [floors, plans, onSelect]);

  // Highlight selected floor without rebuilding the scene.
  useEffect(() => {
    floorMatsRef.current.forEach((entry, i) => {
      const on = i === selected;
      entry.mats.forEach((m) => {
        m.color.setHex(on ? SELECTED : entry.base);
        m.emissive.setHex(on ? 0x4a2a00 : 0x000000);
      });
    });
  }, [selected]);

  return <div ref={containerRef} className={className} />;
}

/* ── Single-floor detail: extruded rooms coloured by type ──────────────────── */

function FloorDetail3D({
  plan,
  onRoomSelect,
  className,
}: {
  plan: RealFloorPlan;
  onRoomSelect?: (room: RealRoom | null) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const isLight = document.documentElement.classList.contains("light");
    const plateColor = isLight ? 0xdfe3e9 : 0x1f2530;
    const edgeColor = isLight ? 0x8b93a1 : 0x0a0d12;

    const scene = new THREE.Scene();
    const { cx, cy } = planCenter(plan);
    const maxDim = Math.max(plan.widthM, plan.heightM, 1);
    const scale = TARGET_DETAIL / maxDim;
    const wallH = ROOM_WALL_M * scale;
    const spanX = plan.widthM * scale;
    const spanZ = plan.heightM * scale;
    const span = Math.max(spanX, spanZ);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    camera.position.set(span * 0.85, span * 0.9, span * 0.95);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x2a3240, 1.15));
    const dir = new THREE.DirectionalLight(0xffffff, 1.3);
    dir.position.set(span * 0.6, span * 1.2, span * 0.4);
    scene.add(dir);

    const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
    const clickTargets: THREE.Mesh[] = [];
    const roomState: { mesh: THREE.Mesh; base: THREE.Color }[] = [];

    // Base plate — the floor slab under the room volumes.
    const plateGeo = extrudePolygon(
      [
        [0, 0],
        [plan.widthM, 0],
        [plan.widthM, plan.heightM],
        [0, plan.heightM],
      ],
      cx,
      cy,
      scale,
      Math.max(0.15, wallH * 0.12),
    );
    const plateMat = new THREE.MeshStandardMaterial({
      color: plateColor,
      roughness: 0.9,
      metalness: 0,
    });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.y = -Math.max(0.15, wallH * 0.12);
    scene.add(plate);
    disposables.push(plateGeo, plateMat);

    // Room volumes, coloured by functional type (single source: ROOM_TYPE_META).
    plan.rooms.forEach((room) => {
      const color = hexColor(roomTypeMeta(room.type).color);
      const geo = extrudePolygon(room.polygon, cx, cy, scale, wallH);
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.62,
        metalness: 0.04,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.room = room;
      scene.add(mesh);
      clickTargets.push(mesh);
      roomState.push({ mesh, base: color.clone() });
      disposables.push(geo, mat);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.4 }),
      );
      mesh.add(edges);
      disposables.push(edges.geometry, edges.material as THREE.Material);
    });

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, wallH * 0.5, 0);
    controls.maxPolarAngle = Math.PI / 2 - 0.02;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let selMesh: THREE.Mesh | null = null;
    const setSelected = (mesh: THREE.Mesh | null) => {
      // restore previous
      if (selMesh) {
        const prev = roomState.find((r) => r.mesh === selMesh);
        if (prev) {
          const m = selMesh.material as THREE.MeshStandardMaterial;
          m.color.copy(prev.base);
          m.emissive.setHex(0x000000);
        }
      }
      selMesh = mesh;
      if (mesh) {
        const m = mesh.material as THREE.MeshStandardMaterial;
        m.emissive.setHex(0x333333);
      }
    };

    let downXY: [number, number] | null = null;
    const onDown = (e: PointerEvent) => (downXY = [e.clientX, e.clientY]);
    const onUp = (e: PointerEvent) => {
      if (!downXY) return;
      const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
      downXY = null;
      if (moved > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(clickTargets, false)[0];
      if (hit) {
        const mesh = hit.object as THREE.Mesh;
        const room = mesh.userData.room as RealRoom;
        const same = mesh === selMesh;
        setSelected(same ? null : mesh);
        onRoomSelect?.(same ? null : room);
      } else {
        setSelected(null);
        onRoomSelect?.(null);
      }
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h); // updateStyle stays true — HiDPI, see stack note
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
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [plan, onRoomSelect]);

  return <div ref={containerRef} className={className} />;
}
