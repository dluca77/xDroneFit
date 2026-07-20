"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import * as exifr from "exifr";
import JSZip from "jszip";
import "leaflet/dist/leaflet.css";
import type { ProjectRecord } from "./ProjectPortal";
import { solveExifCamera, solveVanishingPointCamera, wgs84ToRd, rdToWgs84, type CameraSolution, type ImagePoint } from "./cameraMath";

type SitePosition = { lat: number; lon: number };
type AddressResult = { id: string; label: string; lat: number; lon: number; kind: string };
type LayerVisibility = { project: boolean; drone: boolean };
type LayerKey = keyof LayerVisibility;
type StepKey = "location" | "drone" | "camera";
type CollapsedSteps = Record<StepKey, boolean>;
type DroneData = {
  fileName: string; previewUrl: string;
  assetRevision?: number;
  latitude: number | null; longitude: number | null;
  relativeAltitude: number | null; absoluteAltitude: number | null;
  gimbalYaw: number | null; gimbalPitch: number | null; gimbalRoll: number | null;
  flightYaw: number | null; focalLength: number | null; focalLength35mm: number | null;
  width: number | null; height: number | null;
  cameraMake: string; cameraModel: string; capturedAt: string;
};

const INITIAL_SITE: SitePosition = { lat: 52.282539407, lon: 6.426162461 };
const DEFAULT_LAYER_VISIBILITY: LayerVisibility = { project: true, drone: true };
const MAP_LAYERS: ReadonlyArray<{ key: LayerKey; label: string }> = [
  { key: "project", label: "Projectanker" },
  { key: "drone", label: "Drone & kijksector" },
];

function readDjiAttribute(raw: string, name: string): number | null {
  const match = raw.match(new RegExp(`drone-dji:${name}="([+-]?[0-9.]+)"`));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function readDjiString(raw: string, name: string): string {
  return raw.match(new RegExp(`drone-dji:${name}="([^"]*)"`))?.[1] ?? "";
}

function destination(lat: number, lon: number, bearing: number, meters: number): [number, number] {
  const radius = 6378137;
  const angular = meters / radius;
  const theta = (bearing * Math.PI) / 180;
  const phi1 = (lat * Math.PI) / 180;
  const lambda1 = (lon * Math.PI) / 180;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(angular) + Math.cos(phi1) * Math.sin(angular) * Math.cos(theta));
  const lambda2 = lambda1 + Math.atan2(Math.sin(theta) * Math.sin(angular) * Math.cos(phi1), Math.cos(angular) - Math.sin(phi1) * Math.sin(phi2));
  return [(phi2 * 180) / Math.PI, (lambda2 * 180) / Math.PI];
}

function bearingBetween(from: [number, number], to: [number, number]): number {
  const phi1 = from[0] * Math.PI / 180;
  const phi2 = to[0] * Math.PI / 180;
  const deltaLambda = (to[1] - from[1]) * Math.PI / 180;
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const degrees = Math.atan2(y, x) * 180 / Math.PI;
  return ((degrees + 540) % 360) - 180;
}

function formatNumber(value: number | null, digits = 2) {
  return value == null ? "—" : value.toFixed(digits);
}

function LayerEye({ shown, label, onToggle }: { shown: boolean; label: string; onToggle: () => void }) {
  return <button type="button" className={`layer-eye ${shown ? "shown" : "hidden"}`} aria-label={`${label} ${shown ? "verbergen" : "tonen"}`} aria-pressed={shown} onClick={onToggle}><i /></button>;
}

function NumericSlider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (value: number) => void }) {
  const update = (next: number) => {
    if (!Number.isFinite(next)) return;
    onChange(Math.max(min, Math.min(max, next)));
  };
  return <label className="numeric-slider">
    <span><span>{label}</span><span className="numeric-entry"><input type="number" aria-label={`${label} waarde`} min={min} max={max} step={step} value={value} onChange={(event) => update(event.currentTarget.valueAsNumber)} /><em>{unit}</em></span></span>
    <input type="range" aria-label={`${label} schuifregelaar`} min={min} max={max} step={step} value={value} onChange={(event) => update(Number(event.currentTarget.value))} />
  </label>;
}

function CollapseButton({ collapsed, label, onToggle }: { collapsed: boolean; label: string; onToggle: () => void }) {
  return <button type="button" className={`collapse-step ${collapsed ? "collapsed" : ""}`} aria-label={`${label} ${collapsed ? "uitklappen" : "inklappen"}`} aria-expanded={!collapsed} onClick={onToggle}><i /></button>;
}

