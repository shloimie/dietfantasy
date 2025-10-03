// components/DriversDialog.jsx
"use client";

import * as React from "react";
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, Box, Typography, LinearProgress
} from "@mui/material";

import dynamic from "next/dynamic";
const DriversMapLeaflet = dynamic(() => import("./DriversMapLeaflet"), { ssr: false });

import ManualGeocodeDialog from "./ManualGeocodeDialog";

import { exportRouteLabelsPDF } from "../utils/pdfRouteLabels";
import { MIN_PER_MILE, MIN_PER_STOP } from "../utils/routing";

const palette = [
    "#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd",
    "#8c564b","#e377c2","#7f7f7f","#bcbd22","#17becf"
];

const nameOf = (u = {}) => {
    const n = u.name ?? u.fullName ?? `${u.first ?? ""} ${u.last ?? ""}`.trim();
    if (n) return n;
    const addr = `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim();
    return addr || "Unnamed";
};

export default function DriversDialog({
                                          open,
                                          onClose,
                                          users = [],
                                          initialDriverCount = 6,
                                          initialSelectedDay = "all",
                                      }) {
    const [driverCount, setDriverCount] = React.useState(Number(initialDriverCount || 6));
    const [selectedDay] = React.useState(initialSelectedDay || "all");

    const [routes, setRoutes] = React.useState([]);
    const [unrouted, setUnrouted] = React.useState([]);

    const [mapOpen, setMapOpen] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [manualOpen, setManualOpen] = React.useState(false);
    const [missingBatch, setMissingBatch] = React.useState([]);

    const hasRoutes = routes.length > 0;

    const loadRoutes = React.useCallback(async () => {
        setBusy(true);
        try {
            const res = await fetch(`/api/route/routes?day=${selectedDay}`, { cache: "no-store" });
            const data = await res.json();
            setRoutes(data.routes || []);
            setUnrouted(data.unrouted || []);
        } catch (e) {
            console.error("Failed to load routes", e);
        } finally {
            setBusy(false);
        }
    }, [selectedDay]);

    React.useEffect(() => {
        if (!open) return;
        const missing = users.filter(u => (u.lat ?? u.latitude) == null || (u.lng ?? u.longitude) == null);
        setMissingBatch(missing);
        setMapOpen(true);
        loadRoutes();
    }, [open, users, loadRoutes]);

    const handleManualGeocoded = React.useCallback(async (updates) => {
        if (!Array.isArray(updates) || !updates.length) return;
        try {
            const mapById = new Map(users.map(u => [Number(u.id), u]));
            const newStops = updates.map(u => {
                const base = mapById.get(Number(u.id));
                if (!base) return null;
                return {
                    userId: base.id,
                    name: `${base.first ?? ""} ${base.last ?? ""}`.trim(),
                    address: `${base.address ?? ""}`.trim(),
                    apt: base.apt ?? null,
                    city: base.city ?? "",
                    state: base.state ?? "",
                    zip: base.zip ?? "",
                    phone: base.phone ?? null,
                    dislikes: base.dislikes ?? null,
                    lat: Number(u.lat),
                    lng: Number(u.lng),
                };
            }).filter(Boolean);

            if (newStops.length) {
                setBusy(true);
                await fetch("/api/route/auto-assign", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ day: selectedDay, newStops }),
                }).catch((e) => console.error("auto-assign failed", e));
                await loadRoutes();
            }
        } finally {
            setBusy(false);
        }
    }, [users, selectedDay, loadRoutes]);

    const handleReassign = React.useCallback(async (stop, toDriverId) => {
        const toId = Number(toDriverId);
        setRoutes(prevRoutes => {
            const next = prevRoutes.map(r => ({ ...r, stops: [...(r.stops || [])] }));
            if (stop.__driverId) {
                const fromIdx = next.findIndex(r => r.driverId === stop.__driverId);
                const toIdx   = next.findIndex(r => r.driverId === toId);
                if (fromIdx === -1 || toIdx === -1) return prevRoutes;
                const sIdx = next[fromIdx].stops.findIndex(s => s.id === stop.id);
                if (sIdx === -1) return prevRoutes;
                const [moved] = next[fromIdx].stops.splice(sIdx, 1);
                next[toIdx].stops.push({ ...moved, __driverId: toId });
                return next;
            } else {
                const toIdx = next.findIndex(r => r.driverId === toId);
                if (toIdx === -1) return prevRoutes;
                next[toIdx].stops.push({ ...stop, __driverId: toId });
                return next;
            }
        });
        if (!stop.__driverId) setUnrouted(prev => prev.filter(u => String(u.id) !== String(stop.id)));
        try {
            const res = await fetch("/api/route/reassign", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ day: selectedDay, toDriverId: toId, stopId: Number(stop.id), userId: Number(stop.userId) || undefined }),
            });
            if (!res.ok) throw new Error(await res.text());
        } catch (e) {
            console.error("Reassign failed:", e);
            await loadRoutes();
            alert("Reassign didn’t save. View refreshed.");
        }
    }, [selectedDay, loadRoutes]);

    const mapDrivers = React.useMemo(() => {
        return routes.map((r, i) => {
            const color = r.color || palette[i % palette.length];
            const dname = r.driverName || `Driver ${i + 1}`;
            const driverId = r.driverId;
            const stops = (r.stops || []).map((u, idx) => ({
                id: u.id,
                userId: u.userId ?? u.id,
                name: nameOf(u),
                address: `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim(),
                phone: u.phone ?? "",
                city: u.city ?? "",
                state: u.state ?? "",
                zip: u.zip ?? "",
                lat: Number(u.lat),
                lng: Number(u.lng),
                __driverId: driverId,
                __driverName: dname,
                __stopIndex: idx,
            })).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
            return { id: String(driverId), driverId, name: dname, color, polygon: [], stops };
        });
    }, [routes]);

    // Build the inputs expected by exportRouteLabelsPDF:
    // 1) routeStops: Array<Array<UserLike>>
    const routeStops = React.useMemo(
        () => routes.map(r => (r.stops || [])),
        [routes]
    );

    // 2) driverColors: one color per driver, aligned with routes
    const driverColors = React.useMemo(
        () => routes.map((r, i) => r.color || palette[i % palette.length]),
        [routes]
    );

    // timestamp helper for filename
    function tsString() {
        const d = new Date();
        const mm = d.getMonth() + 1;
        const dd = d.getDate();
        let h = d.getHours();
        const m = d.getMinutes();
        const ampm = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return `${mm}-${dd} ${h}:${String(m).padStart(2, "0")}${ampm}`;
    }

    return (
        <>
            <ManualGeocodeDialog
                open={manualOpen}
                onClose={() => setManualOpen(false)}
                usersMissing={missingBatch}
                onGeocoded={handleManualGeocoded}
            />

            <Dialog
                open={mapOpen}
                onClose={() => { setMapOpen(false); onClose?.(); }}
                maxWidth="lg"
                fullWidth
                PaperProps={{ style: { height: "80vh", position: "relative" } }}
            >
                <DialogTitle>
                    Stops Map
                    <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>
            • Unrouted: {unrouted?.length ?? 0}
          </span>
                </DialogTitle>

                <DialogContent dividers sx={{ position: "relative", p: 0 }}>
                    <Box sx={{ height: "100%", width: "100%", position: "relative" }}>
                        <DriversMapLeaflet
                            drivers={mapDrivers}
                            unrouted={unrouted}
                            onReassign={handleReassign}
                            onClose={() => { setMapOpen(false); onClose?.(); }}
                            initialCenter={[40.7128, -74.006]}
                            initialZoom={10}
                        />
                        {busy && (
                            <Box
                                sx={{
                                    position: "absolute", inset: 0, display: "flex",
                                    alignItems: "flex-start", justifyContent: "center",
                                    pointerEvents: "none", background: "rgba(255,255,255,0.35)"
                                }}
                            >
                                <Box sx={{ mt: 2 }}>
                                    <LinearProgress sx={{ width: 260 }} />
                                    <Typography variant="caption" sx={{ display: "block", textAlign: "center", mt: 0.5, opacity: 0.8 }}>
                                        Loading…  Time weights: {MIN_PER_MILE} min/mi, {MIN_PER_STOP} min/stop.
                                    </Typography>
                                </Box>
                            </Box>
                        )}
                    </Box>
                </DialogContent>

                <DialogActions>
                    {missingBatch.length > 0 && (
                        <Typography variant="body2" sx={{ mr: "auto", opacity: 0.8 }}>
                            {missingBatch.length} customer{missingBatch.length === 1 ? "" : "s"} are not geocoded.
                            <Button size="small" sx={{ ml: 1 }} onClick={() => setManualOpen(true)}>
                                Manual Geocoding
                            </Button>
                        </Typography>
                    )}

                    <Button
                        onClick={async () => {
                            setBusy(true);
                            try {
                                // IMPORTANT: pass the array-of-arrays of stops
                                await exportRouteLabelsPDF(routeStops, driverColors, tsString);
                            } finally {
                                setBusy(false);
                            }
                        }}
                        variant="outlined"
                        disabled={busy || !hasRoutes}
                    >
                        Download Labels
                    </Button>

                    <Button
                        onClick={async () => {
                            const countStr = window.prompt("How many drivers for the new route?", String(driverCount));
                            if (countStr == null) return;
                            const count = Number(countStr);
                            if (!Number.isFinite(count) || count <= 0) { alert("Enter a valid number."); return; }
                            setDriverCount(count);
                            const ok = window.confirm(`Regenerate routes for "${selectedDay}" with ${count} drivers?`);
                            if (!ok) return;
                            try {
                                setBusy(true);
                                const res = await fetch("/api/route/generate", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ day: selectedDay, driverCount: count }),
                                });
                                if (!res.ok) throw new Error(await res.text());
                                await loadRoutes();
                            } catch (e) {
                                console.error(e); alert("Failed to regenerate.");
                            } finally {
                                setBusy(false);
                            }
                        }}
                        variant="contained" color="error" disabled={busy}
                    >
                        Generate New Route
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}