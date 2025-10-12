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
    Polyline,            // ⬅️ added
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* ==================== Debug ==================== */
const DEBUG = false;
const dlog = (...args) => { if (DEBUG) console.log("[DriversMap]", ...args); };

/* ==================== Helpers (no hooks here) ==================== */

function FitBounds({ bounds }) {
    const map = useMap();
    useEffect(() => {
        if (bounds) map.fitBounds(bounds, { padding: [40, 40] });
    }, [bounds, map]);
    return null;
}

function MapBridge({ onMap }) {
    const map = useMap();
    useEffect(() => { if (map) onMap(map); }, [map, onMap]);
    return null;
}

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

function findStopById(id, drivers, unrouted) {
    const key = sid(id);
    for (const d of drivers) {
        for (const s of d.stops || []) {
            if (sid(s.id) === key) return { stop: s, color: d.color || "#1f77b4" };
        }
    }
    for (const s of unrouted || []) {
        if (sid(s.id) === key) return { stop: s, color: "#666" };
    }
    return { stop: null, color: "#666" };
}

function openTempPopup({ map, stop, color, drivers, onReassign }) {
    if (!map || !stop || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return;

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
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Select driver…";
    opt0.disabled = true;
    opt0.selected = true;
    sel.appendChild(opt0);
    for (const d of drivers) {
        const o = document.createElement("option");
        o.value = String(d.driverId);
        o.textContent = d.name;
        sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
        const to = Number(sel.value);
        if (Number.isFinite(to)) onReassign?.(stop, to);
    });

    L.popup({ closeOnClick: true, autoClose: true, className: "color-popup" })
        .setLatLng([stop.lat, stop.lng])
        .setContent(container)
        .openOn(map);
}

/* ==================== Component ==================== */

