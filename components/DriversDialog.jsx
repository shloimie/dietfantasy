// components/DriversDialog.jsx
"use client";

import * as React from "react";
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, Box, Typography, LinearProgress
} from "@mui/material";

import dynamic from "next/dynamic"; // avoid SSR for leaflet
const DriversMapLeaflet = dynamic(() => import("./DriversMapLeaflet"), { ssr: false });

// Manual geocoding dialog (saves to DB; we listen for which users were updated)
import ManualGeocodeDialog from "./ManualGeocodeDialog";


import { exportLabelsPDF } from "../utils/pdfLabels";
import { MIN_PER_MILE, MIN_PER_STOP } from "../utils/routing";

/* ---------- small utils ---------- */
function tsString() {
    const d = new Date();
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${mm}-${dd} ${h}:${String(m).padStart(2, "0")}${ampm}`;
}

const palette = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728",
    "#9467bd", "#8c564b", "#e377c2", "#7f7f7f",
    "#bcbd22", "#17becf",
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

    // Backend routes shape: [{ driverId, driverName, color, stops: Stop[] }]
    const [routes, setRoutes] = React.useState([]);
    const [unrouted, setUnrouted] = React.useState([]);

    // UI state
    const [mapOpen, setMapOpen] = React.useState(false);
    const [busy, setBusy] = React.useState(false); // covers load/regenerate/reassign (overlay spinner)
    const [manualOpen, setManualOpen] = React.useState(false);
    const [missingBatch, setMissingBatch] = React.useState([]); // users needing geocode

    const hasRoutes = routes.length > 0;

    /* ---- load drivers+stops (no-cache) ---- */
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

    /* ---- open behavior: show the MAP immediately; overlay shows while loading ---- */
    React.useEffect(() => {
        if (!open) return;
        // compute who is missing geocodes (no auto; just inform + open manual)
        const missing = users.filter(
            u => (u.lat ?? u.latitude) == null || (u.lng ?? u.longitude) == null
        );
        setMissingBatch(missing);
        setMapOpen(true);
        // load current routes in the background; overlay will show while busy
        loadRoutes();
        // if there are missing coords, open the manual screen after the map is up
        if (missing.length > 0) {
            // small timeout so the map dialog mounts first
            // setTimeout(() => setManualOpen(true), 0);
        }
    }, [open, users, loadRoutes]);

    /* ---- when manual geocode saves a user, seed them as UNROUTED for this day ---- */
    const handleManualGeocoded = React.useCallback(async (updates) => {
        // updates: [{ id, lat, lng }]
        if (!Array.isArray(updates) || !updates.length) return;
        try {
            // Find full user info for each updated id
            const mapById = new Map(users.map(u => [Number(u.id), u]));
            const newStops = updates
                .map(u => {
                    const base = mapById.get(Number(u.id));
                    if (!base) return null;
                    return {
                        userId: base.id,
                        name: `${base.first ?? ""} ${base.last ?? ""}`.trim(),
                        address: `${base.address ?? ""}`.trim(),
                        apt: base.apt ?? null,   // include for display, excluded from geocode query elsewhere
                        city: base.city ?? "",
                        state: base.state ?? "",
                        zip: base.zip ?? "",
                        phone: base.phone ?? null,
                        dislikes: base.dislikes ?? null,
                        lat: Number(u.lat),
                        lng: Number(u.lng),
                    };
                })
                .filter(Boolean);

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

    /* ---- regenerate (simple browser confirm + prompt for count) ---- */
    const generateNewRoute = React.useCallback(async () => {
        const countStr = window.prompt("How many drivers for the new route?", String(driverCount));
        if (countStr == null) return; // cancelled
        const count = Number(countStr);
        if (!Number.isFinite(count) || count <= 0) {
            alert("Please enter a valid driver count.");
            return;
        }
        setDriverCount(count);

        const ok = window.confirm(
            `This will regenerate routes for "${selectedDay}" with ${count} drivers and update the DB. Continue?`
        );
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
            console.error("Failed to regenerate:", e);
            alert("Failed to regenerate route.");
        } finally {
            setBusy(false);
        }
    }, [driverCount, selectedDay, loadRoutes]);

    /* ------------------------------------------------------------------
       REASSIGN with OPTIMISTIC UI (driver→driver & unrouted→driver)
       On failure: reload from server (rollback to truth)
       ------------------------------------------------------------------ */
    const handleReassign = React.useCallback(async (stop, toDriverId) => {
        const toId = Number(toDriverId);

        // Optimistic update
        setRoutes(prevRoutes => {
            const next = prevRoutes.map(r => ({ ...r, stops: [...(r.stops || [])] }));

            if (stop.__driverId) {
                // from existing driver → another driver
                const fromId = stop.__driverId;
                const fromIdx = next.findIndex(r => r.driverId === fromId);
                const toIdx   = next.findIndex(r => r.driverId === toId);
                if (fromIdx === -1 || toIdx === -1) return prevRoutes;

                const sIdx = next[fromIdx].stops.findIndex(s => s.id === stop.id);
                if (sIdx === -1) return prevRoutes;

                const [moved] = next[fromIdx].stops.splice(sIdx, 1);
                next[toIdx].stops.push({ ...moved, __driverId: toId });
                return next;
            } else {
                // from UNROUTED → driver
                const toIdx = next.findIndex(r => r.driverId === toId);
                if (toIdx === -1) return prevRoutes;

                next[toIdx].stops.push({
                    ...stop,
                    __driverId: toId,
                });
                return next;
            }
        });

        // If coming from UNROUTED, remove from gray list
        if (!stop.__driverId) {
            setUnrouted(prev => prev.filter(u => String(u.id) !== String(stop.id)));
        }

        // Server call
        try {
            const res = await fetch("/api/route/reassign", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    day: selectedDay,
                    toDriverId: toId,
                    stopId: Number(stop.id),
                    userId: Number(stop.userId) || undefined,
                }),
            });
            if (!res.ok) throw new Error(await res.text());
        } catch (e) {
            console.error("Reassign failed:", e);
            await loadRoutes(); // rollback to server truth
            alert("Reassign didn’t save. View refreshed to server state.");
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
                __driverColor: color,
                __stopIndex: idx,
            })).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));

            return { id: String(driverId), driverId, name: dname, color, polygon: [], stops };
        });
    }, [routes]);

    return (
        <>
            {/* Manual geocode screen; opens automatically if there are missing users */}
            <ManualGeocodeDialog
                open={manualOpen}
                onClose={() => setManualOpen(false)}
                usersMissing={missingBatch}
                onGeocoded={handleManualGeocoded}  // so we can seed + reload
            />

            {/* Map Dialog (opens immediately) */}
            <Dialog
                open={mapOpen}
                onClose={() => { setMapOpen(false); onClose?.(); }}
                maxWidth="lg"
                fullWidth
                PaperProps={{ style: { height: "80vh", position: "relative" } }}
            >
                <DialogTitle>Stops Map</DialogTitle>
                <DialogContent dividers sx={{ position: "relative", p: 0 }}>
                    {/* Map area */}
                    <Box sx={{ height: "100%", width: "100%", position: "relative" }}>
                        <DriversMapLeaflet
                            drivers={mapDrivers}
                            unrouted={unrouted}
                            onReassign={handleReassign}
                            onClose={() => { setMapOpen(false); onClose?.(); }}
                            initialCenter={[40.7128, -74.006]}
                            initialZoom={10}
                        />

                        {/* Overlay spinner while loading/regenerating/etc. */}
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
                    {/* If there are missing users, show a gentle reminder with a button to reopen manual screen */}
                    {missingBatch.length > 0 && (
                        <Typography variant="body2" sx={{ mr: "auto", opacity: 0.8 }}>
                            {missingBatch.length} customer{missingBatch.length === 1 ? "" : "s"} are not geocoded.
                            <Button size="small" sx={{ ml: 1 }} onClick={() => setManualOpen(true)}>
                                Open Manual Geocoding
                            </Button>
                        </Typography>
                    )}

                    <Button onClick={() => { setMapOpen(false); onClose?.(); }} disabled={busy}>Close</Button>

                    <Button onClick={async () => { setBusy(true); try { await exportLabelsPDF(users, selectedDay); } finally { setBusy(false); } }}
                            variant="outlined" disabled={busy || !hasRoutes}>
                        Download Labels (PDF)
                    </Button>



                    <Button
                        onClick={generateNewRoute}
                        variant="contained"
                        color="error"
                        disabled={busy}
                        title="Regenerate routes with a new driver count"
                    >
                        Generate New Route
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}