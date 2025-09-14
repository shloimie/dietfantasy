"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Map, Marker, Overlay } from "pigeon-maps";

const COLORS = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728",
    "#9467bd", "#8c564b", "#e377c2", "#7f7f7f",
    "#bcbd22", "#17becf",
];
// components/Drive

// Normalize {lat,lng} | {latitude,longitude}
function normPoint(p) {
    if (!p) return null;
    const lat = Number(p.lat ?? p.latitude);
    const lng = Number(p.lng ?? p.longitude);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { ...p, lat, lng };
}

export default function DriversMap({ routes = [], unrouted = [] }) {
    // Normalize data
    const routesN = useMemo(
        () => (routes || []).map(r => (r || []).map(normPoint).filter(Boolean)),
        [routes]
    );
    const unroutedN = useMemo(
        () => (unrouted || []).map(normPoint).filter(Boolean),
        [unrouted]
    );

    const allPoints = useMemo(() => {
        const pts = [];
        for (const r of routesN) for (const p of r) pts.push(p);
        for (const u of unroutedN) pts.push(u);
        return pts;
    }, [routesN, unroutedN]);

    // Logs so we can see data arrive
    useEffect(() => {
        console.log("[DriversMap] routes sizes:", routesN.map(r => r.length));
        console.log("[DriversMap] unrouted:", unroutedN.length);
    }, [routesN, unroutedN]);

    // Map center/zoom
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

    // Popup state
    const [popup, setPopup] = useState(null);
    const closePopup = () => setPopup(null);

    function openPopup(p, color, driverIdx = null, stopIdx = null) {
        const name = `${p.first ?? ""} ${p.last ?? ""}`.trim() || "(unnamed)";
        const addr1 = `${p.address ?? ""}${p.apt ? " " + p.apt : ""}`.trim();
        const addr2 = `${p.city ?? ""} ${p.state ?? ""} ${p.zip ?? ""}`.trim();
        const payload = {
            lat: p.lat,
            lng: p.lng,
            color,
            name,
            addr1,
            addr2,
            phone: p.phone ?? "",
            driverIdx,
            stopIdx,
        };
        console.log("[DriversMap] setPopup:", payload);
        setPopup(payload);
    }

    function focusFirst() {
        const firstRoute = routesN.find(r => r.length > 0);
        const firstPoint = firstRoute?.[0] || unroutedN?.[0];
        if (!firstPoint) {
            console.log("[DriversMap] focusFirst: no points");
            return;
        }
        openPopup(firstPoint, "#000", 0, 0);
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

    return (
        <div style={{ position: "relative", width: "100%", height: 520 }}>
            {/* Debug HUD */}
            <div style={{
                position: "absolute",
                zIndex: 5,
                top: 8,
                left: 8,
                background: "rgba(255,255,255,0.9)",
                padding: "6px 8px",
                borderRadius: 6,
                fontSize: 12,
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)"
            }}>
                <div><b>Routes:</b> {routesN.map(r => r.length).join(", ") || "—"}</div>
                <div><b>Unrouted:</b> {unroutedN.length}</div>
                <button
                    onClick={focusFirst}
                    style={{ marginTop: 6, padding: "4px 8px", cursor: "pointer" }}
                >
                    Focus first point
                </button>
            </div>

            <Map
                defaultCenter={center}
                defaultZoom={zoom}
                height={520}
                onClick={() => {
                    console.log("[DriversMap] map click");
                    closePopup();
                }}
            >
                {/* Driver markers */}
                {routesN.map((route, i) =>
                    route.map((p, idx) => (
                        <Marker
                            key={`m-${i}-${p.id ?? idx}`}
                            width={36}
                            color={COLORS[i % COLORS.length]}
                            anchor={[p.lat, p.lng]}
                            onClick={({ event }) => {
                                console.log("[DriversMap] marker click", { i, idx, p });
                                event?.stopPropagation?.();
                                openPopup(p, COLORS[i % COLORS.length], i, idx);
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
                            console.log("[DriversMap] unrouted click", { i, u });
                            event?.stopPropagation?.();
                            openPopup(u, "#555", null, null);
                        }}
                    />
                ))}

                {/* Popup (simple Overlay — NOT render-prop) */}
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
                                    onClick={closePopup}
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