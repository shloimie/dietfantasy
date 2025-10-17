// components/DriversMapLeaflet.jsx
"use client";

import React, {
    useEffect,
    useMemo,
    useRef,
    useState,
    useCallback,
} from "react";
import {
    MapContainer,
    TileLayer,
    Marker,
    Popup,
    ZoomControl,
    useMap,
    CircleMarker,
    Polyline,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* ==================== Debug ==================== */
const DEBUG = false;
const dlog = (...args) => { if (DEBUG) console.log("[DriversMap]", ...args); };

/* ==================== Helpers ==================== */

function sid(v) { try { return v == null ? "" : String(v); } catch { return ""; } }

function asLeafletMarker(maybe) {
    if (!maybe) return null;
    if (typeof maybe.getLatLng === "function") return maybe;
    if (maybe.leafletElement?.getLatLng) return maybe.leafletElement;
    if (maybe.marker?.getLatLng) return maybe.marker;
    return null;
}

function makePinIcon(color = "#1f77b4") {
    const html = `
    <div style="position:relative; width:28px; height:42px; transform: translate(-50%, -100%);">
      <svg width="28" height="42" viewBox="0 0 28 42" xmlns="http://www.w3.org/2000/svg" style="display:block">
        <path d="M14 0C6.82 0 1 5.82 1 13c0 9.6 10.3 18.1 12.2 19.67a1 1 0 0 0 1.6 0C16.7 31.1 27 22.6 27 13 27 5.82 21.18 0 14 0z" fill="${color}" stroke="rgba(0,0,0,0.4)" stroke-width="1.5"/>
        <circle cx="14" cy="13" r="4.5" fill="white"/>
      </svg>
      <div style="position:absolute; left:50%; bottom:-4px; transform:translateX(-50%); width:16px; height:6px; border-radius:50%; background:rgba(0,0,0,0.25); filter: blur(1px);"></div>
    </div>
  `;
    return L.divIcon({
        html,
        className: "pin-icon",
        iconSize: [28, 42],
        iconAnchor: [14, 40],
        popupAnchor: [0, -36],
    });
}

function findStopByIdLocal(id, drivers, unrouted) {
    const key = sid(id);
    for (const d of drivers) {
        for (const s of d.stops || []) {
            if (sid(s.id) === key) return { stop: s, color: d.color || "#1f77b4", fromDriverId: d.driverId };
        }
    }
    for (const s of unrouted || []) {
        if (sid(s.id) === key) return { stop: s, color: "#666", fromDriverId: null };
    }
    return { stop: null, color: "#666", fromDriverId: null };
}

/* ---- Map view persistence ---- */
const VIEW_KEY = "driversMap:view"; // sessionStorage {lat,lng,zoom}
function saveView(map) {
    try {
        const c = map.getCenter();
        const z = map.getZoom();
        sessionStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat, lng: c.lng, zoom: z }));
    } catch {}
}
function loadView() {
    try {
        const raw = sessionStorage.getItem(VIEW_KEY);
        if (!raw) return null;
        const v = JSON.parse(raw);
        if (Number.isFinite(v?.lat) && Number.isFinite(v?.lng) && Number.isFinite(v?.zoom)) return v;
    } catch {}
    return null;
}

/* ---- Map bridge ---- */
function MapBridge({ onReady }) {
    const map = useMap();
    useEffect(() => { if (map) onReady?.(map); }, [map, onReady]);
    return null;
}

/* ==================== Component ==================== */