export default function DriversMapLeaflet({
                                              drivers = [],
                                              unrouted = [],
                                              onReassign,
                                              onClose,
                                              initialCenter = [40.7128, -74.006],
                                              initialZoom = 10,
                                          }) {
    const mapRef = useRef(null);
    const [mapReady, setMapReady] = useState(false);
    const pendingOpenIdRef = useRef(null);

    // ⬅️ NEW: toggle for drawing route polylines
    const [showRouteLines, setShowRouteLines] = useState(false);

    const { bounds, assignedIdSet } = useMemo(() => {
        const pts = [];
        const set = new Set();
        for (const d of drivers) {
            for (const s of d.stops || []) {
                set.add(sid(s.id));
                if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) pts.push([s.lat, s.lng]);
            }
        }
        for (const s of unrouted || []) {
            if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) pts.push([s.lat, s.lng]);
        }
        return { assignedIdSet: set, bounds: pts.length ? L.latLngBounds(pts) : null };
    }, [drivers, unrouted]);

    const unroutedFiltered = useMemo(
        () => (unrouted || []).filter((s) => !assignedIdSet.has(sid(s.id))),
        [unrouted, assignedIdSet]
    );

    const indexItems = useMemo(
        () => drivers.map((d) => ({
            driverId: d.driverId,
            name: d.name,
            color: d.color,
            count: (d.stops || []).length,
        })),
        [drivers]
    );
    const totalAssigned = useMemo(
        () => indexItems.reduce((s, x) => s + x.count, 0),
        [indexItems]
    );

    const assignedMarkerRefs = useRef(new Map());
    const unroutedMarkerRefs = useRef(new Map());
    useEffect(() => {
        assignedMarkerRefs.current = new Map();
        unroutedMarkerRefs.current = new Map();
    }, [drivers, unroutedFiltered]);

    // Search
    const [q, setQ] = useState("");
    const [results, setResults] = useState([]);
    useEffect(() => {
        const needle = q.trim().toLowerCase();
        if (!needle) { setResults([]); return; }
        const rows = [];
        for (const d of drivers) {
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
    }, [q, drivers, unroutedFiltered]);

    // current selection (for halo + opening)
    const [selectedId, setSelectedId] = useState("");
    const [selectedHalo, setSelectedHalo] = useState({ lat: null, lng: null, color: "#666" });

    const openById = useCallback((id) => {
        const key = sid(id);
        const map = mapRef.current;
        if (!key) return false;

        if (!map) {
            pendingOpenIdRef.current = key;
            dlog("openById queued (map not ready)", { key });
            return false;
        }

        const fromAssigned = assignedMarkerRefs.current.get(key);
        const fromUnrouted = unroutedMarkerRefs.current.get(key);
        const marker = fromAssigned || fromUnrouted;

        if (marker?.getLatLng) {
            const ll = marker.getLatLng();
            map.setView(ll, Math.max(map.getZoom(), 15), { animate: true });
            setSelectedHalo({ lat: ll.lat, lng: ll.lng, color: fromAssigned ? "#1f77b4" : "#666" }); // color refined below
            setTimeout(() => { try { marker.openPopup?.(); } catch {} }, 60);
            return true;
        }

        const { stop, color } = findStopById(key, drivers, unroutedFiltered);
        if (stop && Number.isFinite(stop.lat) && Number.isFinite(stop.lng)) {
            map.setView([stop.lat, stop.lng], Math.max(map.getZoom(), 15), { animate: true });
            setSelectedHalo({ lat: stop.lat, lng: stop.lng, color });
            openTempPopup({ map, stop, color, drivers, onReassign });
            return true;
        }
        return false;
    }, [drivers, unroutedFiltered, onReassign]);

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

    // unrouted jump
    const [unroutedCursor, setUnroutedCursor] = useState(0);
    useEffect(() => {
        setUnroutedCursor((c) => Math.min(c, Math.max(0, unroutedFiltered.length - 1)));
    }, [unroutedFiltered]);

    const jumpToNextUnrouted = useCallback(() => {
        if (!unroutedFiltered.length) return;
        const idx = Math.max(0, Math.min(unroutedCursor, unroutedFiltered.length - 1));
        const tgt = unroutedFiltered[idx];
        const k = sid(tgt?.id);
        if (k) { openById(k); setSelectedId(k); }
        setUnroutedCursor(idx + 1 < unroutedFiltered.length ? idx + 1 : 0);
    }, [unroutedFiltered, unroutedCursor, openById]);

    /* ---------- UI overlay (index + search) ON TOP OF MAP ---------- */
    const overlay = (
        <div
            style={{
                position: "absolute",
                zIndex: 1000,
                left: 10,
                top: 10,
                width: 300,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                pointerEvents: "none",
            }}
        >
            {/* Close */}
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

            {/* Legend with Unrouted */}
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

                {/* ⬅️ NEW: toggle to show route polylines */}
                <label
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        marginBottom: 10,
                        userSelect: "none",
                    }}
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

                <button
                    type="button"
                    onClick={jumpToNextUnrouted}
                    style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        padding: "6px 8px",
                        borderRadius: 8,
                        border: "1px solid #eee",
                        background: "#fff",
                        cursor: unroutedFiltered.length ? "pointer" : "not-allowed",
                        marginBottom: 8,
                    }}
                    title={unroutedFiltered.length ? "Click to jump to next unrouted" : "No unrouted"}
                    disabled={!unroutedFiltered.length}
                >
          <span
              style={{
                  width: 16, height: 16, borderRadius: 4,
                  background: "#666", border: "1px solid rgba(0,0,0,0.15)",
                  flex: "0 0 auto",
              }}
          />
                    <div style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        Unrouted
                    </div>
                    <div style={{ fontVariantNumeric: "tabular-nums", opacity: 0.85, paddingLeft: 6 }}>
                        {unroutedFiltered.length}
                    </div>
                </button>

                {/* Drivers */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {indexItems.map((it) => (
                        <div
                            key={it.driverId}
                            style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}
                        >
              <span
                  style={{
                      width: 16, height: 16, borderRadius: 4,
                      background: it.color, border: "1px solid rgba(0,0,0,0.15)",
                      flex: "0 0 auto",
                  }}
              />
                            <div
                                title={it.name}
                                style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                            >
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
                    style={{
                        width: "100%",
                        height: 36,
                        borderRadius: 8,
                        border: "1px solid #ccc",
                        padding: "0 10px",
                        outline: "none",
                    }}
                />
                {results.length > 0 && (
                    <div
                        style={{
                            marginTop: 8,
                            maxHeight: 240,
                            overflow: "auto",
                            borderTop: "1px solid #eee",
                            paddingTop: 6,
                        }}
                    >
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

    /* ---------- Render ---------- */
    return (
        <div style={{ height: "100%", width: "100%", position: "relative" }}>
            {/* Overlay back on the map */}
            {overlay}

            {/* MAP */}
            <div style={{ height: "100%", width: "100%", borderRadius: 12, overflow: "hidden" }}>
                <MapContainer
                    center={initialCenter}
                    zoom={initialZoom}
                    style={{ height: "100%", width: "100%" }}
                    scrollWheelZoom
                    zoomControl={false}
                >
                    <MapBridge
                        onMap={(m) => {
                            mapRef.current = m;
                            setMapReady(true);
                            if (pendingOpenIdRef.current) {
                                const k = pendingOpenIdRef.current;
                                pendingOpenIdRef.current = null;
                                setTimeout(() => openById(k), 0);
                            }
                        }}
                    />

                    <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution="&copy; OpenStreetMap contributors"
                    />
                    <ZoomControl position="bottomleft" />
                    {bounds ? <FitBounds bounds={bounds} /> : null}

                    {/* HALO around selected marker (non-interactive) */}
                    {Number.isFinite(selectedHalo.lat) && Number.isFinite(selectedHalo.lng) && (
                        <CircleMarker
                            center={[selectedHalo.lat, selectedHalo.lng]}
                            pathOptions={{ color: selectedHalo.color, fillColor: selectedHalo.color, fillOpacity: 0.18 }}
                            radius={18}
                            weight={3}
                            interactive={false}
                        />
                    )}

                    {/* ⬅️ NEW: draw route lines per driver, in stop order */}
                    {showRouteLines &&
                        drivers.map((d) => {
                            const pts = (d.stops || [])
                                .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
                                .map((s) => [s.lat, s.lng]);
                            if (pts.length < 2) return null;
                            return (
                                <Polyline
                                    key={`route-${String(d.driverId)}`}
                                    positions={pts}
                                    pathOptions={{
                                        color: d.color || "#1f77b4",
                                        weight: 4,
                                        opacity: 0.8,
                                    }}
                                />
                            );
                        })
                    }

                    {/* UNROUTED markers */}
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
                                    popupopen: (e) => setSelectedHalo({ lat: s.lat, lng: s.lng, color: "#666" }),
                                }}
                            >
                                <Popup className="color-popup" closeButton={true}>
                                    <div style={{
                                        minWidth: 240,
                                        border: "3px solid #666",
                                        borderRadius: 10,
                                        padding: 6,
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
                                                onChange={(e) => {
                                                    const val = Number(e.target.value);
                                                    if (Number.isFinite(val)) onReassign?.(s, val);
                                                }}
                                                style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #ccc" }}
                                            >
                                                <option value="" disabled>Select driver…</option>
                                                {drivers.map((opt) => (
                                                    <option key={opt.driverId} value={opt.driverId}>{opt.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </Popup>
                            </Marker>
                        ) : null
                    )}

                    {/* ASSIGNED markers */}
                    {drivers.map((d) =>
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
                                            minWidth: 240,
                                            border: `3px solid ${d.color || "#1f77b4"}`,
                                            borderRadius: 10,
                                            padding: 6,
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
                                                    onChange={(e) => onReassign?.(s, Number(e.target.value))}
                                                    style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #ccc" }}
                                                >
                                                    {drivers.map((opt) => (
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
        </div>
    );
}