"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Map, Marker, Overlay } from "pigeon-maps";

const FALLBACK_COLORS = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728",
    "#9467bd", "#8c564b", "#e377c2", "#7f7f7f",
    "#bcbd22", "#17becf",
];

// Normalize {lat,lng} | {latitude,longitude}
function normPoint(p) {
    if (!p) return null;
    const lat = Number(p.lat ?? p.latitude);
    const lng = Number(p.lng ?? p.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { ...p, lat, lng };
}

// Prefer name/fullName, else first+last, else address, else "Unnamed"
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
 *  - driverColors?: string[] (optional override per route)
 */
export default function DriversMap({ routes = [], unrouted = [], onClose, driverColors }) {
    // Accept either raw stops arrays or objects with .stops
    const normalizedRoutes = useMemo(() => {
        return (routes || []).map((r, i) => {
            const stops = Array.isArray(r) ? r : (r?.stops || []);
            const colorFromRoute = (!Array.isArray(r) && (r?.color || r?.driverColor)) || driverColors?.[i];
            const color = colorFromRoute || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
            const name = (!Array.isArray(r) && (r?.driverName || r?.name)) || `Driver ${i + 1}`;
            return {
                color,
                name,
                stops: (stops || []).map(normPoint).filter(Boolean),
            };
        });
    }, [routes, driverColors]);

    const unroutedN = useMemo(() => (unrouted || []).map(normPoint).filter(Boolean), [unrouted]);

    const allPoints = useMemo(() => {
        const pts = [];
        for (const r of normalizedRoutes) for (const p of r.stops) pts.push(p);
        for (const u of unroutedN) pts.push(u);
        return pts;
    }, [normalizedRoutes, unroutedN]);

    useEffect(() => {
        console.log("[DriversMap] routes sizes:", normalizedRoutes.map(r => r.stops.length));
        console.log("[DriversMap] unrouted:", unroutedN.length);
    }, [normalizedRoutes, unroutedN]);

    const center = useMemo(() => {
        if (!allPoints.length) return [40.7128, -74.006]; // NYC fallback
        const lat = allPoints.reduce((s, p) => s + p.lat, 0) / allPoints.length;
        const lng = allPoints.reduce((s, p) => s + p.lng, 0) / allPoints.length;
        return [lat, lng];
    }, [allPoints]);

    const zoom = useMemo(() => {
        if (allPoints.length < 2) return 11;
        const lats = allPoints.map(p => p.lat);
        const lngs = allPoints.map(p => p.lng);
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
        });
    }

    function focusFirst() {
        const firstRoute = normalizedRoutes.find(r => r.stops.length > 0);
        const firstPoint = firstRoute?.stops?.[0] || unroutedN?.[0];
        if (!firstPoint) return;
        openPopup(firstPoint, firstRoute?.color || "#000", 0, 0);
    }

    async function copyAddress(text) {
        try { await navigator.clipboard.writeText(text); } catch {}
    }

    function openInGoogleMaps(lat, lng, addrText) {
        const url = addrText
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addrText)}`
            : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
        window.open(url, "_blank", "noopener,noreferrer");
    }

    // Legend items
    const legend = useMemo(
        () => normalizedRoutes.map((r, i) => ({
            color: r.color,
            label: r.name || `Driver ${i + 1}`,
            count: r.stops.length
        })),
        [normalizedRoutes]
    );

    return (
        <div style={{ position: "relative", width: "100%", height: 520 }}>
            {/* Floating menu (legend + close) */}
            <div
                style={{
                    position: "absolute",
                    zIndex: 5,
                    top: 12,
                    right: 12,
                    background: "rgba(255,255,255,0.96)",
                    padding: "10px 12px",
                    borderRadius: 10,
                    fontSize: 12,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                    minWidth: 220,
                    pointerEvents: "auto",
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>Driver Index</div>
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

                <div style={{ maxHeight: 180, overflowY: "auto", paddingRight: 4 }}>
                    {legend.length === 0 ? (
                        <div style={{ opacity: 0.7 }}>No routes</div>
                    ) : (
                        legend.map((item, idx) => (
                            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
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

                <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
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
                onClick={() => { setPopup(null); }}
            >
                {/* Driver markers */}
                {normalizedRoutes.map((route, i) =>
                    route.stops.map((p, idx) => (
                        <Marker
                            key={`m-${i}-${p.id ?? idx}`}
                            width={36}
                            color={route.color}
                            anchor={[p.lat, p.lng]}
                            onClick={({ event }) => {
                                event?.stopPropagation?.();
                                openPopup(p, route.color, i, idx);
                            }}
                        />
                    ))
                )}

                {/* Unrouted markers (gray) */}
                {unroutedN.map((u, i) => (
                    <Marker
                        key={`u-${u.id ?? i}`}
                        width={30}
                        color="#555"
                        anchor={[u.lat, u.lng]}
                        onClick={({ event }) => {
                            event?.stopPropagation?.();
                            openPopup(u, "#555", null, null);
                        }}
                    />
                ))}

                {/* Popup */}
                {popup && (
                    <Overlay anchor={[popup.lat, popup.lng]} offset={[0, 0]}>
                        <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                transform: "translate(-50%, -110%)",
                                background: "#fff",
                                border: `2px solid ${popup.color}`,
                                borderRadius: 8,
                                padding: "8px 10px",
                                boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
                                fontSize: 13,
                                width: 260,
                                zIndex: 4,
                                pointerEvents: "auto",
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                                <div style={{ fontWeight: 700, flex: 1 }}>{popup.name}</div>
                                <button
                                    onClick={() => setPopup(null)}
                                    style={{
                                        border: "none",
                                        background: "transparent",
                                        fontSize: 16,
                                        cursor: "pointer",
                                        lineHeight: 1,
                                    }}
                                    aria-label="Close"
                                >
                                    ×
                                </button>
                            </div>

                            {(popup.driverIdx != null || popup.stopIdx != null) && (
                                <div style={{ color: "#666", marginBottom: 6 }}>
                                    {popup.driverIdx != null && <span>Driver <b>{popup.driverIdx + 1}</b></span>}
                                    {popup.driverIdx != null && popup.stopIdx != null && <span> · </span>}
                                    {popup.stopIdx != null && <span>Stop <b>{popup.stopIdx + 1}</b></span>}
                                </div>
                            )}

                            {popup.addr1 && <div>{popup.addr1}</div>}
                            {popup.addr2 && <div>{popup.addr2}</div>}
                            {popup.phone && (
                                <div style={{ marginTop: 4 }}>
                                    <a href={`tel:${popup.phone}`} style={{ textDecoration: "none" }}>
                                        {popup.phone}
                                    </a>
                                </div>
                            )}

                            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                                <button
                                    onClick={() =>
                                        openInGoogleMaps(
                                            popup.lat,
                                            popup.lng,
                                            [popup.addr1, popup.addr2].filter(Boolean).join(", ")
                                        )
                                    }
                                    style={btnStyle}
                                >
                                    Open in Google Maps
                                </button>
                                <button
                                    onClick={() =>
                                        copyAddress([popup.name, popup.addr1, popup.addr2].filter(Boolean).join("\n"))
                                    }
                                    style={btnStyle}
                                >
                                    Copy
                                </button>
                            </div>

                            <div
                                style={{
                                    position: "absolute",
                                    left: "50%",
                                    bottom: -10,
                                    transform: "translateX(-50%)",
                                    width: 0,
                                    height: 0,
                                    borderLeft: "10px solid transparent",
                                    borderRight: "10px solid transparent",
                                    borderTop: `10px solid ${popup.color}`,
                                }}
                            />
                        </div>
                    </Overlay>
                )}
            </Map>
        </div>
    );
}

const btnStyle = {
    background: "#f5f5f5",
    border: "1px solid #ddd",
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 12,
    cursor: "pointer",
};