export default function DriversMapLeaflet({
                                              drivers = [],
                                              unrouted = [],
                                              onReassign,         // (stop, driverId) => Promise
                                              onReassignBulk,     // OPTIONAL: ({ stopIds, driverId }) => Promise
                                              onClose,
                                              initialCenter = [40.7128, -74.006],
                                              initialZoom = 10,
                                          }) {
    const mapRef = useRef(null);
    const [mapReady, setMapReady] = useState(false);
    const pendingOpenIdRef = useRef(null);

    // keep latest server-call refs
    const onReassignRef = useRef(onReassign);
    const onReassignBulkRef = useRef(onReassignBulk);
    useEffect(() => { onReassignRef.current = onReassign; }, [onReassign]);
    useEffect(() => { onReassignBulkRef.current = onReassignBulk; }, [onReassignBulk]);

    /* ------- Local copies so UI updates without parent refresh ------- */
    const [localDrivers, setLocalDrivers] = useState(drivers);
    const [localUnrouted, setLocalUnrouted] = useState(unrouted);
    const localDriversRef = useRef(localDrivers);
    const localUnroutedRef = useRef(localUnrouted);
    useEffect(() => { localDriversRef.current = localDrivers; }, [localDrivers]);
    useEffect(() => { localUnroutedRef.current = localUnrouted; }, [localUnrouted]);

    // initialize once; ignore later prop changes
    const didInitLocalRef = useRef(false);
    useEffect(() => {
        if (!didInitLocalRef.current) {
            didInitLocalRef.current = true;
            setLocalDrivers(drivers);
            setLocalUnrouted(unrouted);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ------- UI toggles / selection ------- */
    const [showRouteLines, setShowRouteLines] = useState(false);

    // New: precise drag-rectangle selection (Shift+drag)
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [bulkBusy, setBulkBusy] = useState(false);
    const selectedCount = selectedIds.size;

    /* ------- Derived from LOCAL state ------- */
    const assignedIdSet = useMemo(() => {
        const set = new Set();
        for (const d of localDrivers) for (const s of d.stops || []) set.add(sid(s.id));
        return set;
    }, [localDrivers]);

    const unroutedFiltered = useMemo(
        () => (localUnrouted || []).filter((s) => !assignedIdSet.has(sid(s.id))),
        [localUnrouted, assignedIdSet]
    );

    const indexItems = useMemo(
        () => localDrivers.map((d) => ({
            driverId: d.driverId, name: d.name, color: d.color, count: (d.stops || []).length,
        })),
        [localDrivers]
    );
    const totalAssigned = useMemo(() => indexItems.reduce((s, x) => s + x.count, 0), [indexItems]);

    /* ------- Marker refs for fly-to and popups ------- */
    const assignedMarkerRefs = useRef(new Map());
    const unroutedMarkerRefs = useRef(new Map());
    useEffect(() => {
        assignedMarkerRefs.current = new Map();
        unroutedMarkerRefs.current = new Map();
    }, [localDrivers, unroutedFiltered]);

    /* ------- Search ------- */
    const [q, setQ] = useState("");
    const [results, setResults] = useState([]);
    useEffect(() => {
        const needle = q.trim().toLowerCase();
        if (!needle) { setResults([]); return; }
        const rows = [];
        for (const d of localDrivers) {
            for (const s of d.stops || []) {
                const hay = [s.name, s.address, s.city, s.state, s.zip, s.phone].filter(Boolean).join(" ").toLowerCase();
                if (hay.includes(needle)) rows.push({ ...s, __driverId: d.driverId, __unrouted: false });
            }
        }
        for (const s of unroutedFiltered) {
            const hay = [s.name, s.address, s.city, s.state, s.zip, s.phone].filter(Boolean).join(" ").toLowerCase();
            if (hay.includes(needle)) rows.push({ ...s, __driverId: null, __unrouted: true });
        }
        setResults(rows.slice(0, 30));
    }, [q, localDrivers, unroutedFiltered]);

    /* ------- Single-stop focus / popup ------- */
    const [selectedId, setSelectedId] = useState("");
    const [selectedHalo, setSelectedHalo] = useState({ lat: null, lng: null, color: "#666" });

    const openById = useCallback((id) => {
        const key = sid(id);
        const map = mapRef.current;
        if (!key || !map) return false;

        const fromAssigned = assignedMarkerRefs.current.get(key);
        const fromUnrouted = unroutedMarkerRefs.current.get(key);
        const marker = fromAssigned || fromUnrouted;

        if (marker?.getLatLng) {
            const ll = marker.getLatLng();
            map.setView(ll, Math.max(map.getZoom(), 15), { animate: true });
            setSelectedHalo({ lat: ll.lat, lng: ll.lng, color: fromAssigned ? "#1f77b4" : "#666" });
            setTimeout(() => { try { marker.openPopup?.(); } catch {} }, 60);
            return true;
        }

        const { stop, color } = findStopByIdLocal(key, localDriversRef.current, localUnroutedRef.current);
        if (stop && Number.isFinite(stop.lat) && Number.isFinite(stop.lng)) {
            map.setView([stop.lat, stop.lng], Math.max(map.getZoom(), 15), { animate: true });
            setSelectedHalo({ lat: stop.lat, lng: stop.lng, color });

            // quick popup with select (uses latest drivers via ref)
            const container = document.createElement("div");
            container.style.minWidth = "240px";
            container.style.border = `3px solid ${color}`;
            container.style.borderRadius = "10px";
            container.style.padding = "6px";
            container.style.boxShadow = "0 6px 24px rgba(0,0,0,0.15)";
            container.innerHTML = `
        <div style="font-weight:700">${stop.name || "Unnamed"}</div>
        <div>${stop.address || ""}${stop.apt ? " " + stop.apt : ""}</div>
        <div>${stop.city || ""} ${stop.state || ""} ${stop.zip || ""}</div>
        ${stop.phone ? `<div style="margin-top:4px">${stop.phone}</div>` : ""}
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
          <label style="font-size:12px">Assign to:</label>
          <select id="__assignSel" style="padding:4px 6px;border-radius:6px;border:1px solid #ccc"></select>
        </div>
      `;
            const selEl = container.querySelector("#__assignSel");
            const o0 = document.createElement("option");
            o0.value = ""; o0.textContent = "Select driver…"; o0.disabled = true; o0.selected = true;
            selEl.appendChild(o0);
            for (const d of localDriversRef.current) {
                const o = document.createElement("option");
                o.value = String(d.driverId);
                o.textContent = d.name;
                selEl.appendChild(o);
            }
            selEl.addEventListener("change", async () => {
                const to = Number(selEl.value);
                if (Number.isFinite(to)) await onReassignLocal(stop, to);
            });

            L.popup({ closeOnClick: true, autoClose: true, className: "color-popup" })
                .setLatLng([stop.lat, stop.lng])
                .setContent(container)
                .openOn(map);
            return true;
        }
        return false;
    }, []);

    useEffect(() => {
        if (!selectedId || !mapReady) return;
        let tries = 0;
        const tryOpen = () => {
            tries++;
            const ok = openById(selectedId);
            if (!ok && tries < 3) setTimeout(tryOpen, 120);
        };
        tryOpen();
    }, [selectedId, mapReady, openById]);

    const onSearchKeyDown = useCallback((e) => {
        if (e.key === "Enter" && results.length > 0) {
            e.preventDefault();
            const k = sid(results[0].id);
            if (k) { openById(k); setSelectedId(k); }
        }
    }, [results, openById]);

    /* ------- Map ready + persist view ------- */
    const handleMapReady = useCallback((m) => {
        mapRef.current = m;

        const saved = loadView();
        if (saved) m.setView([saved.lat, saved.lng], saved.zoom, { animate: false });
        else m.setView(initialCenter, initialZoom, { animate: false });

        const onMoveEnd = () => saveView(m);
        m.on("moveend", onMoveEnd);
        m.on("zoomend", onMoveEnd);

        setMapReady(true);

        if (pendingOpenIdRef.current) {
            const k = pendingOpenIdRef.current;
            pendingOpenIdRef.current = null;
            setTimeout(() => openById(k), 0);
        }
    }, [initialCenter, initialZoom, openById]);

    /* ======== NEW: Pixel-accurate drag rectangle (Shift+drag) ======== */
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const container = map.getContainer();
        if (!container) return;

        let start = null;           // {x,y}
        let overlay = null;         // DOM div
        const HIT_RADIUS = 25;      // pixels around pin point
        let draggingDisabled = false;

        function toPoint(e) {
            // pageX/pageY to container-local coords
            const rect = container.getBoundingClientRect();
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }

        function onMouseDown(e) {
            if (!selectMode || !e.shiftKey || e.button !== 0) return;
            // prevent starting from UI overlay clicks
            if (e.target.closest(".leaflet-control") || e.target.closest(".leaflet-popup")) return;

            start = toPoint(e);
            // build overlay
            overlay = document.createElement("div");
            overlay.style.position = "absolute";
            overlay.style.left = `${start.x}px`;
            overlay.style.top = `${start.y}px`;
            overlay.style.width = "0px";
            overlay.style.height = "0px";
            overlay.style.border = "1.5px dashed rgba(0,120,255,0.9)";
            overlay.style.background = "rgba(0,120,255,0.12)";
            overlay.style.pointerEvents = "none";
            overlay.style.zIndex = 999;
            container.appendChild(overlay);

            // freeze map panning while selecting
            if (map.dragging.enabled()) {
                map.dragging.disable();
                draggingDisabled = true;
            }

            // also stop map clicks/boxzoom from triggering
            e.preventDefault();
            e.stopPropagation();
        }

        function onMouseMove(e) {
            if (!start || !overlay) return;
            const p = toPoint(e);
            const x1 = Math.min(start.x, p.x);
            const y1 = Math.min(start.y, p.y);
            const x2 = Math.max(start.x, p.x);
            const y2 = Math.max(start.y, p.y);
            overlay.style.left = `${x1}px`;
            overlay.style.top = `${y1}px`;
            overlay.style.width = `${x2 - x1}px`;
            overlay.style.height = `${y2 - y1}px`;
        }

        function withinRect(px, py, rect, pad = 0) {
            return (
                px >= rect.x1 - pad &&
                px <= rect.x2 + pad &&
                py >= rect.y1 - pad &&
                py <= rect.y2 + pad
            );
        }

        function onMouseUp(e) {
            if (!start) return;

            const end = toPoint(e);
            const rect = {
                x1: Math.min(start.x, end.x),
                y1: Math.min(start.y, end.y),
                x2: Math.max(start.x, end.x),
                y2: Math.max(start.y, end.y),
            };

            // Compute selection against CURRENT local data in pixel space
            const map = mapRef.current;
            const dSnap = localDriversRef.current;
            const uSnap = localUnroutedRef.current;
            const picked = new Set();

            const pickPoint = (lat, lng, id) => {
                const pt = map.latLngToContainerPoint([lat, lng]);
                if (withinRect(pt.x, pt.y, rect, HIT_RADIUS)) picked.add(sid(id));
            };

            for (const d of dSnap) {
                for (const s of d.stops || []) {
                    if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
                        pickPoint(s.lat, s.lng, s.id);
                    }
                }
            }
            for (const s of uSnap) {
                if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
                    pickPoint(s.lat, s.lng, s.id);
                }
            }

            setSelectedIds(picked);

            // cleanup
            if (overlay?.parentNode) overlay.parentNode.removeChild(overlay);
            overlay = null;
            start = null;

            if (draggingDisabled) {
                map.dragging.enable();
                draggingDisabled = false;
            }

            // stop click from bubbling into map
            e.preventDefault();
            e.stopPropagation();
        }

        // Attach low-level listeners to the container
        container.addEventListener("mousedown", onMouseDown, true);
        window.addEventListener("mousemove", onMouseMove, true);
        window.addEventListener("mouseup", onMouseUp, true);

        return () => {
            container.removeEventListener("mousedown", onMouseDown, true);
            window.removeEventListener("mousemove", onMouseMove, true);
            window.removeEventListener("mouseup", onMouseUp, true);
        };
    }, [selectMode]);

    /* ------- Local moves (single and multi) ------- */
    const moveStopsLocally = useCallback((stopIds, toDriverId) => {
        const idKeys = new Set(stopIds.map(sid));
        const dSnap = localDriversRef.current;
        const uSnap = localUnroutedRef.current;

        // gather stop objects in original order
        const movingStops = [];
        for (const id of idKeys) {
            const { stop } = findStopByIdLocal(id, dSnap, uSnap);
            if (stop) movingStops.push(stop);
        }

        // strip from drivers
        const strippedDrivers = dSnap.map((d) => ({
            ...d,
            stops: (d.stops || []).filter((s) => !idKeys.has(sid(s.id))),
        }));
        // strip from unrouted
        const nextUnrouted = uSnap.filter((s) => !idKeys.has(sid(s.id)));

        // append to target driver once
        const nextDrivers = strippedDrivers.map((d) => {
            if (Number(d.driverId) === Number(toDriverId)) {
                const newStops = Array.isArray(d.stops) ? [...d.stops, ...movingStops.map((s) => ({ ...s }))] : movingStops.map((s) => ({ ...s }));
                return { ...d, stops: newStops };
            }
            return d;
        });

        setLocalDrivers(nextDrivers);
        setLocalUnrouted(nextUnrouted);
        localDriversRef.current = nextDrivers;
        localUnroutedRef.current = nextUnrouted;
    }, []);

    const onReassignLocal = useCallback(
        async (stop, toDriverId) => {
            await onReassignRef.current?.(stop, toDriverId);   // server OK
            moveStopsLocally([stop.id], toDriverId);           // local update
        },
        [moveStopsLocally]
    );

    /* ------- Bulk assign (atomic UI update + auto-reset) ------- */
    const [bulkDriverId, setBulkDriverId] = useState("");
    const applyBulkAssign = useCallback(async () => {
        const to = Number(bulkDriverId);
        if (!Number.isFinite(to) || selectedIds.size === 0 || bulkBusy) return;
        setBulkBusy(true);

        const ids = Array.from(selectedIds);
        const dSnap = localDriversRef.current;
        const uSnap = localUnroutedRef.current;
        const stops = ids
            .map((id) => findStopByIdLocal(id, dSnap, uSnap).stop)
            .filter(Boolean);

        try {
            if (onReassignBulkRef.current) {
                await onReassignBulkRef.current({ stopIds: stops.map((s) => s.id), driverId: to });
            } else {
                await Promise.all(stops.map((s) => onReassignRef.current?.(s, to)));
            }
            moveStopsLocally(stops.map((s) => s.id), to);
        } finally {
            // Auto-reset so you're ready for another batch immediately
            setSelectedIds(new Set());
            setBulkDriverId("");
            setBulkBusy(false);
        }
    }, [bulkDriverId, selectedIds, bulkBusy, moveStopsLocally]);

    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
        setBulkDriverId("");
    }, []);

    /* ------- Overlay (selection toolbar pinned on top) ------- */
    const overlay = (
        <div
            style={{
                position: "absolute",
                zIndex: 1000,
                left: 10,
                top: 10,
                width: 340,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                pointerEvents: "none",
            }}
        >
            {/* Selection toolbar */}
            {selectedCount > 0 && (
                <div
                    style={{
                        pointerEvents: "auto",
                        background: "rgba(255,255,255,0.98)",
                        border: "1px solid #cde",
                        borderRadius: 12,
                        padding: 10,
                        boxShadow: "0 6px 18px rgba(0,0,0,0.18)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        outline: "2px solid rgba(0,120,255,0.15)",
                    }}
                >
                    <div style={{ fontWeight: 700, fontSize: 13 }}>
                        {selectedCount} stop{selectedCount === 1 ? "" : "s"} selected
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <label style={{ fontSize: 12 }}>Assign to:</label>
                        <select
                            value={bulkDriverId}
                            onChange={(e) => setBulkDriverId(e.target.value)}
                            disabled={bulkBusy}
                            style={{
                                padding: "6px 8px",
                                borderRadius: 8,
                                border: "1px solid #ccc",
                                flex: "1 1 auto",
                                opacity: bulkBusy ? 0.7 : 1,
                            }}
                        >
                            <option value="">Choose driver…</option>
                            {localDrivers.map((opt) => (
                                <option key={opt.driverId} value={opt.driverId}>{opt.name}</option>
                            ))}
                        </select>
                        <button
                            onClick={applyBulkAssign}
                            disabled={!bulkDriverId || bulkBusy}
                            style={{
                                padding: "8px 10px",
                                borderRadius: 10,
                                border: "1px solid #2a7",
                                background: !bulkDriverId || bulkBusy ? "#f6f6f6" : "#eaffea",
                                cursor: !bulkDriverId || bulkBusy ? "not-allowed" : "pointer",
                                fontWeight: 600,
                                whiteSpace: "nowrap",
                            }}
                            title={bulkBusy ? "Assigning…" : `Assign ${selectedCount}`}
                        >
                            {bulkBusy ? "Assigning…" : `Assign ${selectedCount}`}
                        </button>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button
                            onClick={clearSelection}
                            disabled={bulkBusy}
                            style={{
                                flex: 1,
                                padding: "8px 10px",
                                borderRadius: 10,
                                border: "1px solid #ddd",
                                background: "#fff",
                                cursor: bulkBusy ? "not-allowed" : "pointer",
                                fontWeight: 600,
                                opacity: bulkBusy ? 0.7 : 1,
                            }}
                        >
                            Clear
                        </button>
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.8 }}>
                        Tip: keep “Area select” ON and hold <b>Shift</b> to drag a box.
                    </div>
                </div>
            )}

            {/* Close button */}
            <div style={{ pointerEvents: "auto" }}>
                <button
                    onClick={onClose}
                    style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: 12,
                        border: "1px solid #ddd",
                        background: "#fff",
                        cursor: "pointer",
                        fontWeight: 600,
                        boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
                    }}
                >
                    × Close Map
                </button>
            </div>

            {/* Legend + toggles */}
            <div
                style={{
                    pointerEvents: "auto",
                    background: "rgba(255,255,255,0.97)",
                    border: "1px solid #ddd",
                    borderRadius: 12,
                    padding: 10,
                    boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
                    overflow: "auto",
                    maxHeight: "45vh",
                }}
            >
                <div style={{ fontWeight: 700, marginBottom: 8 }}>
                    Drivers ({totalAssigned} assigned)
                </div>

                {/* Route lines toggle */}
                <label
                    style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8, userSelect: "none" }}
                    title="Draw a line connecting stops in order for each driver"
                >
                    <input
                        type="checkbox"
                        checked={showRouteLines}
                        onChange={(e) => setShowRouteLines(e.target.checked)}
                        style={{ transform: "translateY(1px)" }}
                    />
                    Show route lines
                </label>

                {/* Area select toggle */}
                <label
                    style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 10, userSelect: "none" }}
                    title="When ON, hold Shift and drag a box to select stops"
                >
                    <input
                        type="checkbox"
                        checked={selectMode}
                        onChange={(e) => setSelectMode(e.target.checked)}
                        style={{ transform: "translateY(1px)" }}
                    />
                    Area select (hold <b>Shift</b> & drag)
                </label>

                {/* Unrouted jump */}
                <button
                    type="button"
                    onClick={() => {
                        // next unrouted (simple helper kept from earlier versions)
                        const list = unroutedFiltered;
                        if (!list.length) return;
                        const target = list[0];
                        const k = sid(target?.id);
                        if (k) { openById(k); setSelectedId(k); }
                    }}
                    style={{
                        width: "100%", display: "flex", alignItems: "center", gap: 8,
                        fontSize: 13, padding: "6px 8px", borderRadius: 8, border: "1px solid #eee",
                        background: "#fff", cursor: unroutedFiltered.length ? "pointer" : "not-allowed",
                        marginBottom: 8,
                    }}
                    title={unroutedFiltered.length ? "Click to jump to an unrouted stop" : "No unrouted"}
                    disabled={!unroutedFiltered.length}
                >
          <span
              style={{ width: 16, height: 16, borderRadius: 4, background: "#666", border: "1px solid rgba(0,0,0,0.15)", flex: "0 0 auto" }}
          />
                    <div style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        Unrouted
                    </div>
                    <div style={{ fontVariantNumeric: "tabular-nums", opacity: 0.85, paddingLeft: 6 }}>
                        {unroutedFiltered.length}
                    </div>
                </button>

                {/* Drivers list */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {indexItems.map((it) => (
                        <div key={it.driverId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span
                  style={{ width: 16, height: 16, borderRadius: 4, background: it.color, border: "1px solid rgba(0,0,0,0.15)", flex: "0 0 auto" }}
              />
                            <div title={it.name} style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {it.name}
                            </div>
                            <div style={{ fontVariantNumeric: "tabular-nums", opacity: 0.85, paddingLeft: 6 }}>
                                {it.count}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Search */}
            <div
                style={{
                    pointerEvents: "auto",
                    background: "rgba(255,255,255,0.97)",
                    border: "1px solid #ddd",
                    borderRadius: 12,
                    padding: 10,
                    boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
                }}
            >
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={onSearchKeyDown}
                    placeholder="Search name, address, phone… (Enter opens first)"
                    style={{ width: "100%", height: 36, borderRadius: 8, border: "1px solid #ccc", padding: "0 10px", outline: "none" }}
                />
                {results.length > 0 && (
                    <div style={{ marginTop: 8, maxHeight: 240, overflow: "auto", borderTop: "1px solid #eee", paddingTop: 6 }}>
                        {results.map((r) => (
                            <button
                                key={`res-${sid(r.id)}`}
                                type="button"
                                onClick={() => { const k = sid(r.id); openById(k); setSelectedId(k); }}
                                style={{
                                    width: "100%",
                                    textAlign: "left",
                                    padding: "8px 8px",
                                    margin: "2px 0",
                                    borderRadius: 8,
                                    border: "1px solid #eee",
                                    background: "#fff",
                                    cursor: "pointer",
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = "#f6f6f6")}
                                onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
                            >
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                                <div style={{ fontSize: 12, opacity: 0.8 }}>
                                    {r.address}{r.apt ? ` ${r.apt}` : ""}, {r.city} {r.state} {r.zip}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );

    /* ------- Halos for selection ------- */
    const selectedHalos = useMemo(() => {
        if (!selectedIds.size) return [];
        const halos = [];
        const dSnap = localDriversRef.current;
        const uSnap = localUnroutedRef.current;
        for (const id of selectedIds) {
            const { stop, color } = findStopByIdLocal(id, dSnap, uSnap);
            if (stop && Number.isFinite(stop.lat) && Number.isFinite(stop.lng)) {
                halos.push({ id, lat: stop.lat, lng: stop.lng, color });
            }
        }
        return halos;
    }, [selectedIds]);

    /* ------- Render map ------- */
    return (
        <div style={{ height: "100%", width: "100%", position: "relative" }}>
            {overlay}

            <div style={{ height: "100%", width: "100%", borderRadius: 12, overflow: "hidden" }}>
                <MapContainer
                    key="drivers-map-stable"
                    center={initialCenter}
                    zoom={initialZoom}
                    style={{ height: "100%", width: "100%" }}
                    scrollWheelZoom
                    zoomControl={false}
                >
                    <MapBridge onReady={handleMapReady} />

                    <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution="&copy; OpenStreetMap contributors"
                    />
                    <ZoomControl position="bottomleft" />

                    {/* single selected halo */}
                    {Number.isFinite(selectedHalo.lat) && Number.isFinite(selectedHalo.lng) && (
                        <CircleMarker
                            center={[selectedHalo.lat, selectedHalo.lng]}
                            pathOptions={{ color: selectedHalo.color, fillColor: selectedHalo.color, fillOpacity: 0.18 }}
                            radius={18}
                            weight={3}
                            interactive={false}
                        />
                    )}

                    {/* multi-select halos */}
                    {selectedHalos.map((h) => (
                        <CircleMarker
                            key={`sel-${h.id}`}
                            center={[h.lat, h.lng]}
                            pathOptions={{ color: h.color, fillColor: h.color, fillOpacity: 0.2 }}
                            radius={16}
                            weight={3}
                            interactive={false}
                        />
                    ))}

                    {/* route lines */}
                    {showRouteLines &&
                        localDrivers.map((d) => {
                            const pts = (d.stops || [])
                                .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
                                .map((s) => [s.lat, s.lng]);
                            if (pts.length < 2) return null;
                            return (
                                <Polyline
                                    key={`route-${String(d.driverId)}`}
                                    positions={pts}
                                    pathOptions={{ color: d.color || "#1f77b4", weight: 4, opacity: 0.8 }}
                                />
                            );
                        })
                    }

                    {/* unrouted markers */}
                    {unroutedFiltered.map((s) =>
                        Number.isFinite(s.lat) && Number.isFinite(s.lng) ? (
                            <Marker
                                key={`u-${sid(s.id)}`}
                                position={[s.lat, s.lng]}
                                icon={makePinIcon("#666")}
                                ref={(ref) => {
                                    const m = asLeafletMarker(ref);
                                    if (m) unroutedMarkerRefs.current.set(sid(s.id), m);
                                }}
                                eventHandlers={{
                                    popupopen: () => setSelectedHalo({ lat: s.lat, lng: s.lng, color: "#666" }),
                                }}
                            >
                                <Popup className="color-popup" closeButton={true}>
                                    <div style={{
                                        minWidth: 240, border: "3px solid #666", borderRadius: 10, padding: 6,
                                        boxShadow: "0 6px 24px rgba(0,0,0,0.15)"
                                    }}>
                                        <div style={{ fontWeight: 700 }}>{s.name || "Unnamed"}</div>
                                        <div>{s.address}{s.apt ? ` ${s.apt}` : ""}</div>
                                        <div>{s.city} {s.state} {s.zip}</div>
                                        {s.phone ? <div style={{ marginTop: 4 }}>{s.phone}</div> : null}
                                        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                                            <label style={{ fontSize: 12 }}>Assign to:</label>
                                            <select
                                                defaultValue=""
                                                onChange={async (e) => {
                                                    const val = Number(e.target.value);
                                                    if (Number.isFinite(val)) await onReassignLocal(s, val);
                                                }}
                                                style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #ccc" }}
                                            >
                                                <option value="" disabled>Select driver…</option>
                                                {localDrivers.map((opt) => (
                                                    <option key={opt.driverId} value={opt.driverId}>{opt.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </Popup>
                            </Marker>
                        ) : null
                    )}

                    {/* assigned markers */}
                    {localDrivers.map((d) =>
                        (d.stops || []).map((s) =>
                            Number.isFinite(s.lat) && Number.isFinite(s.lng) ? (
                                <Marker
                                    key={`d-${sid(d.driverId)}-s-${sid(s.id)}`}
                                    position={[s.lat, s.lng]}
                                    icon={makePinIcon(d.color)}
                                    ref={(ref) => {
                                        const m = asLeafletMarker(ref);
                                        if (m) assignedMarkerRefs.current.set(sid(s.id), m);
                                    }}
                                    eventHandlers={{
                                        popupopen: () => setSelectedHalo({ lat: s.lat, lng: s.lng, color: d.color || "#1f77b4" }),
                                    }}
                                >
                                    <Popup className="color-popup">
                                        <div style={{
                                            minWidth: 240, border: `3px solid ${d.color || "#1f77b4"}`, borderRadius: 10, padding: 6,
                                            boxShadow: "0 6px 24px rgba(0,0,0,0.15)"
                                        }}>
                                            <div style={{ fontWeight: 700 }}>{s.name || "Unnamed"}</div>
                                            <div>{s.address}{s.apt ? ` ${s.apt}` : ""}</div>
                                            <div>{s.city} {s.state} {s.zip}</div>
                                            {s.phone ? <div style={{ marginTop: 4 }}>{s.phone}</div> : null}
                                            <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                                                <label style={{ fontSize: 12 }}>Reassign to:</label>
                                                <select
                                                    defaultValue={d.driverId}
                                                    onChange={async (e) => { await onReassignLocal(s, Number(e.target.value)); }}
                                                    style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #ccc" }}
                                                >
                                                    {localDrivers.map((opt) => (
                                                        <option key={opt.driverId} value={opt.driverId}>{opt.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                    </Popup>
                                </Marker>
                            ) : null
                        )
                    )}
                </MapContainer>
            </div>

            {/* tiny hint */}
            {selectMode && (
                <div
                    style={{
                        position: "absolute",
                        right: 12,
                        top: 12,
                        background: "rgba(0,120,255,0.08)",
                        border: "1px dashed rgba(0,120,255,0.5)",
                        color: "#0366d6",
                        padding: "6px 10px",
                        borderRadius: 10,
                        fontSize: 12,
                        fontWeight: 600,
                    }}
                >
                    Shift+drag to select
                </div>
            )}
        </div>
    );
}