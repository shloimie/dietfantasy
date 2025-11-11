"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Map, Marker, Overlay } from "pigeon-maps";

const FALLBACK_COLORS = [
    "#1f77b4", // deep blue
    "#ff7f0e", // orange
    "#2ca02c", // green
    "#d62728", // red
    "#9467bd", // purple
    "#8c564b", // brown
    "#e377c2", // pink
    "#17becf", // cyan
    "#bcbd22", // olive
    "#393b79", // indigo blue
    "#ad494a", // muted brick red
    "#637939", // olive green
    "#ce6dbd", // lavender-magenta
    "#8c6d31", // dark mustard
    "#7f7f7f", // mid gray-brown (neutral contrast)
];

function normPoint(p, defaultCoords = null) {
    if (!p) return null;
    const lat = Number(p.lat ?? p.latitude);
    const lng = Number(p.lng ?? p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        if (defaultCoords) {
            return { ...p, lat: defaultCoords.lat, lng: defaultCoords.lng, isDefault: true };
        }
        return null;
    }
    return { ...p, lat, lng, isDefault: false };
}

function displayName(p = {}) {
    const byName = p.name ?? p.fullName ?? `${p.first ?? ""} ${p.last ?? ""}`.trim();
    if (byName) return byName;
    const addr = `${p.address ?? ""}${p.apt ? " " + p.apt : ""}`.trim();
    return addr || "Unnamed";
}

/**
 * Props:
 *  - routes: Array<Array<Stop>> OR Array<{ stops: Stop[], color?: string, driverName?: string }>
 *  - unrouted: Stop[]
 *  - onClose?: () => void
 *  - driverColors?: string[]
 *  - optimizeDay?: string ("monday"..."sunday" or "all")
 *  - onAfterOptimize?: () => void
 */
