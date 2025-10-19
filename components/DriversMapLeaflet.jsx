"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
    MapContainer,
    TileLayer,
    Marker,
    ZoomControl,
    useMap,
    CircleMarker,
    Polyline,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* ==================== Config / constants ==================== */

// Selection colors
const SELECTION_PIN_COLOR  = "#ebf707";               // yellow
const SELECTION_RING_COLOR = "rgba(235,247,7,0.55)";  // halo/glow

// Icon geometry
const PIN_W = 28;
const PIN_H = 42;
const ANCHOR_X = 14;  // tip X
const ANCHOR_Y = 42;  // tip Y

// Selection hit tolerance (pixels)
const HIT_RADIUS_PX = 16;

/* ==================== Utils ==================== */
const sid = (v) => { try { return v == null ? "" : String(v); } catch { return ""; } };
const toNum = (v) => { const n = typeof v === "string" ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; };
const getLL = (s) => {
    const lat = toNum(s?.lat), lng = toNum(s?.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
};
const asLeafletMarker = (maybe) => {
    if (!maybe) return null;
    if (typeof maybe.getLatLng === "function") return maybe;
    if (maybe.leafletElement?.getLatLng) return maybe.leafletElement;
    if (maybe.marker?.getLatLng) return maybe.marker;
    return null;
};

/* ==================== Icons (anchor-fixed) ==================== */
const iconCache = new Map();
const iconKey = (color, selected) => `${color}|${selected ? "sel" : "norm"}`;

function makePinIcon(color = "#1f77b4", selected = false) {
    const k = iconKey(color, selected);
    const cached = iconCache.get(k);
    if (cached) return cached;

    const fill = selected ? SELECTION_PIN_COLOR : color;
    const stroke = selected ? "rgba(0,0,0,0.8)" : "rgba(0,0,0,0.4)";
    const ring = selected
        ? `<circle cx="${ANCHOR_X}" cy="${ANCHOR_Y - 29}" r="8" fill="none" stroke="${SELECTION_RING_COLOR}" stroke-width="3"></circle>`
        : "";

    const html = `
    <div style="position:relative; width:${PIN_W}px; height:${PIN_H}px;">
      <svg width="${PIN_W}" height="${PIN_H}" viewBox="0 0 ${PIN_W} ${PIN_H}" xmlns="http://www.w3.org/2000/svg" style="display:block">
        ${ring}
        <path d="M14 0C6.82 0 1 5.82 1 13c0 9.6 10.3 18.1 12.2 19.67a1 1 0 0 0 1.6 0C16.7 31.1 27 22.6 27 13 27 5.82 21.18 0 14 0z" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
        <circle cx="14" cy="13" r="4.5" fill="white"/>
      </svg>
      <div style="position:absolute; left:${ANCHOR_X - 8}px; bottom:0px; transform:translateY(4px); width:16px; height:6px; border-radius:50%; background:rgba(0,0,0,0.25); filter: blur(1px);"></div>
    </div>
  `;

    const icon = L.divIcon({
        html,
        className: "pin-icon",
        iconSize: [PIN_W, PIN_H],
        iconAnchor: [ANCHOR_X, ANCHOR_Y],
        popupAnchor: [0, -36],
    });
    iconCache.set(k, icon);
    return icon;
}

/* ==================== Data helpers ==================== */
function findStopByIdLocal(id, drivers, unrouted) {
    const key = sid(id);
    for (const d of drivers) for (const s of d.stops || []) {
        if (sid(s.id) === key) return { stop: s, color: d.color || "#1f77b4", fromDriverId: d.driverId };
    }
    for (const s of unrouted || []) if (sid(s.id) === key) return { stop: s, color: "#666", fromDriverId: null };
    return { stop: null, color: "#666", fromDriverId: null };
}

/* ==================== View persistence ==================== */
const VIEW_KEY = "driversMap:view";
function saveView(map) {
    try {
        const c = map.getCenter(), z = map.getZoom();
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

/* ==================== Map bridge (single-fire) ==================== */
function MapBridge({ onReady }) {
    const map = useMap();
    const onReadyRef = useRef(onReady);
    const calledRef = useRef(false);
    useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
    useEffect(() => {
        if (map && !calledRef.current) {
            calledRef.current = true;
            onReadyRef.current?.(map);
        }
    }, [map]);
    return null;
}

/* ==================== Programmatic popup ==================== */
function openAssignPopup({ map, stop, color, drivers, onAssign }) {
    if (!map || !stop) return;
    const ll = getLL(stop);
    if (!ll) return;

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
    const sel = container.querySelector("#__assignSel");
    const o0 = document.createElement("option");
    o0.value = ""; o0.textContent = "Select driver…"; o0.disabled = true; o0.selected = true;
    sel.appendChild(o0);
    for (const d of drivers) {
        const o = document.createElement("option");
        o.value = String(d.driverId); o.textContent = d.name;
        sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
        const to = Number(sel.value);
        if (Number.isFinite(to)) onAssign?.(stop, to);
    });

    L.popup({ closeOnClick: true, autoClose: true, className: "color-popup" })
        .setLatLng(ll)
        .setContent(container)
        .openOn(map);
}

/* ==================== Pretty checkbox row ==================== */
function CheckRow({ id, checked, onChange, label, title }) {
    const selected = !!checked;
    return (
        <label
            htmlFor={id}
            title={title}
            style={{
                display: "flex", alignItems: "center", gap: 10, fontSize: 13, userSelect: "none",
                cursor: "pointer", padding: "8px 10px", borderRadius: 10,
                border: selected ? "1px solid #99c2ff" : "1px solid #e5e7eb",
                background: selected ? "#eef5ff" : "#fff",
                color: selected ? "#0b66ff" : "#111827",
                transition: "background 120ms, color 120ms, border 120ms",
            }}
        >
            <input
                id={id}
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange?.(e.target.checked)}
                style={{ width: 18, height: 18, transform: "scale(1.25)", accentColor: "#0b66ff", cursor: "pointer" }}
            />
            <span style={{ lineHeight: 1 }}>{label}</span>
        </label>
    );
}

/* ==================== Component ==================== */
export default function DriversMapLeaflet({
                                              drivers = [],
                                              unrouted = [],
                                              onReassign,            // (stop, driverId)
                                              onExpose,              // optional
                                              initialCenter = [40.7128, -74.006],
                                              initialZoom = 10,
                                              showRouteLinesDefault = false,
                                          }) {
    const mapRef = useRef(null);
    const [mapReady, setMapReady] = useState(false);
    const [didFitOnce, setDidFitOnce] = useState(false);

    const onReassignRef = useRef(onReassign);
    useEffect(() => { onReassignRef.current = onReassign; }, [onReassign]);

    const [localDrivers, setLocalDrivers] = useState(drivers || []);
    const [localUnrouted, setLocalUnrouted] = useState(unrouted || []);
    const localDriversRef = useRef(localDrivers);
    const localUnroutedRef = useRef(localUnrouted);
    useEffect(() => { localDriversRef.current = localDrivers; }, [localDrivers]);
    useEffect(() => { localUnroutedRef.current = localUnrouted; }, [localUnrouted]);
    useEffect(() => { setLocalDrivers(Array.isArray(drivers) ? drivers : []); }, [drivers]);
    useEffect(() => { setLocalUnrouted(Array.isArray(unrouted) ? unrouted : []); }, [unrouted]);

    /* ------- toggles / selection / halo ------- */
    const [showRouteLines, setShowRouteLines] = useState(!!showRouteLinesDefault);
    const [selectMode, setSelectMode] = useState(false);
    const [clickPickMode, setClickPickMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [hoverIds, setHoverIds] = useState(() => new Set());
    const hoverIdsRef = useRef(new Set());
    const [bulkDriverId, setBulkDriverId] = useState("");
    const [bulkBusy, setBulkBusy] = useState(false);
    const selectedCount = selectedIds.size;

    const [selectedHalo, setSelectedHalo] = useState({ lat: null, lng: null, color: "#666" });
    const clearHalo = useCallback(() => setSelectedHalo({ lat: null, lng: null, color: "#666" }), []);

    /* ------- derived ------- */
    const hasLL = (s) => !!getLL(s);
    const allPoints = useMemo(() => {
        const pts = [];
        for (const d of localDrivers) for (const s of d.stops || []) { const ll = getLL(s); if (ll) pts.push(ll); }
        for (const s of localUnrouted) { const ll = getLL(s); if (ll) pts.push(ll); }
        return pts;
    }, [localDrivers, localUnrouted]);

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
            driverId: d.driverId, name: d.name, color: d.color, count: (d.stops || []).filter(hasLL).length,
        })),
        [localDrivers]
    );
    const totalAssigned = useMemo(() => indexItems.reduce((s, x) => s + x.count, 0), [indexItems]);

    const idBaseColor = useMemo(() => {
        const m = new Map();
        for (const d of localDrivers) for (const s of d.stops || []) m.set(sid(s.id), d.color || "#1f77b4");
        for (const s of localUnrouted) m.set(sid(s.id), "#666");
        return m;
    }, [localDrivers, localUnrouted]);

    /* ------- marker refs ------- */
    const assignedMarkerRefs = useRef(new Map());
    const unroutedMarkerRefs = useRef(new Map());
    useEffect(() => {
        assignedMarkerRefs.current = new Map();
        unroutedMarkerRefs.current = new Map();
    }, [localDrivers, unroutedFiltered]);

    /* ------- local data updates ------- */
    const moveStopsLocally = useCallback((stopIds, toDriverId) => {
        const toId = Number(toDriverId);
        const idKeys = new Set(stopIds.map(sid));
        const dSnap = localDriversRef.current;
        const uSnap = localUnroutedRef.current;

        // collect the real stop objects by id, update their owner tag (__driverId)
        const movingStops = [];
        for (const id of idKeys) {
            const { stop } = findStopByIdLocal(id, dSnap, uSnap);
            if (stop) {
                movingStops.push({ ...stop, __driverId: toId });
            }
        }

        // strip them from every driver and from unrouted
        const strippedDrivers = dSnap.map((d) => ({
            ...d,
            stops: (d.stops || []).filter((s) => !idKeys.has(sid(s.id))),
        }));
        const nextUnrouted = uSnap.filter((s) => !idKeys.has(sid(s.id)));

        // add to the target driver
        let injected = false;
        const nextDrivers = strippedDrivers.map((d) => {
            if (Number(d.driverId) === toId) {
                injected = true;
                const newStops = Array.isArray(d.stops) ? [...d.stops, ...movingStops] : [...movingStops];
                return { ...d, stops: newStops };
            }
            return d;
        });

        // if target driver not present yet (edge case), create it to avoid "all to one"
        const finalDrivers = injected
            ? nextDrivers
            : [...nextDrivers, { driverId: toId, name: `Driver ${toId}`, color: "#1f77b4", stops: movingStops, polygon: [] }];

        setLocalDrivers(finalDrivers);
        setLocalUnrouted(nextUnrouted);
        localDriversRef.current = finalDrivers;
        localUnroutedRef.current = nextUnrouted;
    }, []);
    /* ------- popup assign (single) ------- */
    const onReassignLocal = useCallback(
        async (stop, toDriverId) => {
            const id = stop?.id;
            if (id == null) return;
            await onReassignRef.current?.(stop, Number(toDriverId)); // persist
            moveStopsLocally([id], toDriverId);                      // reflect locally
        },
        [moveStopsLocally]
    );

    const openAssignForStop = useCallback((stop, baseColor) => {
        const map = mapRef.current;
        if (!map) return;
        openAssignPopup({
            map,
            stop,
            color: baseColor || "#1f77b4",
            drivers: localDriversRef.current,
            onAssign: onReassignLocal,
        });
        const ll = getLL(stop);
        if (ll) setSelectedHalo({ lat: ll[0], lng: ll[1], color: baseColor || "#1f77b4" });
    }, [onReassignLocal]);

    /* ------- search ------- */
    const [q, setQ] = useState("");
    const [results, setResults] = useState([]);
    useEffect(() => {
        const needle = q.trim().toLowerCase();
        if (!needle) { setResults([]); return; }
        const rows = [];
        for (const d of localDrivers) for (const s of d.stops || []) {
            const hay = [s.name, s.address, s.city, s.state, s.zip, s.phone].filter(Boolean).join(" ").toLowerCase();
            if (hay.includes(needle)) rows.push({ ...s, __driverId: d.driverId, __driverName: d.name, __unrouted: false, __color: d.color });
        }
        for (const s of unroutedFiltered) {
            const hay = [s.name, s.address, s.city, s.state, s.zip, s.phone].filter(Boolean).join(" ").toLowerCase();
            if (hay.includes(needle)) rows.push({ ...s, __driverId: null, __driverName: "Unrouted", __unrouted: true, __color: "#666" });
        }
        setResults(rows.slice(0, 50));
    }, [q, localDrivers, unroutedFiltered]);

    const focusResult = useCallback((row) => {
        if (!row) return;
        const map = mapRef.current;
        const ll = getLL(row);
        if (!map || !ll) return;
        map.setView(ll, Math.max(map.getZoom(), 14), { animate: true });

        const { stop, color } = findStopByIdLocal(row.id, localDriversRef.current, localUnroutedRef.current);
        openAssignForStop(stop || row, color || row.__color || "#1f77b4");
    }, [openAssignForStop]);

    /* ------- selection helpers ------- */
    const toggleId = useCallback((id, forceOn = null) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (forceOn === true) next.add(id);
            else if (forceOn === false) next.delete(id);
            else { next.has(id) ? next.delete(id) : next.add(id); }
            return next;
        });
    }, []);

    const handleMarkerClick = useCallback((id, stop, baseColor, e) => {
        const map = mapRef.current;
        const ev = e?.originalEvent;
        const modifier = ev?.altKey || ev?.metaKey || ev?.ctrlKey;
        const isToggle = clickPickMode || modifier;

        if (isToggle) {
            toggleId(id);
            map?.closePopup();
            ev?.preventDefault?.();
            ev?.stopPropagation?.();
            return;
        }
        map?.closePopup();
        openAssignForStop(stop, baseColor);
    }, [clickPickMode, openAssignForStop, toggleId]);

    /* ------- Map ready / view ------- */
    const handleMapReady = useCallback((m) => {
        mapRef.current = m;
        const saved = loadView();
        if (saved) m.setView([saved.lat, saved.lng], saved.zoom, { animate: false });
        else m.setView(initialCenter, initialZoom, { animate: false });

        const onMoveEnd = () => saveView(m);
        m.on("moveend", onMoveEnd);
        m.on("zoomend", onMoveEnd);

        m.on("click", clearHalo);
        m.on("popupclose", clearHalo);

        setMapReady(true);
    }, [initialCenter, initialZoom, clearHalo]);

    // Fit once (no saved view)
    useEffect(() => {
        if (!mapReady || didFitOnce) return;
        const saved = loadView();
        if (saved) { setDidFitOnce(true); return; }
        if (!allPoints.length) return;
        try {
            const b = L.latLngBounds(allPoints);
            mapRef.current.fitBounds(b, { padding: [50, 50] });
            setDidFitOnce(true);
        } catch {}
    }, [mapReady, didFitOnce, allPoints]);

    /* ======== Box select (accurate; container pixel space) ======== */
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const container = map.getContainer();
        if (!container) return;

        let startClient = null;
        let overlay = null;
        let locked = false;

        const lockMap = () => {
            if (locked) return;
            map.dragging.disable();
            map.touchZoom.disable();
            map.doubleClickZoom.disable();
            map.scrollWheelZoom.disable();
            map.boxZoom.disable();
            map.keyboard.disable();
            locked = true;
        };
        const unlockMap = () => {
            if (!locked) return;
            map.dragging.enable();
            map.touchZoom.enable();
            map.doubleClickZoom.enable();
            map.scrollWheelZoom.enable();
            map.boxZoom.enable();
            map.keyboard.enable();
            locked = false;
        };

        const toContainerXY = (clientX, clientY) => {
            const r = container.getBoundingClientRect();
            return { x: clientX - r.left, y: clientY - r.top };
        };

        const normalizeRect = (a, b) => ({
            x1: Math.min(a.x, b.x),
            y1: Math.min(a.y, b.y),
            x2: Math.max(a.x, b.x),
            y2: Math.max(a.y, b.y),
        });

        const pointInRect = (p, r, pad = 0) =>
            p.x >= r.x1 - pad && p.x <= r.x2 + pad &&
            p.y >= r.y1 - pad && p.y <= r.y2 + pad;

        function onMouseDown(e) {
            if (!selectMode || !e.shiftKey || e.button !== 0) return;
            if (e.target.closest(".leaflet-control")) return;

            startClient = { x: e.clientX, y: e.clientY };

            const cRect = container.getBoundingClientRect();
            overlay = document.createElement("div");
            overlay.style.position = "absolute";
            overlay.style.left = `${startClient.x - cRect.left}px`;
            overlay.style.top  = `${startClient.y - cRect.top}px`;
            overlay.style.width = "0px";
            overlay.style.height = "0px";
            overlay.style.border = "1.5px dashed rgba(0,120,255,0.9)";
            overlay.style.background = "rgba(0,120,255,0.12)";
            overlay.style.pointerEvents = "none";
            overlay.style.zIndex = 999;
            container.appendChild(overlay);

            lockMap();
            clearHalo();
            map.closePopup();
            e.preventDefault(); e.stopPropagation();
        }

        function onMouseMove(e) {
            if (!startClient || !overlay) return;

            const cRect = container.getBoundingClientRect();
            const nowClient = { x: e.clientX, y: e.clientY };
            const rrClient = {
                x1: Math.min(startClient.x, nowClient.x),
                y1: Math.min(startClient.y, nowClient.y),
                x2: Math.max(startClient.x, nowClient.x),
                y2: Math.max(startClient.y, nowClient.y),
            };
            overlay.style.left   = `${rrClient.x1 - cRect.left}px`;
            overlay.style.top    = `${rrClient.y1 - cRect.top}px`;
            overlay.style.width  = `${rrClient.x2 - rrClient.x1}px`;
            overlay.style.height = `${rrClient.y2 - rrClient.y1}px`;

            const a = toContainerXY(startClient.x, startClient.y);
            const b = toContainerXY(nowClient.x, nowClient.y);
            const rect = normalizeRect(a, b);

            const pad = HIT_RADIUS_PX;
            const picked = new Set();

            const visit = (refMap) => {
                refMap.forEach((m, id) => {
                    const ll = m?.getLatLng?.();
                    if (!ll) return;
                    const pt = map.latLngToContainerPoint(ll);
                    if (pointInRect(pt, rect, pad)) picked.add(id);
                });
            };

            visit(assignedMarkerRefs.current);
            visit(unroutedMarkerRefs.current);

            let changed = false;
            if (picked.size !== hoverIdsRef.current.size) changed = true;
            else { for (const id of picked) { if (!hoverIdsRef.current.has(id)) { changed = true; break; } } }
            if (changed) {
                hoverIdsRef.current = picked;
                setHoverIds(picked);
            }

            e.preventDefault(); e.stopPropagation();
        }

        function onMouseUp(e) {
            if (!startClient) return;

            setHoverIds((prevHover) => {
                setSelectedIds((prev) => {
                    const next = new Set(prev);
                    const subtract = e.altKey || e.metaKey || e.ctrlKey;
                    prevHover.forEach((id) => (subtract ? next.delete(id) : next.add(id)));
                    return next;
                });
                return new Set();
            });
            hoverIdsRef.current = new Set();

            if (overlay?.parentNode) overlay.parentNode.removeChild(overlay);
            overlay = null; startClient = null;
            unlockMap();
            e.preventDefault(); e.stopPropagation();
        }

        container.addEventListener("mousedown", onMouseDown, true);
        window.addEventListener("mousemove", onMouseMove, true);
        window.addEventListener("mouseup", onMouseUp, true);
        return () => {
            container.removeEventListener("mousedown", onMouseDown, true);
            window.removeEventListener("mousemove", onMouseMove, true);
            window.removeEventListener("mouseup", onMouseUp, true);
            unlockMap();
        };
    }, [selectMode, clearHalo]);

    /* ======== Live coloring ======== */
    const prevLiveSetRef = useRef(new Set());
    const setIconForId = useCallback((id, on) => {
        const m = assignedMarkerRefs.current.get(id) || unroutedMarkerRefs.current.get(id);
        if (!m) return;
        const base = idBaseColor.get(id) || "#666";
        m.setIcon(makePinIcon(base, !!on));
    }, [idBaseColor]);

    useEffect(() => {
        const live = new Set([...selectedIds, ...hoverIds]);
        const prev = prevLiveSetRef.current;
        live.forEach((id) => { if (!prev.has(id)) setIconForId(id, true); });
        prev.forEach((id) => { if (!live.has(id)) setIconForId(id, false); });
        prevLiveSetRef.current = live;
    }, [selectedIds, hoverIds, setIconForId]);

    /* ======== TRUE SEQUENTIAL BULK ASSIGN ======== */
    const applyBulkAssign = useCallback(async (toDriverId) => {
        const to = Number(toDriverId);
        const ids = Array.from(selectedIds);
        if (!Number.isFinite(to) || ids.length === 0 || bulkBusy) return;

        setBulkBusy(true);
        try {
            for (const id of ids) {
                const { stop } = findStopByIdLocal(id, localDriversRef.current, localUnroutedRef.current);
                if (!stop) continue;
                await onReassignRef.current?.(stop, to);  // persist (server)
                moveStopsLocally([id], to);               // update local UI
            }
        } catch (err) {
            console.error("[BulkAssign(sequential)] failed:", err);
        } finally {
            // Clear selection & highlights
            prevLiveSetRef.current.forEach((id) => setIconForId(id, false));
            prevLiveSetRef.current = new Set();
            setSelectedIds(new Set());
            setHoverIds(new Set());
            hoverIdsRef.current = new Set();
            setBulkDriverId("");
            clearHalo();
            setBulkBusy(false);
        }
    }, [selectedIds, bulkBusy, moveStopsLocally, clearHalo, setIconForId]);

    const clearSelection = useCallback(() => {
        prevLiveSetRef.current.forEach((id) => setIconForId(id, false));
        prevLiveSetRef.current = new Set();
        setSelectedIds(new Set());
        setHoverIds(new Set());
        hoverIdsRef.current = new Set();
        setBulkDriverId("");
        clearHalo();
    }, [setIconForId, clearHalo]);

    /* ======== Expose API (optional) ======== */
    useEffect(() => {
        if (!onExpose) return;
        const api = {
            applyBulkAssign,
            clearSelection,
            getSelectedCount: () => selectedIds.size,
        };
        onExpose(api);
        // run once
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ======== UI overlays ======== */

    // Left: Search
    const searchOverlay = (
        <div
            style={{ position: "absolute", zIndex: 1000, left: 10, top: 10, width: 360, pointerEvents: "auto" }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
        >
            <div style={{ background: "rgba(255,255,255,0.97)", border: "1px solid #ddd", borderRadius: 12, padding: 10, boxShadow: "0 2px 10px rgba(0,0,0,0.12)" }}>
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search name, address, phone… (Enter opens first)"
                    onKeyDown={(e) => { if (e.key === "Enter" && results.length) focusResult(results[0]); }}
                    style={{ width: "100%", height: 36, borderRadius: 8, border: "1px solid #ccc", padding: "0 10px", outline: "none" }}
                />
                {q.trim() && (
                    <div style={{ marginTop: 8, borderTop: "1px solid #eee", maxHeight: 260, overflowY: "auto", borderRadius: 8 }}>
                        {results.length === 0 ? (
                            <div style={{ padding: "8px 6px", fontSize: 12, opacity: 0.7 }}>No matches</div>
                        ) : (
                            results.map((r) => {
                                const id = sid(r.id);
                                const ll = getLL(r);
                                const sub = `${r.address || ""}${r.apt ? " " + r.apt : ""}`.trim()
                                    || [r.city, r.state, r.zip].filter(Boolean).join(" ");
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => focusResult(r)}
                                        style={{ width: "100%", textAlign: "left", padding: "8px 10px", background: "#fff", border: "1px solid #eee", borderRadius: 8, marginBottom: 6, cursor: ll ? "pointer" : "not-allowed", opacity: ll ? 1 : 0.6 }}
                                        title={r.__driverId ? `Driver: ${r.__driverName}` : "Unrouted"}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            <span style={{ width: 12, height: 12, borderRadius: 3, background: r.__color || "#999", border: "1px solid rgba(0,0,0,0.2)" }} />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name || "(Unnamed)"}</div>
                                                <div style={{ fontSize: 12, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
                                            </div>
                                            {r.__driverId != null && <div style={{ fontSize: 11, opacity: 0.8 }}>{r.__driverName}</div>}
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>
                )}
            </div>
        </div>
    );

    // Right: Tools + legend + bulk assign
    const rightPanel = (
        <div
            style={{
                position: "absolute",
                zIndex: 1000,
                top: 12,
                right: 12,
                width: 320,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                pointerEvents: "auto",
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Selection / Bulk bar */}
            {(selectedCount > 0 || hoverIds.size > 0) && (
                <div
                    style={{
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
                        {selectedCount} selected{hoverIds.size ? ` (+${hoverIds.size} preview)` : ""}
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
                            onClick={() => applyBulkAssign(bulkDriverId)}
                            disabled={!bulkDriverId || bulkBusy || selectedCount === 0}
                            style={{
                                padding: "8px 10px",
                                borderRadius: 10,
                                border: "1px solid #2a7",
                                background: !bulkDriverId || bulkBusy || selectedCount === 0 ? "#f6f6f6" : "#eaffea",
                                cursor: !bulkDriverId || bulkBusy || selectedCount === 0 ? "not-allowed" : "pointer",
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
                    <div style={{ fontSize: 11, opacity: 0.8, lineHeight: 1.3 }}>
                        Box: hold <b>Shift</b> and drag (add). Hold <b>Alt/Option/Ctrl/Cmd</b> when releasing to subtract.
                        <br />
                        Click: enable <b>Click to select</b>, or hold <b>Alt/Option/Ctrl/Cmd</b> while clicking a dot.
                    </div>
                </div>
            )}

            {/* Toggles + index */}
            <div
                style={{
                    background: "rgba(255,255,255,0.97)",
                    border: "1px solid #ddd",
                    borderRadius: 12,
                    padding: 10,
                    boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
                    overflow: "auto",
                    maxHeight: "55vh",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                }}
            >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    Drivers ({totalAssigned} visible)
                </div>

                <CheckRow
                    id="toggle-routes"
                    checked={showRouteLines}
                    onChange={setShowRouteLines}
                    label="Show route lines"
                    title="Draw a line connecting stops in order for each driver"
                />
                <CheckRow
                    id="toggle-area"
                    checked={selectMode}
                    onChange={setSelectMode}
                    label="Area select (Shift+drag)"
                    title="Shift-drag to select, Alt/Option/Ctrl/Cmd to subtract"
                />
                <CheckRow
                    id="toggle-click"
                    checked={clickPickMode}
                    onChange={setClickPickMode}
                    label="Click to select (one-by-one)"
                    title="When ON, clicking a dot toggles selection (no popup)"
                />

                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                    Unrouted (visible): {unroutedFiltered.filter(hasLL).length}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {indexItems.map((it) => (
                        <div key={it.driverId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                            <span style={{ width: 16, height: 16, borderRadius: 4, background: it.color, border: "1px solid rgba(0,0,0,0.15)" }} />
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
        </div>
    );

    /* ------- Render ------- */
    return (
        <div style={{ height: "100%", width: "100%", position: "relative" }}>
            {searchOverlay}
            {rightPanel}

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

                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
                    <ZoomControl position="bottomleft" />

                    {/* halo */}
                    {Number.isFinite(selectedHalo.lat) && Number.isFinite(selectedHalo.lng) && (
                        <CircleMarker
                            center={[selectedHalo.lat, selectedHalo.lng]}
                            pathOptions={{ color: selectedHalo.color, fillColor: selectedHalo.color, fillOpacity: 0.18 }}
                            radius={18}
                            weight={3}
                            interactive={false}
                        />
                    )}

                    {/* route lines */}
                    {showRouteLines &&
                        localDrivers.map((d) => {
                            const pts = (d.stops || []).map(getLL).filter(Boolean);
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

                    {/* UNROUTED markers */}
                    {unroutedFiltered.map((s) => {
                        const ll = getLL(s); if (!ll) return null;
                        const id = sid(s.id);
                        return (
                            <Marker
                                key={`u-${id}`}
                                position={ll}
                                icon={makePinIcon("#666", selectedIds.has(id) || hoverIds.has(id))}
                                ref={(ref) => {
                                    const m = asLeafletMarker(ref);
                                    if (m) unroutedMarkerRefs.current.set(id, m);
                                }}
                                eventHandlers={{
                                    click: (e) => handleMarkerClick(id, s, "#666", e),
                                }}
                            />
                        );
                    })}

                    {/* ASSIGNED markers */}
                    {localDrivers.map((d) =>
                        (d.stops || []).map((s) => {
                            const ll = getLL(s); if (!ll) return null;
                            const id = sid(s.id);
                            const base = d.color || "#1f77b4";
                            return (
                                <Marker
                                    key={`d-${sid(d.driverId)}-s-${id}`}
                                    position={ll}
                                    icon={makePinIcon(base, selectedIds.has(id) || hoverIds.has(id))}
                                    ref={(ref) => {
                                        const m = asLeafletMarker(ref);
                                        if (m) assignedMarkerRefs.current.set(id, m);
                                    }}
                                    eventHandlers={{
                                        click: (e) => handleMarkerClick(id, s, base, e),
                                    }}
                                />
                            );
                        })
                    )}
                </MapContainer>
            </div>
        </div>
    );
}