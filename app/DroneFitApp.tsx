"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import * as exifr from "exifr";
import "leaflet/dist/leaflet.css";
import type { ProjectRecord } from "./ProjectPortal";
import { solvePlanarCamera, wgs84ToRd, rdToWgs84, type CameraSolution, type ControlPoint } from "./cameraMath";

type SitePosition = { lat: number; lon: number };
type AddressResult = { id: string; label: string; lat: number; lon: number; kind: string };
type BuildingBlock = { id: string; typeName: string; lat: number; lon: number; rotation: number; elevation: number };
type DroneData = {
  fileName: string; previewUrl: string;
  latitude: number | null; longitude: number | null;
  relativeAltitude: number | null; absoluteAltitude: number | null;
  gimbalYaw: number | null; gimbalPitch: number | null; gimbalRoll: number | null;
  flightYaw: number | null; focalLength: number | null; focalLength35mm: number | null;
  width: number | null; height: number | null;
  cameraMake: string; cameraModel: string; capturedAt: string;
};

const INITIAL_SITE: SitePosition = { lat: 52.282539407, lon: 6.426162461 };

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

export default function DroneFitApp({ project, onBack }: { project: ProjectRecord; onBack: () => void }) {
  let saved: any = {};
  try { saved = JSON.parse(project.stateJson || "{}"); } catch { saved = {}; }
  const mapElement = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const mapLeaflet = useRef<any>(null);
  const markerLayer = useRef<any>(null);
  const drawingLayer = useRef<any>(null);
  const photoMatchRef = useRef<HTMLDivElement>(null);

  const [projectName, setProjectName] = useState(saved.projectName || project.name);
  const [site, setSite] = useState<SitePosition>(saved.site || INITIAL_SITE);
  const [siteConfirmed, setSiteConfirmed] = useState(Boolean(saved.siteConfirmed));
  const [drawingName, setDrawingName] = useState(saved.drawingName || "");
  const [drawingImage, setDrawingImage] = useState(saved.hasDrawing ? "/api/projects/" + project.id + "/assets/drawing" : "");
  const [drawingAspect, setDrawingAspect] = useState(saved.drawingAspect || 1.414);
  const [drawingWidth, setDrawingWidth] = useState(saved.drawingWidth || 180);
  const [drawingRotation, setDrawingRotation] = useState(saved.drawingRotation || 0);
  const [drawingOpacity, setDrawingOpacity] = useState(saved.drawingOpacity || 0.58);
  const [drone, setDrone] = useState<DroneData | null>(saved.drone ? { ...saved.drone, previewUrl: "/api/projects/" + project.id + "/assets/photo" } : null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("Zoek een adres of klik op de projectlocatie in de kaart.");
  const [addressQuery, setAddressQuery] = useState("");
  const [addressResults, setAddressResults] = useState<AddressResult[]>([]);
  const [addressBusy, setAddressBusy] = useState(false);
  const [activeAddress, setActiveAddress] = useState(-1);
  const [buildings, setBuildings] = useState<BuildingBlock[]>(saved.buildings || []);
  const [buildingType, setBuildingType] = useState("Tweekapper 1");
  const [placingBuilding, setPlacingBuilding] = useState(false);
  const [controlPoints, setControlPoints] = useState<ControlPoint[]>(saved.controlPoints || []);
  const [placingControlPoint, setPlacingControlPoint] = useState(false);
  const [pendingControlId, setPendingControlId] = useState<string | null>(null);
  const [cameraSolution, setCameraSolution] = useState<CameraSolution | null>(saved.cameraSolution || null);
  const placingBuildingRef = useRef(false);
  const buildingTypeRef = useRef("Tweekapper 1");
  const placingControlPointRef = useRef(false);

  useEffect(() => { placingBuildingRef.current = placingBuilding; }, [placingBuilding]);
  useEffect(() => { buildingTypeRef.current = buildingType; }, [buildingType]);
  useEffect(() => { placingControlPointRef.current = placingControlPoint; }, [placingControlPoint]);
  const [saveState, setSaveState] = useState("Opgeslagen");
  async function saveProject() {
    setSaveState("Opslaan...");
    const safeDrone = drone ? { ...drone, previewUrl: "" } : null;
    const state = { projectName, site, siteConfirmed, drawingName, drawingAspect, drawingWidth, drawingRotation, drawingOpacity, hasDrawing: Boolean(drawingName), drone: safeDrone, buildings, controlPoints, cameraSolution };
    const response = await fetch("/api/projects/" + project.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: project.code, name: projectName, state }) });
    setSaveState(response.ok ? "Opgeslagen" : "Opslaan mislukt");
  }
  useEffect(() => { const timer = window.setTimeout(saveProject, 1200); return () => window.clearTimeout(timer); }, [projectName, site, siteConfirmed, drawingName, drawingAspect, drawingWidth, drawingRotation, drawingOpacity, drone, buildings, controlPoints, cameraSolution]);

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
        if (placingBuildingRef.current) {
          setBuildings((current) => [...current, { id: crypto.randomUUID(), typeName: buildingTypeRef.current, lat: event.latlng.lat, lon: event.latlng.lng, rotation: 0, elevation: 0 }]);
          setPlacingBuilding(false);
          setNotice("Woninganker geplaatst.");
          return;
        }
        if (placingControlPointRef.current) {
          const id = crypto.randomUUID();
          setControlPoints((current) => [...current, { id, label: `P${current.length + 1}`, lat: event.latlng.lat, lon: event.latlng.lng, elevation: 0, imageX: null, imageY: null }]);
          setPendingControlId(id);
          setPlacingControlPoint(false);
          setCameraSolution(null);
          setNotice("Kaartpunt geplaatst. Klik nu op exact hetzelfde punt in de dronefoto.");
          return;
        }
        setSite({ lat: event.latlng.lat, lon: event.latlng.lng });
        setSiteConfirmed(true);
        setCameraSolution(null);
        setNotice("Projectlocatie vastgelegd. Upload nu de situatietekening.");
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
    L.circleMarker([site.lat, site.lon], { radius: 9, color: "#fff", weight: 3, fillColor: "#ff5d2e", fillOpacity: 1 })
      .bindTooltip("Projectanker", { permanent: true, direction: "top", offset: [0, -10] }).addTo(layer);
    buildings.forEach((building, index) => {
      const buildingIcon = L.divIcon({ className: "building-pin", html: `<span style="transform:rotate(${building.rotation}deg)">${index + 1}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] });
      const marker = L.marker([building.lat, building.lon], { icon: buildingIcon, draggable: true })
        .bindTooltip(`${building.typeName} · ${building.rotation}°`, { direction: "top", offset: [0, -16] }).addTo(layer);
      marker.on("dragend", (event: any) => {
        const point = event.target.getLatLng();
        setBuildings((current) => current.map((item) => item.id === building.id ? { ...item, lat: point.lat, lon: point.lng } : item));
      });
    });
    controlPoints.forEach((point, index) => {
      const complete = point.imageX != null && point.imageY != null;
      const icon = L.divIcon({ className: `control-pin ${complete ? "complete" : "pending"}`, html: `<span>${index + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      const marker = L.marker([point.lat, point.lon], { icon, draggable: true })
        .bindTooltip(`${point.label} · ${complete ? "gekoppeld" : "klik in foto"}`, { direction: "top", offset: [0, -14] }).addTo(layer);
      marker.on("dragend", (event: any) => {
        const position = event.target.getLatLng();
        setControlPoints((current) => current.map((item) => item.id === point.id ? { ...item, lat: position.lat, lon: position.lng } : item));
        setCameraSolution(null);
      });
    });    if (drone?.latitude != null && drone.longitude != null) {
      const solvedWgs = cameraSolution ? rdToWgs84(cameraSolution.cameraRd[0], cameraSolution.cameraRd[1]) : null;
      const position: [number, number] = solvedWgs ? [solvedWgs[1], solvedWgs[0]] : [drone.latitude, drone.longitude];
      const solvedForward = cameraSolution?.rotationWorldToCamera[2];
      const solvedYaw = solvedForward ? Math.atan2(solvedForward[0], solvedForward[1]) * 180 / Math.PI : null;
      const yaw = solvedYaw ?? drone.gimbalYaw ?? drone.flightYaw ?? 0;
      const focal35 = drone.focalLength35mm ?? 24;
      const horizontalFov = 2 * Math.atan(36 / (2 * focal35)) * 180 / Math.PI;
      const altitude = Math.max(1, cameraSolution?.cameraLocalRd[2] ?? drone.relativeAltitude ?? 30);
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
        .bindTooltip(cameraSolution ? "Berekende camera · versleep voor handmatige correctie" : "Drone · versleep om te corrigeren", { permanent: true, direction: "bottom", offset: [0, 12] }).addTo(layer);
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
  }, [site, drone, buildings, controlPoints, cameraSolution]);

  useEffect(() => {
    const L = mapLeaflet.current;
    const map = mapInstance.current;
    if (!L || !map) return;
    if (drawingLayer.current) { map.removeLayer(drawingLayer.current); drawingLayer.current = null; }
    if (!drawingImage) return;
    const heightMeters = drawingWidth / drawingAspect;
    const diagonal = Math.hypot(drawingWidth, heightMeters) / 2;
    const southWest = destination(site.lat, site.lon, 225, diagonal);
    const northEast = destination(site.lat, site.lon, 45, diagonal);
    const overlay = L.imageOverlay(drawingImage, [southWest, northEast], { opacity: drawingOpacity, interactive: false, className: "drawing-overlay" }).addTo(map);
    overlay.on("load", () => { const element = overlay.getElement(); if (element) element.style.rotate = `${drawingRotation}deg`; });
    drawingLayer.current = overlay;
    return () => { if (drawingLayer.current === overlay) { map.removeLayer(overlay); drawingLayer.current = null; } };
  }, [drawingImage, drawingAspect, drawingWidth, drawingRotation, drawingOpacity, site]);

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

  async function handleDrawing(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy("Situatietekening verwerken…");
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1.7 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.width = viewport.width; canvas.height = viewport.height;
      if (!context) throw new Error("Canvas kon niet worden aangemaakt");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      setDrawingName(file.name); setDrawingAspect(viewport.width / viewport.height); setDrawingImage(canvas.toDataURL("image/png"));
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob) await fetch("/api/projects/" + project.id + "/assets/drawing", { method: "PUT", headers: { "Content-Type": "image/png" }, body: blob });
      setNotice("Situatietekening geladen. Stel schaal, rotatie en dekking af op de luchtfoto.");
    } catch (error) {
      setNotice(`PDF kon niet worden geladen: ${error instanceof Error ? error.message : "onbekende fout"}`);
    } finally { setBusy(""); }
  }

  async function handleDronePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy("DJI-metadata uitlezen…");
    try {
      const buffer = await file.arrayBuffer();
      await fetch("/api/projects/" + project.id + "/assets/photo", { method: "PUT", headers: { "Content-Type": file.type || "image/jpeg" }, body: file });
      const tags: any = await exifr.parse(buffer, { gps: true, tiff: true, exif: true, xmp: true, translateValues: true });
      const raw = new TextDecoder("latin1").decode(buffer);
      const bitmap = await createImageBitmap(file);
      const next: DroneData = {
        fileName: file.name, previewUrl: URL.createObjectURL(file),
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
      setDrone((current) => { if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl); return next; });
      if (next.latitude != null && next.longitude != null) mapInstance.current?.setView([next.latitude, next.longitude], Math.max(mapInstance.current.getZoom(), 17));
      setNotice("Dronecamera gevonden. Controleer de positie en kijkrichting op de kaart.");
    } catch (error) {
      setNotice(`Foto kon niet worden gelezen: ${error instanceof Error ? error.message : "onbekende fout"}`);
    } finally { setBusy(""); }
  }

  function handlePhotoPoint(event: React.MouseEvent<HTMLDivElement>) {
    if (!drone || !pendingControlId || !drone.width || !drone.height) return;
    const image = event.currentTarget.querySelector("img");
    if (!image) return;
    const rect = image.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    const imageX = ((event.clientX - rect.left) / rect.width) * drone.width;
    const imageY = ((event.clientY - rect.top) / rect.height) * drone.height;
    setControlPoints((current) => current.map((point) => point.id === pendingControlId ? { ...point, imageX, imageY } : point));
    setPendingControlId(null);
    setCameraSolution(null);
    setNotice("Referentiepunt gekoppeld. Voeg verspreid over het terrein nog punten toe.");
  }

  function solveCamera() {
    if (!drone?.width || !drone.height || !drone.focalLength || !drone.focalLength35mm) {
      setNotice("Voor de berekening ontbreken beeldformaat of lensgegevens in de DJI-foto.");
      return;
    }
    try {
      const solution = solvePlanarCamera(controlPoints, site.lon, site.lat, drone.width, drone.height, drone.focalLength35mm, drone.focalLength);
      setCameraSolution(solution);
      setNotice(`Camera berekend met ${controlPoints.filter((point) => point.imageX != null).length} punten. RMS-fout: ${solution.rmsPixels.toFixed(1)} pixels.`);
    } catch (error) {
      setCameraSolution(null);
      setNotice(error instanceof Error ? error.message : "Camera kon niet worden berekend.");
    }
  }

  function downloadBlenderImporter() {
    const script = `# xDroneFit Blender importer v2\nimport bpy, json, math\nfrom mathutils import Matrix, Vector\nfrom bpy_extras.io_utils import ImportHelper\n\nclass XDRONEFIT_OT_import(bpy.types.Operator, ImportHelper):\n    bl_idname = 'xdronefit.import_project'\n    bl_label = 'Import xDroneFit project'\n    filename_ext = '.json'\n    filter_glob: bpy.props.StringProperty(default='*.json;*.dronefit.json', options={'HIDDEN'})\n\n    def execute(self, context):\n        with open(self.filepath, 'r', encoding='utf-8') as handle:\n            data = json.load(handle)\n        solution = data.get('cameraSolution')\n        photo = data.get('photo')\n        if not solution or not photo:\n            self.report({'ERROR'}, 'Project bevat nog geen berekende camera')\n            return {'CANCELLED'}\n        scene = context.scene\n        scene.unit_settings.system = 'METRIC'\n        scene.unit_settings.scale_length = 1.0\n        camera_data = bpy.data.cameras.get('xDroneFit Camera') or bpy.data.cameras.new('xDroneFit Camera')\n        camera = bpy.data.objects.get('xDroneFit Camera') or bpy.data.objects.new('xDroneFit Camera', camera_data)\n        if camera.name not in scene.collection.objects:\n            scene.collection.objects.link(camera)\n        r = Matrix(solution['rotationWorldToCamera'])\n        cv_to_blender = Matrix(((1,0,0),(0,-1,0),(0,0,-1)))\n        rotation_world = r.transposed() @ cv_to_blender\n        location = Vector(solution['cameraLocalRd'])\n        camera.matrix_world = rotation_world.to_4x4()\n        camera.location = location\n        camera_data.lens = photo['focalLengthMm']\n        camera_data.sensor_width = photo['estimatedSensorWidthMm']\n        camera_data.sensor_fit = 'HORIZONTAL'\n        scene.camera = camera\n        scene.render.resolution_x = int(photo['width'])\n        scene.render.resolution_y = int(photo['height'])\n        scene.render.resolution_percentage = 100\n        scene.render.image_settings.file_format = 'PNG'\n        scene.render.film_transparent = True\n        origin = data['site']['rd']\n        scene['xDroneFit_RD_origin'] = [origin['x'], origin['y']]\n        for block in data.get('buildings', []):\n            collection = bpy.data.collections.get(block['typeName'])\n            if collection:\n                empty = bpy.data.objects.new('xDF_' + block['typeName'], None)\n                scene.collection.objects.link(empty)\n                empty.instance_type = 'COLLECTION'\n                empty.instance_collection = collection\n                empty.location = (block['rd']['x']-origin['x'], block['rd']['y']-origin['y'], block['elevationMeters'])\n                empty.rotation_euler[2] = math.radians(-block['rotationDegreesClockwise'])\n        self.report({'INFO'}, 'xDroneFit camera en woningankers geïmporteerd')\n        return {'FINISHED'}\n\ndef menu(self, context):\n    self.layout.operator(XDRONEFIT_OT_import.bl_idname, text='xDroneFit project (.json)')\n\ndef register():\n    bpy.utils.register_class(XDRONEFIT_OT_import)\n    bpy.types.TOPBAR_MT_file_import.append(menu)\n\ndef unregister():\n    bpy.types.TOPBAR_MT_file_import.remove(menu)\n    bpy.utils.unregister_class(XDRONEFIT_OT_import)\n\nif __name__ == '__main__':\n    register()\n`;
    const blob = new Blob([script], { type: "text/x-python" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = "xdronefit_blender_import.py"; link.click(); URL.revokeObjectURL(link.href);
    setNotice("Blender-importer gedownload. Installeer hem via Edit > Preferences > Add-ons > Install from Disk.");
  }
  function exportProject() {
    const sensorWidth = drone?.focalLength && drone.focalLength35mm ? (drone.focalLength * 36) / drone.focalLength35mm : null;
    const siteRd = wgs84ToRd(site.lon, site.lat);
    const payload = {
      schema: "nl.xdronefit.project", version: 2,
      project: { code: project.code, name: projectName, exportedAt: new Date().toISOString() },
      crs: { geographic: "EPSG:4326", horizontal: "EPSG:28992", vertical: "NAP (user supplied)", localOrigin: "site.rd" },
      site: { latitude: site.lat, longitude: site.lon, rd: { x: siteRd[0], y: siteRd[1] }, confirmed: siteConfirmed },
      drawing: drawingName ? { fileName: drawingName, widthMeters: drawingWidth, rotationDegreesClockwise: drawingRotation, opacity: drawingOpacity, registration: "visual-only" } : null,
      photo: drone ? {
        fileName: drone.fileName, width: drone.width, height: drone.height,
        latitude: drone.latitude, longitude: drone.longitude,
        relativeAltitude: drone.relativeAltitude, absoluteAltitude: drone.absoluteAltitude,
        gimbalYaw: drone.gimbalYaw, gimbalPitch: drone.gimbalPitch, gimbalRoll: drone.gimbalRoll,
        flightYaw: drone.flightYaw, focalLengthMm: drone.focalLength, focalLength35mm: drone.focalLength35mm,
        estimatedSensorWidthMm: sensorWidth, cameraMake: drone.cameraMake, cameraModel: drone.cameraModel, capturedAt: drone.capturedAt,
      } : null,
      buildings: buildings.map((building) => {
        const rd = wgs84ToRd(building.lon, building.lat);
        return { id: building.id, typeName: building.typeName, latitude: building.lat, longitude: building.lon, rd: { x: rd[0], y: rd[1] }, rotationDegreesClockwise: building.rotation, elevationMeters: building.elevation };
      }),
      controlPoints: controlPoints.map((point) => ({ ...point, rd: (() => { const rd = wgs84ToRd(point.lon, point.lat); return { x: rd[0], y: rd[1] }; })() })),
      cameraSolution,
      quality: cameraSolution ? { rmsPixels: cameraSolution.rmsPixels, maxErrorPixels: cameraSolution.maxErrorPixels, pointCount: controlPoints.filter((point) => point.imageX != null).length, status: cameraSolution.rmsPixels <= 4 ? "excellent" : cameraSolution.rmsPixels <= 10 ? "usable" : "review" } : null,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${projectName.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "project"}.dronefit.json`;
    link.click(); URL.revokeObjectURL(link.href);
    setNotice(cameraSolution ? "Project met berekende camera geëxporteerd voor Blender." : "Project geëxporteerd zonder camera-oplossing.");
  }

  const completedSteps = useMemo(() => [siteConfirmed, Boolean(drawingName), Boolean(drone), buildings.length > 0, Boolean(cameraSolution)], [siteConfirmed, drawingName, drone, buildings, cameraSolution]);
  const activeStep = completedSteps.filter(Boolean).length;
  const siteRdDisplay = wgs84ToRd(site.lon, site.lat);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><button className="back-projects" onClick={onBack}>Projecten</button><span className="xf-mark xf-small" aria-hidden="true"><i/><i/><i/><i/><b>x</b></span><span>xDrone<b className="fit-word">Fit</b></span><small>{project.code}</small></div>
        <label className="project-title"><span>Project</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label>
        <div className="top-actions"><button className="save-button" onClick={saveProject}>{saveState}</button><span className="crs-chip">RD New · EPSG:28992</span><button className="primary-button" onClick={exportProject} disabled={!cameraSolution}>Exporteer voor Blender</button></div>
      </header>
      <section className="workspace">
        <aside className="sidebar">
          <div className="progress-line">
            {["Locatie", "Situatie", "Dronefoto", "Woningen", "Camera-match"].map((label, index) => (
              <div className={`progress-step ${completedSteps[index] ? "done" : index === activeStep ? "active" : ""}`} key={label}>
                <span className={completedSteps[index] ? "step-check" : ""} aria-label={completedSteps[index] ? "Voltooid" : `Stap ${index + 1}`}>{completedSteps[index] ? null : index + 1}</span><b>{label}</b>
              </div>
            ))}
          </div>
          <div className="status-message"><i />{busy || notice}</div>
          <section className="tool-card">
            <div className="card-heading"><span>01</span><div><h2>Projectlocatie</h2><p>Klik op de exacte locatie in de luchtfoto.</p></div></div>
            <div className="coordinate-grid">
              <label>Breedtegraad<input type="number" step="0.000001" value={site.lat} onChange={(e) => setSite({ ...site, lat: Number(e.target.value) })} /></label>
              <label>Lengtegraad<input type="number" step="0.000001" value={site.lon} onChange={(e) => setSite({ ...site, lon: Number(e.target.value) })} /></label>
            </div>
            <button className="secondary-button" onClick={() => { setSiteConfirmed(true); mapInstance.current?.setView([site.lat, site.lon], 18); }}>Bevestig locatie</button>
          </section>
          <section className="tool-card">
            <div className="card-heading"><span>02</span><div><h2>Situatietekening</h2><p>Upload de PDF en lijn hem uit op de kaart.</p></div></div>
            <label className={`dropzone ${drawingName ? "loaded" : ""}`}><input type="file" accept="application/pdf" onChange={handleDrawing} /><strong>{drawingName || "Kies situatie-PDF"}</strong><small>{drawingName ? "PDF zichtbaar als kaartoverlay" : "Eerste pagina wordt gebruikt"}</small></label>
            {drawingName && <div className="slider-stack">
              <label><span>Breedte <b>{drawingWidth} m</b></span><input type="range" min="40" max="400" value={drawingWidth} onChange={(e) => setDrawingWidth(Number(e.target.value))} /></label>
              <label><span>Rotatie <b>{drawingRotation}°</b></span><input type="range" min="-180" max="180" value={drawingRotation} onChange={(e) => setDrawingRotation(Number(e.target.value))} /></label>
              <label><span>Dekking <b>{Math.round(drawingOpacity * 100)}%</b></span><input type="range" min="0.1" max="0.9" step="0.05" value={drawingOpacity} onChange={(e) => setDrawingOpacity(Number(e.target.value))} /></label>
            </div>}
          </section>
          <section className="tool-card">
            <div className="card-heading"><span>03</span><div><h2>DJI-dronefoto</h2><p>De originele JPEG bevat positie en camera.</p></div></div>
            <label className={`dropzone photo-dropzone ${drone ? "loaded" : ""}`} style={drone ? { backgroundImage: `linear-gradient(90deg, rgba(7,22,25,.88), rgba(7,22,25,.4)), url(${drone.previewUrl})` } : undefined}>
              <input type="file" accept="image/jpeg" onChange={handleDronePhoto} /><strong>{drone?.fileName || "Kies originele DJI JPEG"}</strong><small>{drone ? `${drone.width} × ${drone.height} px` : "EXIF en DJI-XMP worden automatisch gelezen"}</small>
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
                <label><span>Kijkrichting <b>{formatNumber(drone.gimbalYaw)}°</b></span><input type="range" min="-180" max="180" step="0.1" value={drone.gimbalYaw ?? 0} onChange={(e) => { setDrone({ ...drone, gimbalYaw: Number(e.target.value) }); setCameraSolution(null); }} /></label>
                <label><span>Gimbal pitch <b>{formatNumber(drone.gimbalPitch)}°</b></span><input type="range" min="-90" max="10" step="0.1" value={drone.gimbalPitch ?? 0} onChange={(e) => { setDrone({ ...drone, gimbalPitch: Number(e.target.value) }); setCameraSolution(null); }} /></label>
                <label><span>Vlieghoogte <b>{formatNumber(drone.relativeAltitude)} m</b></span><input type="range" min="1" max="200" step="0.1" value={drone.relativeAltitude ?? 30} onChange={(e) => { setDrone({ ...drone, relativeAltitude: Number(e.target.value) }); setCameraSolution(null); }} /></label>
              </div>
            </>}
          </section>
          <section className="tool-card">
            <div className="card-heading"><span>04</span><div><h2>Woningblokken</h2><p>Plaats de ankerpunten van de Blender-collecties.</p></div></div>
            <label className="field-label">Collectienaam in Blender<input value={buildingType} onChange={(event) => setBuildingType(event.target.value)} list="building-types" /></label>
            <datalist id="building-types"><option value="Tweekapper 1" /><option value="Tweekapper 2" /><option value="Tweekapper 3" /><option value="Tweekapper 4" /></datalist>
            <button className={placingBuilding ? "primary-button" : "secondary-button"} onClick={() => { setPlacingBuilding((current) => !current); setNotice(placingBuilding ? "Plaatsen geannuleerd." : "Klik nu op het woninganker in de kaart."); }}>{placingBuilding ? "Klik nu in de kaart…" : "+ Plaats woningblok"}</button>
            {buildings.length > 0 && <div className="building-list">{buildings.map((building, index) => <div className="building-row" key={building.id}>
              <div><b>{index + 1}. {building.typeName}</b><button title="Verwijder woningblok" onClick={() => setBuildings((current) => current.filter((item) => item.id !== building.id))}>×</button></div>
              <label><span>Rotatie <b>{building.rotation}°</b></span><input type="range" min="-180" max="180" value={building.rotation} onChange={(event) => setBuildings((current) => current.map((item) => item.id === building.id ? { ...item, rotation: Number(event.target.value) } : item))} /></label>
              <label><span>Peilhoogte</span><input type="number" step="0.1" value={building.elevation} onChange={(event) => setBuildings((current) => current.map((item) => item.id === building.id ? { ...item, elevation: Number(event.target.value) } : item))} /></label>
            </div>)}</div>}
          </section>
          <section className="tool-card calibration-card">
            <div className="card-heading"><span>05</span><div><h2>Camera-match</h2><p>Koppel dezelfde vaste grondpunten op kaart en foto.</p></div></div>
            {!drone && <p className="calibration-help">Upload eerst de originele DJI-foto.</p>}
            {drone && <>
              <div className={`photo-matcher ${pendingControlId ? "is-picking" : ""}`} ref={photoMatchRef} onClick={handlePhotoPoint} role="button" tabIndex={pendingControlId ? 0 : -1} aria-label="Dronefoto voor referentiepunten">
                <img src={drone.previewUrl} alt="DJI-dronefoto voor camerakalibratie" />
                {controlPoints.filter((point) => point.imageX != null && point.imageY != null).map((point) => <span key={point.id} style={{ left: `${(point.imageX as number) / (drone.width || 1) * 100}%`, top: `${(point.imageY as number) / (drone.height || 1) * 100}%` }}>{controlPoints.findIndex((item) => item.id === point.id) + 1}</span>)}
                {pendingControlId && <b>Klik hetzelfde punt in de foto</b>}
              </div>
              <button className={placingControlPoint ? "primary-button" : "secondary-button"} onClick={() => { setPlacingControlPoint((current) => !current); setPlacingBuilding(false); setPendingControlId(null); setNotice(placingControlPoint ? "Referentiepunt geannuleerd." : "Klik een goed herkenbaar grondpunt op de kaart."); }}>{placingControlPoint ? "Klik nu op de kaart…" : "+ Voeg referentiepunt toe"}</button>
              {controlPoints.length > 0 && <div className="control-list">{controlPoints.map((point, index) => <div className={point.imageX == null ? "pending" : "complete"} key={point.id}>
                <span><b>{index + 1}</b>{point.imageX == null ? "Wacht op fotopunt" : `Foto ${Math.round(point.imageX)}, ${Math.round(point.imageY as number)} px`}</span>
                <label>NAP/peil <input type="number" step="0.1" value={point.elevation} onChange={(event) => { setControlPoints((current) => current.map((item) => item.id === point.id ? { ...item, elevation: Number(event.target.value) } : item)); setCameraSolution(null); }} /></label>
                {point.imageX == null && <button onClick={() => setPendingControlId(point.id)}>Koppel</button>}
                <button className="remove-control" aria-label={`Verwijder punt ${index + 1}`} onClick={() => { setControlPoints((current) => current.filter((item) => item.id !== point.id)); if (pendingControlId === point.id) setPendingControlId(null); setCameraSolution(null); }}>×</button>
              </div>)}</div>}
              <button className="primary-button solve-button" onClick={solveCamera} disabled={controlPoints.filter((point) => point.imageX != null).length < 6}>Bereken cameramatch</button>
              <p className="calibration-help">Gebruik minimaal 6 punten, verspreid over voorgrond, midden en achterzijde. Vermijd punten op daken.</p>
              {cameraSolution && <div className={`quality-card ${cameraSolution.rmsPixels <= 4 ? "excellent" : cameraSolution.rmsPixels <= 10 ? "usable" : "review"}`}>
                <span>REPROJECTIEFOUT</span><strong>{cameraSolution.rmsPixels.toFixed(1)} <small>px RMS</small></strong>
                <p>{cameraSolution.rmsPixels <= 4 ? "Zeer sterke match" : cameraSolution.rmsPixels <= 10 ? "Bruikbaar, controleer de overlay" : "Punten opnieuw controleren"}</p>
                <div><span>{controlPoints.filter((point) => point.imageX != null).length} punten</span><span>max {cameraSolution.maxErrorPixels.toFixed(1)} px</span></div>
              </div>}
              <button className="secondary-button blender-addon" onClick={downloadBlenderImporter}>Download Blender-importer</button>
            </>}
          </section>
        </aside>
        <section className="map-panel">
          <div ref={mapElement} className="map" aria-label="Interactieve projectkaart" />
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
          <div className="map-title"><span>Kaart &amp; situatielaag</span><small>{placingControlPoint ? "Klik een herkenbaar grondpunt" : placingBuilding ? "Klik om het woningblok te plaatsen" : "Klik om het projectanker te verplaatsen"}</small></div>
          <div className="legend"><span><i className="site-dot" />Project</span><span><i className="drone-dot" />Drone</span><span><i className="building-dot" />Woning</span><span><i className="control-dot" />Referentie</span><span><i className="drawing-swatch" />Situatie-PDF</span></div>
          <div className="map-readout"><span>RD NEW</span><b>X {siteRdDisplay[0].toFixed(2)}</b><b>Y {siteRdDisplay[1].toFixed(2)}</b></div>
        </section>
      </section>
    </main>
  );
}



