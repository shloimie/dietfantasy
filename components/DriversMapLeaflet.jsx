// components/DriversMapLeaflet.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
    MapContainer,
    TileLayer,
    Marker,
    Popup,
    ZoomControl,
    useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* ---------------- helpers ---------------- */

function FitBounds({ bounds }) {
    const map = useMap();
    useEffect(() => {
        if (bounds) map.fitBounds(bounds, { padding: [40, 40] });
    }, [bounds, map]);
    return null;
}

/** stringify id safely (works for number/string/bigint) */
function sid(v) {
    if (v === null || v === undefined) return "";
    try { return String(v); } catch { return ""; }
}

/** Make a colored pin-shaped DivIcon (google-like marker) */
function makePinIcon(color = "#1f77b4", selected = false) {
    const stroke = selected ? "#000000" : "rgba(0,0,0,0.4)";
    const html = `
    <div style="position:relative; width:28px; height:42px; transform: translate(-50%, -100%);">
      <svg width="28" height="42" viewBox="0 0 28 42" xmlns="http://www.w3.org/2000/svg" style="display:block">
        <path d="M14 0C6.82 0 1 5.82 1 13c0 9.6 10.3 18.1 12.2 19.67a1 1 0 0 0 1.6 0C16.7 31.1 27 22.6 27 13 27 5.82 21.18 0 14 0z" fill="${color}" stroke="${stroke}" stroke-width="1.5"/>
        <circle cx="14" cy="13" r="4.5" fill="white"/>
      </svg>
      <div style="position:absolute; left:50%; bottom:-4px; transform:translateX(-50%); width:16px; height:6px; border-radius:50%; background:rgba(0,0,0,0.25); filter: blur(1px);"></div>
    </div>
  `;
    return L.divIcon({
        html,
        className: "pin-icon",
        iconSize: [28, 42],
        iconAnchor: [14, 40], // tip
        popupAnchor: [0, -36],
    });
}

/* ---------------- component ---------------- */