export default function DriversMap({
                                       routes = [],
                                       unrouted = [],
                                       onClose,
                                       driverColors,
                                       optimizeDay = "all",
                                       onAfterOptimize,
                                   }) {
    const center = useMemo(() => {
        const validPoints = (routes || [])
            .flatMap((r) => (Array.isArray(r) ? r : r?.stops || []))
            .map((p) => normPoint(p))
            .filter(Boolean);

        if (!validPoints.length) return [40.7128, -74.006]; // NYC fallback

        const lat = validPoints.reduce((s, p) => s + p.lat, 0) / validPoints.length;
        const lng = validPoints.reduce((s, p) => s + p.lng, 0) / validPoints.length;
        return [lat, lng];
    }, [routes]);

    const defaultCoords = useMemo(() => ({ lat: center[0], lng: center[1] }), [center]);

    const normalizedRoutes = useMemo(() => {
        return (routes || []).map((r, i) => {
            const stops = Array.isArray(r) ? r : (r?.stops || []);
            const colorFromRoute =
                (!Array.isArray(r) && (r?.color || r?.driverColor)) || driverColors?.[i];
            const color = colorFromRoute || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
            const name = (!Array.isArray(r) && (r?.driverName || r?.name)) || `Driver ${i + 1}`;
            return {
                color,
                name,
                stops: (stops || []).map(p => normPoint(p, defaultCoords)).filter(Boolean),
            };
        });
    }, [routes, driverColors, defaultCoords]);

    const unroutedN = useMemo(
        () => (unrouted || []).map(p => normPoint(p, defaultCoords)).filter(Boolean),
        [unrouted, defaultCoords]
    );

    const allPoints = useMemo(() => {
        const pts = [];
        for (const r of normalizedRoutes) for (const p of r.stops) pts.push(p);
        for (const u of unroutedN) pts.push(u);
        return pts;
    }, [normalizedRoutes, unroutedN]);

    useEffect(() => {
        // console.log("[DriversMap] routes sizes:", normalizedRoutes.map(r => r.stops.length));
        // console.log("[DriversMap] unrouted:", unroutedN.length);
    }, [normalizedRoutes, unroutedN]);

    const zoom = useMemo(() => {
        if (allPoints.length < 2) return 11;
        const lats = allPoints.map((p) => p.lat);
        const lngs = allPoints.map((p) => p.lng);
        const span = Math.max(
            Math.max(...lats) - Math.min(...lats),
            Math.max(...lngs) - Math.min(...lngs)
        );
        if (span > 1.5) return 8;
        if (span > 0.7) return 9;
        if (span > 0.3) return 10;
        if (span > 0.15) return 11;
        return 12;
    }, [allPoints]);

    const [popup, setPopup] = useState(null);
    const closePopup = () => setPopup(null);

    const [startAtDietFantasy, setStartAtDietFantasy] = useState(() => {
        // persist preference per user; default to true
        try {
            const saved = localStorage.getItem("startAtDietFantasy");
            return saved == null ? true : saved === "true";
        } catch {
            return true;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem("startAtDietFantasy", String(startAtDietFantasy));
        } catch {}
    }, [startAtDietFantasy]);

    function openPopup(p, color, driverIdx = null, stopIdx = null) {
        const name = displayName(p);
        const addr1 = `${p.address ?? ""}${p.apt ? " " + p.apt : ""}`.trim();
        const addr2 = `${p.city ?? ""} ${p.state ?? ""} ${p.zip ?? ""}`.trim();
        setPopup({
            lat: p.lat,
            lng: p.lng,
            color,
            name,
            addr1,
            addr2,
            phone: p.phone ?? "",
            driverIdx,
            stopIdx,
            isDefault: p.isDefault,
        });
    }

    function focusFirst() {
        const firstRoute = normalizedRoutes.find((r) => r.stops.length > 0);
        const firstPoint = firstRoute?.stops?.[0] || unroutedN?.[0];
        if (!firstPoint) return;
        openPopup(firstPoint, firstRoute?.color || "#000", 0, 0);
    }

    async function handleOptimize() {
        const driverCount = Math.max(1, (routes?.length ?? 0) || 1);

        try {
            const res = await fetch("/api/route/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    day: optimizeDay,
                    driverCount,
                    useDietFantasyStart: startAtDietFantasy, // uses your toggle state
                }),
            });

            const data = await res.json();
            if (!data?.ok) {
                return alert(`Route generation failed: ${data?.error || "Unknown error"}`);
            }

            alert(
                `Routes optimized.\n` +
                `Applied "Start at Diet Fantasy": ${data.appliedStartRotation ? "Yes" : "No"}\n` +
                `${data.message || ""}`
            );

            onAfterOptimize?.();
        } catch (err) {
            alert(`Network/server error: ${err?.message || err}`);
        }
    }

    const legend = useMemo(
        () =>
            normalizedRoutes.map((r, i) => ({
                color: r.color,
                label: r.name || `Driver ${i + 1}`,
                count: r.stops.length,
            })),
        [normalizedRoutes]
    );

    return (
        <div style={{ position: "relative", width: "100%", height: 520 }}>
            {/* Floating menu (legend + close + optimize) */}
            <div
                style={{
                    position: "absolute",
                    zIndex: 9999,
                    top: 12,
                    right: 12,
                    background: "rgba(255,255,255,0.96)",
                    padding: "10px 12px",
                    borderRadius: 10,
                    fontSize: 12,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                    minWidth: 260,
                    pointerEvents: "auto",
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
            >
                <div style={{ display: "flex", alignItems: "center", marginBottom: 6, gap: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>Driver Index</div>

                    {/* Optimize routes */}
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleOptimize();
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{
                            background: "#f5f5f5",
                            border: "1px solid #ddd",
                            borderRadius: 6,
                            padding: "4px 8px",
                            fontSize: 12,
                            cursor: "pointer",
                        }}
                        title="Rebuild/optimize routes"
                    >
                        Optimize routes
                    </button>

                    <button
                        onClick={() => onClose?.()}
                        style={{
                            border: "none",
                            background: "transparent",
                            fontSize: 18,
                            cursor: "pointer",
                            lineHeight: 1,
                            padding: 0,
                            margin: 0,
                        }}
                        aria-label="Close map"
                        title="Close map"
                    >
                        ×
                    </button>
                </div>

                {/* Start-at-DF toggle */}
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <input
                        type="checkbox"
                        checked={startAtDietFantasy}
                        onChange={(e) => setStartAtDietFantasy(e.target.checked)}
                    />
                    <span>Start at Diet Fantasy</span>
                </label>
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: -4, marginBottom: 8 }}>
                    (41.14628538783947, -73.98948195720195)
                </div>

                <div style={{ maxHeight: 180, overflowY: "auto", paddingRight: 4 }}>
                    {legend.length === 0 ? (
                        <div style={{ opacity: 0.7 }}>No routes</div>
                    ) : (
                        legend.map((item, idx) => (
                            <div
                                key={idx}
                                style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}
                            >
                <span
                    style={{
                        display: "inline-block",
                        width: 14,
                        height: 14,
                        borderRadius: 4,
                        background: item.color,
                        border: "1px solid rgba(0,0,0,0.15)",
                    }}
                />
                                <span style={{ flex: 1 }}>{item.label}</span>
                                <span style={{ opacity: 0.7 }}>{item.count}</span>
                            </div>
                        ))
                    )}
                </div>

                <div
                    style={{
                        display: "flex",
                        gap: 8,
                        marginTop: 8,
                        alignItems: "center",
                        flexWrap: "wrap",
                    }}
                >
          <span style={{ fontSize: 11, opacity: 0.75 }}>
            Unrouted: <b>{unroutedN.length}</b>
          </span>
                    <button
                        onClick={focusFirst}
                        style={{
                            marginLeft: "auto",
                            background: "#f5f5f5",
                            border: "1px solid #ddd",
                            borderRadius: 6,
                            padding: "4px 8px",
                            fontSize: 12,
                            cursor: "pointer",
                        }}
                    >
                        Focus first point
                    </button>
                </div>
            </div>

            <Map
                defaultCenter={center}
                defaultZoom={zoom}
                height={520}
                onClick={() => setPopup(null)}
            >
                {normalizedRoutes.map((route, i) =>
                    route.stops.map((p, idx) => (
                        <Marker
                            key={`m-${i}-${p.id ?? idx}`}
                            width={36}
                            color={p.isDefault ? "#808080" : route.color}
                            anchor={[p.lat, p.lng]}
                            onClick={({ event }) => {
                                event?.stopPropagation?.();
                                openPopup(p, route.color, i, idx);
                            }}
                        />
                    ))
                )}

                {unroutedN.map((u, i) => (
                    <Marker
                        key={`u-${u.id ?? i}`}
                        width={30}
                        color={u.isDefault ? "#808080" : "#555"}
                        anchor={[u.lat, u.lng]}
                        onClick={({ event }) => {
                            event?.stopPropagation?.();
                            openPopup(u, "#555", null, null);
                        }}
                    />
                ))}

                {popup && (
                    <Overlay anchor={[popup.lat, popup.lng]} offset={[120, 40]}>
                        <div style={{ background: 'white', borderRadius: '5px', padding: '10px', boxShadow: '0 2px 10px rgba(0,0,0,0.2)' }}>
                            <h4 style={{ margin: 0, color: popup.color }}>{popup.name}</h4>
                            <p>{popup.addr1}</p>
                            <p>{popup.addr2}</p>
                            <p>{popup.phone}</p>
                            {popup.isDefault && <p style={{ color: 'red', fontWeight: 'bold' }}>Location not accurate</p>}
                        </div>
                    </Overlay>
                )}
            </Map>
        </div>
    );
}