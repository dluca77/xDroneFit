"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import * as exifr from "exifr";
import "leaflet/dist/leaflet.css";
import type { ProjectRecord } from "./ProjectPortal";

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
  const placingBuildingRef = useRef(false);
  const buildingTypeRef = useRef("Tweekapper 1");

  useEffect(() => { placingBuildingRef.current = placingBuilding; }, [placingBuilding]);
  useEffect(() => { buildingTypeRef.current = buildingType; }, [buildingType]);
  const [saveState, setSaveState] = useState("Opgeslagen");
  async function saveProject() {
    setSaveState("Opslaan...");
    const safeDrone = drone ? { ...drone, previewUrl: "" } : null;
    const state = { projectName, site, siteConfirmed, drawingName, drawingAspect, drawingWidth, drawingRotation, drawingOpacity, hasDrawing: Boolean(drawingName), drone: safeDrone, buildings };
    const response = await fetch("/api/projects/" + project.id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: project.code, name: projectName, state }) });
    setSaveState(response.ok ? "Opgeslagen" : "Opslaan mislukt");
  }
  useEffect(() => { const timer = window.setTimeout(saveProject, 1200); return () => window.clearTimeout(timer); }, [projectName, site, siteConfirmed, drawingName, drawingAspect, drawingWidth, drawingRotation, drawingOpacity, drone, buildings]);

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
    if (drone?.latitude != null && drone.longitude != null) {
      const position: [number, number] = [drone.latitude, drone.longitude];
      const yaw = drone.gimbalYaw ?? drone.flightYaw ?? 0;
      const tip = destination(position[0], position[1], yaw, 115);
      const left = destination(position[0], position[1], yaw - 28, 92);
      const right = destination(position[0], position[1], yaw + 28, 92);
      L.polygon([position, left, tip, right], { color: "#0f6f67", weight: 2, fillColor: "#3bd0c3", fillOpacity: 0.2 }).addTo(layer);
      const droneIcon = L.divIcon({ className: "drone-pin", html: "<span>✦</span>", iconSize: [30, 30], iconAnchor: [15, 15] });
      const droneMarker = L.marker(position, { icon: droneIcon, draggable: true })
        .bindTooltip("Drone · versleep om te corrigeren", { permanent: true, direction: "bottom", offset: [0, 12] }).addTo(layer);
      droneMarker.on("dragend", (event: any) => {
        const point = event.target.getLatLng();
        setDrone((current) => current ? { ...current, latitude: point.lat, longitude: point.lng } : current);
        setNotice("Dronepositie handmatig gecorrigeerd.");
      });
    }
  }, [site, drone, buildings]);

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

  function exportProject() {
    const sensorWidth = drone?.focalLength && drone.focalLength35mm ? (drone.focalLength * 36) / drone.focalLength35mm : 13;
    const payload = {
      schema: "nl.dronefit.project", version: 1,
      project: { name: projectName, createdAt: new Date().toISOString() },
      crs: { horizontal: "EPSG:28992", vertical: "NAP", compound: "EPSG:7415" },
      site: { latitude: site.lat, longitude: site.lon, confirmed: siteConfirmed },
      drawing: drawingName ? { fileName: drawingName, widthMeters: drawingWidth, rotationDegreesClockwise: drawingRotation, opacity: drawingOpacity } : null,
      photo: drone ? {
        fileName: drone.fileName, width: drone.width, height: drone.height,
        latitude: drone.latitude, longitude: drone.longitude,
        relativeAltitude: drone.relativeAltitude, absoluteAltitude: drone.absoluteAltitude,
        gimbalYaw: drone.gimbalYaw, gimbalPitch: drone.gimbalPitch, gimbalRoll: drone.gimbalRoll,
        flightYaw: drone.flightYaw, focalLengthMm: drone.focalLength, focalLength35mm: drone.focalLength35mm,
        estimatedSensorWidthMm: sensorWidth, cameraMake: drone.cameraMake, cameraModel: drone.cameraModel, capturedAt: drone.capturedAt,
      } : null,
      buildings: buildings.map((building) => ({ id: building.id, typeName: building.typeName, latitude: building.lat, longitude: building.lon, rotationDegreesClockwise: building.rotation, elevationMeters: building.elevation })), controlPoints: [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${projectName.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "project"}.dronefit.json`;
    link.click(); URL.revokeObjectURL(link.href);
    setNotice("xDroneFit-project geëxporteerd. Dit bestand kan direct in Blender worden geïmporteerd.");
  }

  const completedSteps = useMemo(() => [siteConfirmed, Boolean(drawingName), Boolean(drone), buildings.length > 0, false], [siteConfirmed, drawingName, drone, buildings]);
  const activeStep = completedSteps.filter(Boolean).length;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><button className="back-projects" onClick={onBack}>Projecten</button><span className="xf-mark xf-small" aria-hidden="true"><i/><i/><i/><i/><b>x</b></span><span>xDrone<b className="fit-word">Fit</b></span><small>{project.code}</small></div>
        <label className="project-title"><span>Project</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label>
        <div className="top-actions"><button className="save-button" onClick={saveProject}>{saveState}</button><span className="crs-chip">RD + NAP · EPSG:7415</span><button className="primary-button" onClick={exportProject} disabled={!drone || !drawingName}>Exporteer voor Blender</button></div>
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
              <div className="slider-stack camera-controls">
                <label><span>Kijkrichting <b>{formatNumber(drone.gimbalYaw)}°</b></span><input type="range" min="-180" max="180" step="0.1" value={drone.gimbalYaw ?? 0} onChange={(e) => setDrone({ ...drone, gimbalYaw: Number(e.target.value) })} /></label>
                <label><span>Gimbal pitch <b>{formatNumber(drone.gimbalPitch)}°</b></span><input type="range" min="-90" max="10" step="0.1" value={drone.gimbalPitch ?? 0} onChange={(e) => setDrone({ ...drone, gimbalPitch: Number(e.target.value) })} /></label>
                <label><span>Vlieghoogte <b>{formatNumber(drone.relativeAltitude)} m</b></span><input type="range" min="1" max="200" step="0.1" value={drone.relativeAltitude ?? 30} onChange={(e) => setDrone({ ...drone, relativeAltitude: Number(e.target.value) })} /></label>
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
          </section>        </aside>
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
          <div className="map-title"><span>Kaart &amp; situatielaag</span><small>{placingBuilding ? "Klik om het woningblok te plaatsen" : "Klik om het projectanker te verplaatsen"}</small></div>
          <div className="legend"><span><i className="site-dot" />Project</span><span><i className="drone-dot" />Drone</span><span><i className="building-dot" />Woning</span><span><i className="drawing-swatch" />Situatie-PDF</span></div>
          <div className="map-readout"><span>WGS84</span><b>{site.lat.toFixed(7)}</b><b>{site.lon.toFixed(7)}</b></div>
        </section>
      </section>
    </main>
  );
}