export default function DriversMapLeaflet({
                                              drivers = [],              // [{ driverId, name, color, stops: Stop[] }]
                                              unrouted = [],             // Stop[]
                                              onReassign,                // (stop, toDriverId) => void|Promise<void>
                                              onClose,                   // () => void
                                              initialCenter = [40.7128, -74.006],
                                              initialZoom = 10,
                                          }) {
    const mapRef = useRef(null);

    // Build bounds & an index of assigned IDs for client-side de-dupe
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
        return {
            assignedIdSet: set,
            bounds: pts.length ? L.latLngBounds(pts) : null,
        };
    }, [drivers, unrouted]);

    // Ensure unrouted is de-duped (never show if already assigned)
    const unroutedFiltered = useMemo(
        () => (unrouted || []).filter((s) => !assignedIdSet.has(sid(s.id))),
        [unrouted, assignedIdSet]
    );

    // Left legend counts
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

    // --- Marker refs to open popups by ID (for search → click) ---
    const assignedMarkerRefs = useRef(new Map()); // key: sid(stop.id) -> Leaflet Marker
    const unroutedMarkerRefs = useRef(new Map());

    useEffect(() => {
        assignedMarkerRefs.current = new Map();
        unroutedMarkerRefs.current = new Map();
    }, [drivers, unroutedFiltered]);

    // Search state
    const [q, setQ] = useState("");
    const [results, setResults] = useState([]);
    useEffect(() => {
        const needle = q.trim().toLowerCase();
        if (!needle) {
            setResults([]);
            return;
        }
        const rows = [];
        for (const d of drivers) {
            for (const s of d.stops || []) {
                const hay = [
                    s.name, s.address, s.city, s.state, s.zip, s.phone,
                ].filter(Boolean).join(" ").toLowerCase();
                if (hay.includes(needle)) {
                    rows.push({ ...s, __driverId: d.driverId, __driverName: d.name, __driverColor: d.color, __unrouted: false });
                }
            }
        }
        for (const s of unroutedFiltered) {
            const hay = [s.name, s.address, s.city, s.state, s.zip, s.phone]
                .filter(Boolean).join(" ").toLowerCase();
            if (hay.includes(needle)) {
                rows.push({ ...s, __driverId: null, __driverName: "Unrouted", __driverColor: "#666", __unrouted: true });
            }
        }
        setResults(rows.slice(0, 30));
    }, [q, drivers, unroutedFiltered]);

    // —— Reliable open by selectedId with retry (handles ref timing) ——
    const [selectedId, setSelectedId] = useState(""); // string id
    useEffect(() => {
        if (!selectedId) return;
        const map = mapRef.current;
        if (!map) return;

        let attempts = 0;
        const tryOpen = () => {
            attempts++;
            const marker =
                assignedMarkerRefs.current.get(selectedId) ||
                unroutedMarkerRefs.current.get(selectedId);

            if (marker && typeof marker.getLatLng === "function") {
                const ll = marker.getLatLng();
                if (ll) {
                    map.setView(ll, Math.max(map.getZoom(), 15), { animate: true });
                    try { marker.setZIndexOffset?.(1000); } catch {}
                    setTimeout(() => {
                        if (typeof marker.openPopup === "function") marker.openPopup();
                        else marker.fire?.("click");
                    }, 60);
                    return; // success
                }
            }

            if (attempts < 14) setTimeout(tryOpen, 80);
            else {
                // Last resort: pan by coordinates if we can find the stop object
                const all = [
                    ...drivers.flatMap((d) => d.stops || []),
                    ...unroutedFiltered,
                ];
                const s = all.find((x) => sid(x.id) === selectedId);
                if (s && Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
                    map.setView([s.lat, s.lng], Math.max(map.getZoom(), 15), { animate: true });
                }
            }
        };

        tryOpen();
    }, [selectedId, drivers, unroutedFiltered]);

    // Click handlers (use onMouseDown to beat map’s click capture; make rows <button>)
    const openFromResult = useCallback((stop) => {
        const k = sid(stop?.id);
        if (!k) return;
        setSelectedId(k);
    }, []);

    const onSearchKeyDown = useCallback((e) => {
        if (e.key === "Enter" && results.length > 0) {
            e.preventDefault();
            const k = sid(results[0].id);
            if (k) setSelectedId(k);
        }
    }, [results]);

    return (
        <div style={{ height: "100%", width: "100%", position: "relative" }}>
            {/* LEFT COLUMN: close, index, search */}
            <div
                style={{
                    position: "absolute",
                    zIndex: 1000,
                    left: 10,
                    top: 10,
                    bottom: 10,
                    width: 280,
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
                        aria-label="Close"
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

                {/* Legend (no unrouted line per your request) */}
                <div
                    style={{
                        pointerEvents: "auto",
                        background: "rgba(255,255,255,0.97)",
                        border: "1px solid #ddd",
                        borderRadius: 12,
                        padding: 10,
                        boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
                        overflow: "auto",
                        maxHeight: "45%",
                    }}
                >
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>
                        Drivers ({totalAssigned} assigned)
                    </div>
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
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        openFromResult(r);
                                    }}
                                    onClick={(e) => {
                                        // fallback if onMouseDown got blocked by browser
                                        e.preventDefault();
                                        e.stopPropagation();
                                        openFromResult(r);
                                    }}
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

            {/* MAP */}
            <div style={{ height: "100%", width: "100%", borderRadius: 12, overflow: "hidden" }}>
                <MapContainer
                    center={initialCenter}
                    zoom={initialZoom}
                    style={{ height: "100%", width: "100%" }}
                    scrollWheelZoom
                    zoomControl={false}
                    whenCreated={(map) => { mapRef.current = map; }}
                >
                    <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution="&copy; OpenStreetMap contributors"
                    />
                    <ZoomControl position="bottomleft" />
                    {bounds ? <FitBounds bounds={bounds} /> : null}

                    {/* UNROUTED FIRST (below) */}
                    {unroutedFiltered.map((s) =>
                        Number.isFinite(s.lat) && Number.isFinite(s.lng) ? (
                            <Marker
                                key={`u-${sid(s.id)}`}
                                position={[s.lat, s.lng]}
                                icon={makePinIcon("#666")}
                                ref={(ref) => { if (ref) unroutedMarkerRefs.current.set(sid(s.id), ref); }}
                                eventHandlers={{
                                    popupclose: () => {
                                        const m = unroutedMarkerRefs.current.get(sid(s.id));
                                        try { m?.setZIndexOffset?.(0); } catch {}
                                    },
                                }}
                            >
                                <Popup>
                                    <div style={{ minWidth: 240 }}>
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

                    {/* ASSIGNED ON TOP (colored pins) */}
                    {drivers.map((d) =>
                        (d.stops || []).map((s) =>
                            Number.isFinite(s.lat) && Number.isFinite(s.lng) ? (
                                <Marker
                                    key={`d-${sid(d.driverId)}-s-${sid(s.id)}`}
                                    position={[s.lat, s.lng]}
                                    icon={makePinIcon(d.color)}
                                    ref={(ref) => { if (ref) assignedMarkerRefs.current.set(sid(s.id), ref); }}
                                    eventHandlers={{
                                        popupclose: () => {
                                            const m = assignedMarkerRefs.current.get(sid(s.id));
                                            try { m?.setZIndexOffset?.(0); } catch {}
                                        },
                                    }}
                                >
                                    <Popup>
                                        <div style={{ minWidth: 240 }}>
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