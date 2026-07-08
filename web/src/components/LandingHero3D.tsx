"use client";

/**
 * Lightweight, standalone 3D hero for the landing page. Renders ONE real
 * calibrated floor plan (a typical residential floor of ЖК «Хайвилл-Астана» from
 * HAYVILL_FLOORPLANS) as extruded room volumes, coloured by functional type
 * (single source: ROOM_TYPE_META). Auto-rotates, orbitable, click a room → info
 * chip. Reuses the floor-detail rendering approach of Building3D.tsx via the
 * shared @/lib/planGeometry helpers — but has no stack / tabs / back-button, so
 * it stays small and never blocks first paint (loaded through next/dynamic).
 *
 * Accessibility: honours prefers-reduced-motion (no auto-rotate; a static hero
 * angle instead). Orbit stays available for anyone who wants it.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MousePointerClick } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { roomTypeMeta } from "@/lib/floorplan";
import { planCenter } from "@/lib/realgeom";
import { extrudePolygon, hexColor } from "@/lib/planGeometry";
import { useTheme } from "@/lib/theme";
import { HAYVILL_FLOORPLANS, type RealFloorPlan, type RealRoom } from "@/data/floorplans/hayvill";

const TARGET = 22; // fit the plan to ~this many world units
const ROOM_WALL_M = 3; // extrusion height, in plan metres

const HERO_PLAN: RealFloorPlan =
  HAYVILL_FLOORPLANS.find((p) => p.id === "typical") ?? HAYVILL_FLOORPLANS[0];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

export default function LandingHero3D({ className }: { className?: string }) {
  const t = useT();
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<RealRoom | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const plan = HERO_PLAN;
    const reduced = prefersReducedMotion();
    const isLight = document.documentElement.classList.contains("light");
    const plateColor = isLight ? 0xe7eaef : 0x1b202a;
    const edgeColor = isLight ? 0x9aa2b1 : 0x0a0d12;

    const scene = new THREE.Scene();
    const { cx, cy } = planCenter(plan);
    const maxDim = Math.max(plan.widthM, plan.heightM, 1);
    const scale = TARGET / maxDim;
    const wallH = ROOM_WALL_M * scale;
    const spanX = plan.widthM * scale;
    const spanZ = plan.heightM * scale;
    const span = Math.max(spanX, spanZ);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
    camera.position.set(span * 0.68, span * 0.6, span * 0.82);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, isLight ? 0xc7cdd6 : 0x2a3240, 1.2));
    const dir = new THREE.DirectionalLight(0xffffff, 1.35);
    dir.position.set(span * 0.5, span * 1.3, span * 0.55);
    scene.add(dir);

    const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
    const clickTargets: THREE.Mesh[] = [];
    const roomState: { mesh: THREE.Mesh; base: THREE.Color }[] = [];

    // Base plate under the room volumes.
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
      Math.max(0.15, wallH * 0.1),
    );
    const plateMat = new THREE.MeshStandardMaterial({
      color: plateColor,
      roughness: 0.95,
      metalness: 0,
    });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.y = -Math.max(0.15, wallH * 0.1);
    scene.add(plate);
    disposables.push(plateGeo, plateMat);

    // Room volumes, coloured by functional type.
    plan.rooms.forEach((r) => {
      const color = hexColor(roomTypeMeta(r.type).color);
      const geo = extrudePolygon(r.polygon, cx, cy, scale, wallH);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.58, metalness: 0.05 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.room = r;
      scene.add(mesh);
      clickTargets.push(mesh);
      roomState.push({ mesh, base: color.clone() });
      disposables.push(geo, mat);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.45 }),
      );
      mesh.add(edges);
      disposables.push(edges.geometry, edges.material as THREE.Material);
    });

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = span * 0.6;
    controls.maxDistance = span * 2.2;
    controls.target.set(0, wallH * 0.5, 0);
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.autoRotate = !reduced;
    controls.autoRotateSpeed = 0.7;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let selMesh: THREE.Mesh | null = null;
    const setSelected = (mesh: THREE.Mesh | null) => {
      if (selMesh) {
        const prev = roomState.find((r) => r.mesh === selMesh);
        if (prev) {
          const m = selMesh.material as THREE.MeshStandardMaterial;
          m.color.copy(prev.base);
          m.emissive.setHex(0x000000);
        }
      }
      selMesh = mesh;
      if (mesh) (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(0x3a3a3a);
    };

    let downXY: [number, number] | null = null;
    const onDown = (e: PointerEvent) => {
      downXY = [e.clientX, e.clientY];
      controls.autoRotate = false; // stop spinning the moment the user grabs it
    };
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
        const r = mesh.userData.room as RealRoom;
        const same = mesh === selMesh;
        setSelected(same ? null : mesh);
        setRoom(same ? null : r);
      } else {
        setSelected(null);
        setRoom(null);
      }
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const resize = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h); // updateStyle stays true — HiDPI
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
      setRoom(null);
    };
    // Rebuild on theme flip so plate/edge colours match the active palette.
  }, [theme]);

  const meta = room ? roomTypeMeta(room.type) : null;

  return (
    <div className={cn("relative", className)}>
      <div ref={containerRef} className="h-full w-full" />

      {/* Hint / info chip — one at a time, bottom-left */}
      {room && meta ? (
        <div className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] rounded-[12px] border border-border bg-surface/95 px-3.5 py-2.5 shadow-pop backdrop-blur">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: meta.color }}
              aria-hidden
            />
            <span className="truncate text-[13px] font-semibold text-fg">{room.name}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted">
            <span>{t(meta.label)}</span>
            <span aria-hidden>·</span>
            <span className="tabular">{room.area_m2} {t("м²")}</span>
          </div>
        </div>
      ) : (
        <div className="pointer-events-none absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-surface/80 px-2.5 py-1.5 text-[11.5px] text-muted backdrop-blur">
          <MousePointerClick className="h-3.5 w-3.5" aria-hidden />
          {t("Клик по помещению")}
        </div>
      )}
    </div>
  );
}