export default function DroneFitApp({ project, onBack }: { project: ProjectRecord; onBack: () => void }) {
  let saved: any = {};
  try { saved = JSON.parse(project.stateJson || "{}"); } catch { saved = {}; }
  const mapElement = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const mapLeaflet = useRef<any>(null);
  const markerLayer = useRef<any>(null);

  const [projectName, setProjectName] = useState(saved.projectName || project.name);
  const [site, setSite] = useState<SitePosition>(saved.site || INITIAL_SITE);
  const [siteConfirmed, setSiteConfirmed] = useState(Boolean(saved.siteConfirmed));
  const [drone, setDrone] = useState<DroneData | null>(saved.drone ? { ...saved.drone, previewUrl: "/api/projects/" + project.id + "/assets/photo?v=" + (saved.drone.assetRevision ?? encodeURIComponent(project.updatedAt)) } : null);
  const [photoLoadFailed, setPhotoLoadFailed] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("Upload de dronefoto om te beginnen.");
  const [addressQuery, setAddressQuery] = useState("");
  const [addressResults, setAddressResults] = useState<AddressResult[]>([]);
  const [addressBusy, setAddressBusy] = useState(false);
  const [activeAddress, setActiveAddress] = useState(-1);
  const [cameraSolution, setCameraSolution] = useState<CameraSolution | null>(saved.cameraSolution || null);
  const [vpGroup1, setVpGroup1] = useState<ImagePoint[]>(saved.vpGroup1 || []);
  const [vpGroup2, setVpGroup2] = useState<ImagePoint[]>(saved.vpGroup2 || []);
  const [placingVpGroup, setPlacingVpGroup] = useState<1 | 2 | null>(null);
  const placingVpGroupRef = useRef<1 | 2 | null>(null);
  const exifCamera = useMemo(() => {
    if (!drone || drone.latitude == null || drone.longitude == null || !drone.width || !drone.height) return null;
    try {
      return solveExifCamera({
        latitude: drone.latitude, longitude: drone.longitude,
        relativeAltitude: drone.relativeAltitude, absoluteAltitude: drone.absoluteAltitude,
        gimbalYaw: drone.gimbalYaw, gimbalPitch: drone.gimbalPitch, gimbalRoll: drone.gimbalRoll, flightYaw: drone.flightYaw,
        focalLength: drone.focalLength, focalLength35mm: drone.focalLength35mm,
        width: drone.width, height: drone.height,
      }, site.lon, site.lat);
    }
    catch { return null; }
  }, [drone, site]);
  const effectiveCameraSolution = cameraSolution ?? exifCamera;
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibility>({ ...DEFAULT_LAYER_VISIBILITY, ...(saved.layerVisibility || {}) });
  const [collapsedSteps, setCollapsedSteps] = useState<CollapsedSteps>({ location: false, drone: false, camera: false, ...(saved.collapsedSteps || {}) });
  const [canUndo, setCanUndo] = useState(false);
  const undoHistoryRef = useRef<string[]>([]);
  const lastUndoSnapshotRef = useRef("");
  const restoringUndoRef = useRef(false);

  const undoSnapshot = useMemo(() => JSON.stringify({ projectName, site, siteConfirmed, drone, cameraSolution, vpGroup1, vpGroup2, layerVisibility }), [projectName, site, siteConfirmed, drone, cameraSolution, vpGroup1, vpGroup2, layerVisibility]);

  useEffect(() => {
    if (!lastUndoSnapshotRef.current || restoringUndoRef.current) {
      lastUndoSnapshotRef.current = undoSnapshot;
      restoringUndoRef.current = false;
      return;
    }
    const previous = lastUndoSnapshotRef.current;
    if (previous === undoSnapshot) return;
    setCanUndo(true);
    const timer = window.setTimeout(() => {
      undoHistoryRef.current.push(previous);
      if (undoHistoryRef.current.length > 50) undoHistoryRef.current.shift();
      lastUndoSnapshotRef.current = undoSnapshot;
      setCanUndo(true);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [undoSnapshot]);

  function undoLastChange() {
    const pendingPrevious = lastUndoSnapshotRef.current && lastUndoSnapshotRef.current !== undoSnapshot ? lastUndoSnapshotRef.current : "";
    const previous = pendingPrevious || undoHistoryRef.current.pop();
    if (!previous) return;
    const state = JSON.parse(previous);
    restoringUndoRef.current = true;
    setProjectName(state.projectName); setSite(state.site); setSiteConfirmed(state.siteConfirmed);
    setDrone(state.drone); setCameraSolution(state.cameraSolution); setVpGroup1(state.vpGroup1 || []); setVpGroup2(state.vpGroup2 || []); setLayerVisibility(state.layerVisibility);
    lastUndoSnapshotRef.current = previous;
    setCanUndo(undoHistoryRef.current.length > 0);
    setNotice("Laatste wijziging teruggedraaid.");
  }

  useEffect(() => {
    const handleUndo = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undoLastChange();
      }
    };
    window.addEventListener("keydown", handleUndo);
    return () => window.removeEventListener("keydown", handleUndo);
  });

  const toggleStep = (step: StepKey) => setCollapsedSteps((current) => ({ ...current, [step]: !current[step] }));
  const [saveState, setSaveState] = useState("Opgeslagen");
  async function saveProject() {
    setSaveState("Opslaan...");
    const safeDrone = drone ? { ...drone, previewUrl: "" } : null;
    const state = { projectName, site, siteConfirmed, drone: safeDrone, cameraSolution, vpGroup1, vpGroup2, layerVisibility, collapsedSteps };
    const response = await fetch("/api/projects/" + project.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: project.code, name: projectName, state }) });
    setSaveState(response.ok ? "Opgeslagen" : "Opslaan mislukt");
  }
  useEffect(() => { const timer = window.setTimeout(saveProject, 1200); return () => window.clearTimeout(timer); }, [projectName, site, siteConfirmed, drone, cameraSolution, vpGroup1, vpGroup2, layerVisibility, collapsedSteps]);

  useEffect(() => {
    const query = addressQuery.trim();
    if (query.length < 2) {
      setAddressResults([]);
      setActiveAddress(-1);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setAddressBusy(true);
      try {
        const url = new URL("https://api.pdok.nl/kadaster/location-api/v1/search");
        url.searchParams.set("q", query);
        url.searchParams.set("adres[version]", "1");
        url.searchParams.set("limit", "8");
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`PDOK gaf status ${response.status}`);
        const data = await response.json();
        const results: AddressResult[] = (data.features ?? []).flatMap((feature: any) => {
          const coordinates = feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null;
          if (!coordinates || coordinates.length < 2) return [];
          return [{
            id: String(feature.id ?? `${coordinates[0]}-${coordinates[1]}`),
            label: String(feature.properties?.display_name ?? feature.properties?.naam ?? "Onbekende locatie"),
            lon: Number(coordinates[0]),
            lat: Number(coordinates[1]),
            kind: String(feature.properties?.type ?? "adres"),
          }];
        });
        setAddressResults(results);
        setActiveAddress(results.length ? 0 : -1);
      } catch (error) {
        if (!controller.signal.aborted) {
          setAddressResults([]);
          setNotice(`Adres zoeken lukt nu niet: ${error instanceof Error ? error.message : "onbekende fout"}`);
        }
      } finally {
        if (!controller.signal.aborted) setAddressBusy(false);
      }
    }, 280);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [addressQuery]);

  useEffect(() => {
    let cancelled = false;
    async function createMap() {
      if (!mapElement.current || mapInstance.current) return;
      const L = await import("leaflet");
      if (cancelled || !mapElement.current) return;
      mapLeaflet.current = L;
      const map = L.map(mapElement.current, { zoomControl: false }).setView([INITIAL_SITE.lat, INITIAL_SITE.lon], 17);
      mapInstance.current = map;
      L.control.zoom({ position: "bottomright" }).addTo(map);
      const luchtfoto = L.tileLayer.wms("https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0", {
        layers: "Actueel_orthoHR", format: "image/jpeg", maxZoom: 22, attribution: "PDOK Luchtfoto",
      }).addTo(map);
      const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 20, attribution: "© OpenStreetMap" });
      const kadaster = L.tileLayer.wms("https://service.pdok.nl/kadaster/kadastralekaart/wms/v5_0", {
        layers: "Kadastralekaart", format: "image/png", transparent: true, maxZoom: 22, attribution: "PDOK Kadaster",
      }).addTo(map);
      L.control.layers({ Luchtfoto: luchtfoto, Kaart: osm }, { Kadaster: kadaster }, { position: "topright" }).addTo(map);
      markerLayer.current = L.layerGroup().addTo(map);
      map.on("click", (event: any) => {
        setSite({ lat: event.latlng.lat, lon: event.latlng.lng });
        setSiteConfirmed(true);
        setCameraSolution(null);
        setNotice("Projectlocatie vastgelegd.");
      });
      setTimeout(() => map.invalidateSize(), 50);
    }
    createMap();
    return () => { cancelled = true; mapInstance.current?.remove(); mapInstance.current = null; };
  }, []);

  useEffect(() => {
    const L = mapLeaflet.current;
    const layer = markerLayer.current;
    if (!L || !layer) return;
    layer.clearLayers();
    if (layerVisibility.project) L.circleMarker([site.lat, site.lon], { radius: 9, color: "#fff", weight: 3, fillColor: "#ff5d2e", fillOpacity: 1 })
      .bindTooltip("Projectanker", { permanent: true, direction: "top", offset: [0, -10] }).addTo(layer);
    if (layerVisibility.drone && drone?.latitude != null && drone.longitude != null) {
      const solvedWgs = effectiveCameraSolution ? rdToWgs84(effectiveCameraSolution.cameraRd[0], effectiveCameraSolution.cameraRd[1]) : null;
      const position: [number, number] = solvedWgs ? [solvedWgs[1], solvedWgs[0]] : [drone.latitude, drone.longitude];
      const solvedRotation = effectiveCameraSolution?.rotationWorldToCamera;
      const solvedForward = solvedRotation ? [solvedRotation[0][2], solvedRotation[1][2], solvedRotation[2][2]] : null;
      const solvedYaw = solvedForward ? Math.atan2(solvedForward[0], solvedForward[1]) * 180 / Math.PI : null;
      const yaw = solvedYaw ?? drone.gimbalYaw ?? drone.flightYaw ?? 0;
      const focal35 = drone.focalLength35mm ?? 24;
      const horizontalFov = 2 * Math.atan(36 / (2 * focal35)) * 180 / Math.PI;
      const altitude = Math.max(1, effectiveCameraSolution?.cameraLocalRd[2] ?? drone.relativeAltitude ?? 30);
      const solvedDown = solvedForward ? Math.asin(Math.max(-1, Math.min(1, -solvedForward[2]))) * 180 / Math.PI : null;
      const downAngle = Math.max(8, Math.min(89, solvedDown ?? -(drone.gimbalPitch ?? -45)));
      const centerDistance = Math.min(500, altitude / Math.tan(downAngle * Math.PI / 180));
      const footprint = (cameraPosition: [number, number], target: [number, number], viewYaw: number, distance: number) => {
        const halfWidth = Math.tan(horizontalFov * Math.PI / 360) * Math.max(distance, altitude);
        return [cameraPosition, destination(target[0], target[1], viewYaw - 90, halfWidth), destination(target[0], target[1], viewYaw + 90, halfWidth)];
      };
      const tip = destination(position[0], position[1], yaw, centerDistance);
      const viewPolygon = L.polygon(footprint(position, tip, yaw, centerDistance), { color: "#0f6f67", weight: 2, fillColor: "#3bd0c3", fillOpacity: 0.16 }).addTo(layer);
      const directionLine = L.polyline([position, tip], { color: "#0f6f67", weight: 2, dashArray: "5 7", opacity: 0.85 }).addTo(layer);
      const targetIcon = L.divIcon({ className: "camera-target-pin", html: "<span><i></i></span>", iconSize: [38, 38], iconAnchor: [19, 19] });
      const targetMarker = L.marker(tip, { icon: targetIcon, draggable: true, zIndexOffset: 800 })
        .bindTooltip("Kijkpunt · versleep", { permanent: true, direction: "top", offset: [0, -18] }).addTo(layer);
      targetMarker.on("drag", (event: any) => {
        const target = event.target.getLatLng();
        const targetPosition: [number, number] = [target.lat, target.lng];
        const distance = Math.max(1, mapInstance.current?.distance(position, targetPosition) ?? centerDistance);
        const nextYaw = bearingBetween(position, targetPosition);
        viewPolygon.setLatLngs(footprint(position, targetPosition, nextYaw, distance));
        directionLine.setLatLngs([position, targetPosition]);
      });
      targetMarker.on("dragend", (event: any) => {
        const target = event.target.getLatLng();
        const targetPosition: [number, number] = [target.lat, target.lng];
        const distance = Math.max(1, mapInstance.current?.distance(position, targetPosition) ?? centerDistance);
        const nextYaw = bearingBetween(position, targetPosition);
        const nextPitch = -Math.atan2(altitude, distance) * 180 / Math.PI;
        setDrone((current) => current ? { ...current, latitude: position[0], longitude: position[1], gimbalYaw: nextYaw, gimbalPitch: nextPitch } : current);
        setCameraSolution(null);
        setNotice(`Kijkrichting aangepast naar ${nextYaw.toFixed(1)}° en pitch ${nextPitch.toFixed(1)}°.`);
      });
      const droneIcon = L.divIcon({ className: "drone-pin", html: "<span>✦</span>", iconSize: [30, 30], iconAnchor: [15, 15] });
      const droneMarker = L.marker(position, { icon: droneIcon, draggable: true })
        .bindTooltip(cameraSolution ? "Vluchtpuntlijnen-camera · versleep voor handmatige correctie" : "EXIF-camera · versleep voor handmatige correctie", { permanent: true, direction: "bottom", offset: [0, 12] }).addTo(layer);
      droneMarker.on("drag", (event: any) => {
        const point = event.target.getLatLng();
        const cameraPosition: [number, number] = [point.lat, point.lng];
        const movedTarget = destination(cameraPosition[0], cameraPosition[1], yaw, centerDistance);
        viewPolygon.setLatLngs(footprint(cameraPosition, movedTarget, yaw, centerDistance));
        directionLine.setLatLngs([cameraPosition, movedTarget]);
        targetMarker.setLatLng(movedTarget);
      });
      droneMarker.on("dragend", (event: any) => {
        const point = event.target.getLatLng();
        setDrone((current) => current ? { ...current, latitude: point.lat, longitude: point.lng, gimbalYaw: yaw, gimbalPitch: -downAngle } : current);
        setCameraSolution(null);
        setNotice("Dronepositie handmatig gecorrigeerd.");
      });
    }
  }, [site, drone, cameraSolution, effectiveCameraSolution, layerVisibility]);

  function selectAddress(result: AddressResult) {
    const position = { lat: result.lat, lon: result.lon };
    setSite(position);
    setSiteConfirmed(true);
    setAddressQuery(result.label);
    setAddressResults([]);
    setActiveAddress(-1);
    mapInstance.current?.setView([result.lat, result.lon], 19);
    setNotice(`Projectlocatie ingesteld op ${result.label}.`);
  }

  function handleAddressKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveAddress((current) => Math.min(current + 1, addressResults.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveAddress((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && activeAddress >= 0 && addressResults[activeAddress]) {
      event.preventDefault();
      selectAddress(addressResults[activeAddress]);
    } else if (event.key === "Escape") {
      setAddressResults([]);
      setActiveAddress(-1);
    }
  }

  async function handleDronePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy("DJI-metadata uitlezen…");
    try {
      const buffer = await file.arrayBuffer();
      const tags: any = await exifr.parse(buffer, { gps: true, tiff: true, exif: true, xmp: true, translateValues: true });
      const raw = new TextDecoder("latin1").decode(buffer);
      const bitmap = await createImageBitmap(file);
      const previewScale = Math.min(1, 2400 / bitmap.width);
      const previewCanvas = document.createElement("canvas");
      previewCanvas.width = Math.round(bitmap.width * previewScale);
      previewCanvas.height = Math.round(bitmap.height * previewScale);
      const previewContext = previewCanvas.getContext("2d");
      if (!previewContext) throw new Error("Voorvertoning kon niet worden gemaakt");
      previewContext.drawImage(bitmap, 0, 0, previewCanvas.width, previewCanvas.height);
      const previewBlob = await new Promise<Blob | null>((resolve) => previewCanvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!previewBlob) throw new Error("Voorvertoning kon niet worden opgeslagen");
      const upload = await fetch("/api/projects/" + project.id + "/assets/photo", { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: previewBlob });
      if (!upload.ok) throw new Error(`Foto-opslag gaf status ${upload.status}`);
      const assetRevision = Date.now();
      const next: DroneData = {
        fileName: file.name, previewUrl: URL.createObjectURL(previewBlob), assetRevision,
        latitude: readDjiAttribute(raw, "GpsLatitude") ?? tags?.latitude ?? null,
        longitude: readDjiAttribute(raw, "GpsLongitude") ?? tags?.longitude ?? null,
        relativeAltitude: readDjiAttribute(raw, "RelativeAltitude"),
        absoluteAltitude: readDjiAttribute(raw, "AbsoluteAltitude") ?? tags?.GPSAltitude ?? null,
        gimbalYaw: readDjiAttribute(raw, "GimbalYawDegree"), gimbalPitch: readDjiAttribute(raw, "GimbalPitchDegree"),
        gimbalRoll: readDjiAttribute(raw, "GimbalRollDegree"), flightYaw: readDjiAttribute(raw, "FlightYawDegree"),
        focalLength: Number(tags?.FocalLength) || null,
        focalLength35mm: Number(tags?.FocalLengthIn35mmFormat ?? tags?.FocalLengthIn35mmFilm) || null,
        width: Number(tags?.ExifImageWidth) || bitmap.width, height: Number(tags?.ExifImageHeight) || bitmap.height,
        cameraMake: tags?.Make ?? "DJI", cameraModel: tags?.Model ?? readDjiString(raw, "ProductName"),
        capturedAt: tags?.DateTimeOriginal instanceof Date ? tags.DateTimeOriginal.toISOString() : String(tags?.DateTimeOriginal ?? ""),
      };
      bitmap.close();
      setPhotoLoadFailed(false);
      setDrone((current) => { if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl); return next; });
      setVpGroup1([]); setVpGroup2([]); setCameraSolution(null);
      if (next.latitude != null && next.longitude != null) {
        mapInstance.current?.setView([next.latitude, next.longitude], Math.max(mapInstance.current.getZoom(), 17));
        if (!siteConfirmed) {
          setSite({ lat: next.latitude, lon: next.longitude });
          setSiteConfirmed(true);
          setNotice("Projectlocatie automatisch bepaald uit de dronefoto. Teken nu de hulplijnen voor de exacte kijkrichting.");
        } else {
          setNotice("Dronecamera gevonden. Teken de hulplijnen voor de exacte kijkrichting.");
        }
      } else {
        setNotice("Dronecamera gevonden, maar geen GPS-positie in de foto. Stel de projectlocatie handmatig in.");
      }
    } catch (error) {
      setNotice(`Foto kon niet worden gelezen: ${error instanceof Error ? error.message : "onbekende fout"}`);
    } finally { setBusy(""); }
  }

  function handleVanishingPhotoClick(event: React.MouseEvent<HTMLDivElement>) {
    const group = placingVpGroupRef.current;
    if (!group) return;
    const image = event.currentTarget.querySelector("img");
    if (!image) return;
    const rect = image.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    const point: ImagePoint = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
    const setGroup = group === 1 ? setVpGroup1 : setVpGroup2;
    setGroup((current) => {
      if (current.length >= 4) return current;
      const next = [...current, point];
      if (next.length >= 4) { placingVpGroupRef.current = null; setPlacingVpGroup(null); }
      return next;
    });
    setCameraSolution(null);
    const count = (group === 1 ? vpGroup1.length : vpGroup2.length) + 1;
    setNotice(count >= 4 ? `Lijngroep ${group} compleet.` : `Punt ${count} van 4 geplaatst voor lijngroep ${group}.`);
  }

  function solveVanishingCamera() {
    if (!drone?.width || !drone.height || !drone.latitude || !drone.longitude) {
      setNotice("Upload eerst de dronefoto met GPS-gegevens.");
      return;
    }
    if (vpGroup1.length < 4 || vpGroup2.length < 4) {
      setNotice("Plaats eerst twee volledige lijnparen (4 punten per groep).");
      return;
    }
    try {
      const toPixels = (points: ImagePoint[]): [ImagePoint, ImagePoint, ImagePoint, ImagePoint] =>
        points.map((p) => ({ x: p.x * (drone.width as number), y: p.y * (drone.height as number) })) as [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
      const solution = solveVanishingPointCamera(
        toPixels(vpGroup1), toPixels(vpGroup2), drone.width, drone.height,
        { latitude: drone.latitude, longitude: drone.longitude, relativeAltitude: drone.relativeAltitude },
        site.lon, site.lat,
      );
      setCameraSolution(solution);
      setNotice("Camera berekend uit de hulplijnen. Controleer de kijkrichting op de kaart.");
    } catch (error) {
      setCameraSolution(null);
      setNotice(error instanceof Error ? error.message : "Camera kon niet worden berekend uit de hulplijnen.");
    }
  }

  function downloadBlenderImporter() {
    const script = `# xDroneFit Blender importer v7\nbl_info = {\n    'name': 'xDroneFit Project Importer',\n    'author': 'xDroneFit',\n    'version': (1, 0, 0),\n    'blender': (3, 6, 0),\n    'location': 'File > Import > xDroneFit project (.json)',\n    'description': 'Import an xDroneFit .dronefit.json project: camera and background photo.',\n    'category': 'Import-Export',\n}\nimport bpy, json, os\nfrom mathutils import Matrix, Vector\nfrom bpy_extras.io_utils import ImportHelper\n\nclass XDRONEFIT_OT_import(bpy.types.Operator, ImportHelper):\n    bl_idname = 'xdronefit.import_project'\n    bl_label = 'Import xDroneFit project'\n    filename_ext = '.json'\n    filter_glob: bpy.props.StringProperty(default='*.json;*.dronefit.json', options={'HIDDEN'})\n\n    def execute(self, context):\n        with open(self.filepath, 'r', encoding='utf-8') as handle:\n            data = json.load(handle)\n        solution = data.get('cameraSolution')\n        photo = data.get('photo')\n        if not solution or not photo:\n            self.report({'ERROR'}, 'Project bevat nog geen berekende camera')\n            return {'CANCELLED'}\n        folder = os.path.dirname(self.filepath)\n        assets = data.get('assets') or {}\n        scene = context.scene\n        scene.unit_settings.system = 'METRIC'\n        scene.unit_settings.scale_length = 1.0\n        anchor = bpy.data.objects.get('xDroneFit Anker') or bpy.data.objects.new('xDroneFit Anker', None)\n        if anchor.name not in scene.collection.objects:\n            scene.collection.objects.link(anchor)\n        camera_data = bpy.data.cameras.get('xDroneFit Camera') or bpy.data.cameras.new('xDroneFit Camera')\n        camera = bpy.data.objects.get('xDroneFit Camera') or bpy.data.objects.new('xDroneFit Camera', camera_data)\n        if camera.name not in scene.collection.objects:\n            scene.collection.objects.link(camera)\n        camera.parent = anchor\n        r = Matrix(solution['rotationWorldToCamera'])\n        cv_to_blender = Matrix(((1,0,0),(0,-1,0),(0,0,-1)))\n        rotation_world = r @ cv_to_blender\n        location = Vector(solution['cameraLocalRd'])\n        camera.matrix_world = rotation_world.to_4x4()\n        camera.location = location\n        camera_data.lens = photo['focalLengthMm']\n        camera_data.sensor_width = photo['estimatedSensorWidthMm']\n        camera_data.sensor_fit = 'HORIZONTAL'\n        scene.camera = camera\n        scene.render.resolution_x = int(photo['width'])\n        scene.render.resolution_y = int(photo['height'])\n        scene.render.resolution_percentage = 100\n        scene.render.image_settings.file_format = 'PNG'\n        scene.render.film_transparent = True\n        photo_file = assets.get('photo')\n        if photo_file:\n            photo_path = os.path.join(folder, photo_file)\n            if os.path.exists(photo_path):\n                image = bpy.data.images.load(photo_path, check_existing=True)\n                camera_data.show_background_images = True\n                camera_data.background_images.clear()\n                background = camera_data.background_images.new()\n                background.image = image\n                background.display_depth = 'BACK'\n                background.frame_method = 'FIT'\n                background.show_background_image = True\n            else:\n                self.report({'WARNING'}, 'Dronefoto niet gevonden naast het projectbestand: ' + photo_file)\n        origin = data['site']['rd']\n        scene['xDroneFit_RD_origin'] = [origin['x'], origin['y']]\n        self.report({'INFO'}, 'xDroneFit camera en achtergrondfoto geïmporteerd')\n        return {'FINISHED'}\n\ndef menu(self, context):\n    self.layout.operator(XDRONEFIT_OT_import.bl_idname, text='xDroneFit project (.json)')\n\ndef register():\n    bpy.utils.register_class(XDRONEFIT_OT_import)\n    bpy.types.TOPBAR_MT_file_import.append(menu)\n\ndef unregister():\n    bpy.types.TOPBAR_MT_file_import.remove(menu)\n    bpy.utils.unregister_class(XDRONEFIT_OT_import)\n\nif __name__ == '__main__':\n    register()\n`;
    const blob = new Blob([script], { type: "text/x-python" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = "xdronefit_blender_import.py"; link.click(); URL.revokeObjectURL(link.href);
    setNotice("Blender-importer gedownload. Installeer hem via Edit > Preferences > Add-ons > Install from Disk.");
  }
  function triggerDownload(blob: Blob, fileName: string) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  }
  async function exportProject() {
    const solution = effectiveCameraSolution;
    if (!solution) { setNotice("Upload eerst een dronefoto met GPS- en gimbalgegevens."); return; }
    const sensorWidth = solution.sensorWidthMm;
    const focalLengthMm = drone?.width ? (sensorWidth * solution.focalPixels) / drone.width : null;
    const siteRd = wgs84ToRd(site.lon, site.lat);
    const baseName = projectName.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "project";
    const photoFileName = drone ? `${baseName}-drone-foto.jpg` : null;
    const payload = {
      schema: "nl.xdronefit.project", version: 4,
      project: { code: project.code, name: projectName, exportedAt: new Date().toISOString() },
      crs: { geographic: "EPSG:4326", horizontal: "EPSG:28992", vertical: "NAP (user supplied)", localOrigin: "site.rd" },
      site: { latitude: site.lat, longitude: site.lon, rd: { x: siteRd[0], y: siteRd[1] }, confirmed: siteConfirmed },
      assets: { photo: photoFileName },
      photo: drone ? {
        fileName: drone.fileName, width: drone.width, height: drone.height,
        latitude: drone.latitude, longitude: drone.longitude,
        relativeAltitude: drone.relativeAltitude, absoluteAltitude: drone.absoluteAltitude,
        gimbalYaw: drone.gimbalYaw, gimbalPitch: drone.gimbalPitch, gimbalRoll: drone.gimbalRoll,
        flightYaw: drone.flightYaw, focalLengthMm: focalLengthMm, focalLength35mm: drone.focalLength35mm,
        estimatedSensorWidthMm: sensorWidth, cameraMake: drone.cameraMake, cameraModel: drone.cameraModel, capturedAt: drone.capturedAt,
      } : null,
      cameraSolution: solution,
      cameraSolutionSource: cameraSolution?.mode === "vanishing-points" ? "vanishing-points" : "exif-metadata",
    };
    const zip = new JSZip();
    zip.file(`${baseName}.dronefit.json`, JSON.stringify(payload, null, 2));
    if (photoFileName) {
      const response = await fetch(`/api/projects/${project.id}/assets/photo`);
      if (response.ok) zip.file(photoFileName, await response.blob());
    }
    const zipBlob = await zip.generateAsync({ type: "blob" });
    triggerDownload(zipBlob, `${baseName}-xdronefit-export.zip`);
    setNotice("Export gedownload als zip-bestand. Pak het volledig uit in één map en importeer het .json-bestand daarin in Blender.");
  }

  const completedSteps = useMemo(() => [siteConfirmed, Boolean(drone), Boolean(effectiveCameraSolution)], [siteConfirmed, drone, effectiveCameraSolution]);
  const firstIncompleteStep = completedSteps.findIndex((complete) => !complete);
  const activeStep = firstIncompleteStep === -1 ? completedSteps.length : firstIncompleteStep;
  const siteRdDisplay = wgs84ToRd(site.lon, site.lat);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><button className="back-projects" onClick={onBack}>Projecten</button><span className="xf-mark xf-small" aria-hidden="true"><i/><i/><i/><i/><b>x</b></span><span>xDrone<b className="fit-word">Fit</b></span><small>{project.code}</small></div>
        <label className="project-title"><span>Project</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label>
        <div className="top-actions"><button className="undo-button" onClick={undoLastChange} disabled={!canUndo} title="Laatste wijziging terugdraaien (Ctrl+Z)"><i />Ongedaan</button><button className="save-button" onClick={saveProject}>{saveState}</button><span className="crs-chip">RD New · EPSG:28992</span><button className="primary-button" onClick={exportProject} disabled={!effectiveCameraSolution}>Exporteer voor Blender</button></div>
      </header>
      <section className="workspace">
        <aside className="sidebar">
          <div className="progress-line">
            {["Locatie", "Dronefoto", "Camera"].map((label, index) => (
              <div className={`progress-step ${completedSteps[index] ? "done" : index === activeStep ? "active" : ""}`} key={label}>
                <span className={completedSteps[index] ? "step-check" : ""} aria-label={completedSteps[index] ? "Voltooid" : `Stap ${index + 1}`}>{completedSteps[index] ? null : index + 1}</span><b>{label}</b>
              </div>
            ))}
          </div>
          <div className="status-message"><i />{busy || notice}</div>
          <section className={`tool-card ${collapsedSteps.location ? "collapsed" : ""}`}>
            <div className="card-heading"><span>01</span><div><h2>Projectlocatie</h2><p>Optioneel: wordt automatisch gezet zodra je de dronefoto uploadt. Zoek een adres of klik op de kaart om zelf te kiezen.</p></div><LayerEye shown={layerVisibility.project} label="Projectanker" onToggle={() => setLayerVisibility((current) => ({ ...current, project: !current.project }))} /><CollapseButton collapsed={collapsedSteps.location} label="Projectlocatie" onToggle={() => toggleStep("location")} /></div>
            <div className="coordinate-grid">
              <label>Breedtegraad<input type="number" step="0.000001" value={site.lat} onChange={(e) => setSite({ ...site, lat: Number(e.target.value) })} /></label>
              <label>Lengtegraad<input type="number" step="0.000001" value={site.lon} onChange={(e) => setSite({ ...site, lon: Number(e.target.value) })} /></label>
            </div>
            <button className="secondary-button" onClick={() => { setSiteConfirmed(true); mapInstance.current?.setView([site.lat, site.lon], 18); }}>Bevestig locatie</button>
          </section>
          <section className={`tool-card ${collapsedSteps.drone ? "collapsed" : ""}`}>
            <div className="card-heading"><span>02</span><div><h2>DJI-dronefoto</h2><p>De originele JPEG bevat positie en camera.</p></div><LayerEye shown={layerVisibility.drone} label="Drone en kijksector" onToggle={() => setLayerVisibility((current) => ({ ...current, drone: !current.drone }))} /><CollapseButton collapsed={collapsedSteps.drone} label="DJI-dronefoto" onToggle={() => toggleStep("drone")} /></div>
            <label className={`dropzone photo-dropzone ${drone ? "loaded" : ""}`} style={drone ? { backgroundImage: `linear-gradient(90deg, rgba(7,22,25,.88), rgba(7,22,25,.4)), url(${drone.previewUrl})` } : undefined}>
              <input type="file" accept="image/jpeg" onChange={handleDronePhoto} /><strong>{photoLoadFailed ? "Selecteer de originele DJI JPEG opnieuw" : drone?.fileName || "Kies originele DJI JPEG"}</strong><small>{photoLoadFailed ? "De metadata staat er nog; alleen de fotovoorvertoning ontbreekt" : drone ? `${drone.width} × ${drone.height} px` : "EXIF en DJI-XMP worden automatisch gelezen"}</small>
            </label>
            {drone && <>
              <div className="metadata-grid">
                <div><span>GPS</span><b>{formatNumber(drone.latitude, 6)}, {formatNumber(drone.longitude, 6)}</b></div>
                <div><span>Hoogte</span><b>{formatNumber(drone.relativeAltitude)} m</b></div>
                <div><span>Gimbal</span><b>{formatNumber(drone.gimbalYaw)}° / {formatNumber(drone.gimbalPitch)}°</b></div>
                <div><span>Lens</span><b>{formatNumber(drone.focalLength)} mm</b></div>
              </div>
              <div className="camera-map-hint"><i /><span><b>Stel de drone op de kaart af</b>Versleep de drone voor de vliegpositie en het richtpunt voor de kijkrichting.</span></div>
              <div className="slider-stack camera-controls">
                <NumericSlider label="Kijkrichting" value={drone.gimbalYaw ?? 0} min={-180} max={180} step={0.1} unit="°" onChange={(value) => { setDrone({ ...drone, gimbalYaw: value }); setCameraSolution(null); }} />
                <NumericSlider label="Gimbal pitch" value={drone.gimbalPitch ?? 0} min={-90} max={10} step={0.1} unit="°" onChange={(value) => { setDrone({ ...drone, gimbalPitch: value }); setCameraSolution(null); }} />
                <NumericSlider label="Vlieghoogte" value={drone.relativeAltitude ?? 30} min={1} max={200} step={0.1} unit="m" onChange={(value) => { setDrone({ ...drone, relativeAltitude: value }); setCameraSolution(null); }} />
              </div>
            </>}
          </section>
          <section className={`tool-card calibration-card ${collapsedSteps.camera ? "collapsed" : ""}`}>
            <div className="card-heading"><span>03</span><div><h2>Camera</h2><p>Teken twee haakse lijnparen op de foto (zoals fSpy) voor de exacte kijkrichting.</p></div><CollapseButton collapsed={collapsedSteps.camera} label="Camera" onToggle={() => toggleStep("camera")} /></div>
            {!drone && <p className="calibration-help">Upload eerst de originele DJI-foto.</p>}
            {drone && <div className={`vp-photo-editor ${placingVpGroup ? "is-picking" : ""} ${photoLoadFailed ? "photo-missing" : ""}`} onClick={handleVanishingPhotoClick} role="button" tabIndex={placingVpGroup ? 0 : -1} aria-label="Dronefoto voor hulplijnen">
              <img src={drone.previewUrl} alt="DJI-dronefoto voor vluchtpuntlijnen" onLoad={() => setPhotoLoadFailed(false)} onError={() => setPhotoLoadFailed(true)} />
              <svg className="vp-overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
                {vpGroup1.length >= 2 && <line x1={vpGroup1[0].x * 100} y1={vpGroup1[0].y * 100} x2={vpGroup1[1].x * 100} y2={vpGroup1[1].y * 100} className="vp-line vp-line-1" />}
                {vpGroup1.length >= 4 && <line x1={vpGroup1[2].x * 100} y1={vpGroup1[2].y * 100} x2={vpGroup1[3].x * 100} y2={vpGroup1[3].y * 100} className="vp-line vp-line-1" />}
                {vpGroup2.length >= 2 && <line x1={vpGroup2[0].x * 100} y1={vpGroup2[0].y * 100} x2={vpGroup2[1].x * 100} y2={vpGroup2[1].y * 100} className="vp-line vp-line-2" />}
                {vpGroup2.length >= 4 && <line x1={vpGroup2[2].x * 100} y1={vpGroup2[2].y * 100} x2={vpGroup2[3].x * 100} y2={vpGroup2[3].y * 100} className="vp-line vp-line-2" />}
              </svg>
              {vpGroup1.map((point, index) => <span key={`g1-${index}`} className="vp-point vp-point-1" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} />)}
              {vpGroup2.map((point, index) => <span key={`g2-${index}`} className="vp-point vp-point-2" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} />)}
              {photoLoadFailed && <div className="photo-recovery"><strong>Voorvertoning ontbreekt</strong><small>Klik hierboven bij DJI-dronefoto en selecteer één keer opnieuw het originele bestand.</small></div>}
              {placingVpGroup && !photoLoadFailed && <b>Klik het volgende punt van lijngroep {placingVpGroup}</b>}
            </div>}
            {drone && <div className="vp-controls">
              <button className={placingVpGroup === 1 ? "primary-button" : "secondary-button"} disabled={photoLoadFailed} onClick={() => { const next = placingVpGroup === 1 ? null : 1; placingVpGroupRef.current = next; setPlacingVpGroup(next); if (next) setVpGroup1([]); }}>{vpGroup1.length >= 4 ? "Lijngroep 1 opnieuw" : `Lijngroep 1 (${vpGroup1.length}/4)`}</button>
              <button className={placingVpGroup === 2 ? "primary-button" : "secondary-button"} disabled={photoLoadFailed} onClick={() => { const next = placingVpGroup === 2 ? null : 2; placingVpGroupRef.current = next; setPlacingVpGroup(next); if (next) setVpGroup2([]); }}>{vpGroup2.length >= 4 ? "Lijngroep 2 opnieuw" : `Lijngroep 2 (${vpGroup2.length}/4)`}</button>
            </div>}
            {drone && <p className="calibration-help">Kies twee stel evenwijdige lijnen die in werkelijkheid haaks op elkaar staan (bijv. twee dakranden van een hoek). Groep 1 (rood): twee lijnen langs de ene richting. Groep 2 (blauw): twee lijnen langs de loodrechte richting.</p>}
            {drone && <button className="primary-button solve-button" onClick={solveVanishingCamera} disabled={vpGroup1.length < 4 || vpGroup2.length < 4}>Bereken camera uit hulplijnen</button>}
            {drone && <div className={`quality-card ${cameraSolution ? "excellent" : "usable"}`}>
              <span>CAMERABRON</span><strong>{cameraSolution?.mode === "vanishing-points" ? "Vluchtpuntlijnen" : "EXIF-metadata"}</strong>
              <p>{cameraSolution?.mode === "vanishing-points" ? "Kijkrichting en beeldhoek berekend uit de hulplijnen op de foto." : "Positie, hoogte en kijkrichting rechtstreeks uit de dronefoto. Teken hulplijnen voor een nauwkeurigere kijkrichting."}</p>
            </div>}
            {cameraSolution && <button className="text-button" onClick={() => setCameraSolution(null)}>Terug naar EXIF-camera</button>}
            {drone && <button className="secondary-button blender-addon" onClick={downloadBlenderImporter}>Download Blender-importer</button>}
          </section>
        </aside>
        <section className="map-panel">
          <div ref={mapElement} className="map" aria-label="Interactieve projectkaart" />
          <div className="map-layer-panel" aria-label="Kaartlagen">
            <strong>Kaartlagen</strong>
            {MAP_LAYERS.map(({ key, label }) => <button
              type="button"
              key={key}
              data-testid={`layer-${key}`}
              className={layerVisibility[key] ? "visible" : "hidden"}
              aria-label={`${label} ${layerVisibility[key] ? "verbergen" : "tonen"}`}
              aria-pressed={layerVisibility[key]}
              onClick={() => setLayerVisibility((current) => ({ ...current, [key]: !current[key] }))}
            ><i aria-hidden="true" /><span>{label}</span><small>{layerVisibility[key] ? "Zichtbaar" : "Verborgen"}</small></button>)}
          </div>
          <div className="address-search">
            <div className="address-input-wrap">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={addressQuery}
                onChange={(event) => setAddressQuery(event.target.value)}
                onKeyDown={handleAddressKey}
                placeholder="Zoek adres, postcode of plaats…"
                aria-label="Zoek een Nederlands adres"
                aria-autocomplete="list"
                aria-expanded={addressResults.length > 0}
              />
              {addressBusy && <i aria-label="Adressen zoeken" />}
            </div>
            {addressResults.length > 0 && <div className="address-results" role="listbox">
              {addressResults.map((result, index) => <button
                type="button"
                key={result.id}
                className={index === activeAddress ? "active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectAddress(result)}
                role="option"
                aria-selected={index === activeAddress}
              >
                <span>{result.label}</span><small>{result.kind}</small>
              </button>)}
            </div>}
          </div>
          <div className="map-title"><span>Kaart</span><small>Klik om het projectanker te verplaatsen</small></div>
          <div className="legend"><span><i className="site-dot" />Project</span><span><i className="drone-dot" />Drone</span></div>
          <div className="map-readout"><span>RD NEW</span><b>X {siteRdDisplay[0].toFixed(2)}</b><b>Y {siteRdDisplay[1].toFixed(2)}</b></div>
        </section>
      </section>
    </main>
  );
}
