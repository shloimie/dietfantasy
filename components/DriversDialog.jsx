// components/DriversDialog.jsx
"use client";

import * as React from "react";
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, Box, Typography, LinearProgress, Stack,
} from "@mui/material";

import dynamic from "next/dynamic";
const DriversMapLeaflet = dynamic(() => import("./DriversMapLeaflet"), { ssr: false });

import StartRouteDialog from "./StartRouteDialog";
import ManualGeocodeDialog from "./ManualGeocodeDialog";

import { MIN_PER_MILE, MIN_PER_STOP } from "../utils/routing";
import exportDriversWord from "../utils/driversWord";
import { geocodeMissingViaApi } from "../utils/geocodeMissingClient";
import { saveGeocodesBulk } from "../utils/saveGeocodes";
import { exportLabelsPDF } from "../utils/pdfLabels";

function tsString() {
    const d = new Date();
    const mm = d.getMonth() + 1;
    const dd = d.getDate();
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return `${mm}-${dd} ${h}:${String(m).padStart(2, "0")}${ampm}`;
}

const palette = ["#1f77b4","#ff7f0e","#2ca02c","#d62728","#9467bd","#8c564b","#e377c2","#7f7f7f","#bcbd22","#17becf"];

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
    const [busy, setBusy] = React.useState(false);

    const [chooserOpen, setChooserOpen] = React.useState(false);
    const [manualOpen, setManualOpen] = React.useState(false);
    const [manualList, setManualList] = React.useState([]);

    const [mapOpen, setMapOpen] = React.useState(false);

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

    const regenerate = React.useCallback(async (count) => {
        setBusy(true);
        try {
            await fetch("/api/route/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ day: selectedDay, driverCount: Number(count || driverCount) }),
            });
            await loadRoutes();
        } catch (e) {
            alert("Failed to regenerate: " + (e?.message || e));
        } finally {
            setBusy(false);
        }
    }, [selectedDay, driverCount, loadRoutes]);

    const computeUnassignedGeocoded = React.useCallback(() => {
        const assignedIds = new Set();
        for (const r of routes) for (const s of r.stops || []) assignedIds.add(Number(s.userId ?? s.id));
        for (const u of unrouted) assignedIds.add(Number(u.userId ?? u.id));
        const extras = users.filter(u => {
            const hasGeo = (u.lat ?? u.latitude) != null && (u.lng ?? u.longitude) != null;
            if (!hasGeo) return false;
            const id = Number(u.id);
            return !assignedIds.has(id);
        }).map(u => ({
            id: u.id,
            userId: u.id,
            name: `${u.first ?? ""} ${u.last ?? ""}`.trim() || "Unnamed",
            address: `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim(),
            city: u.city ?? "", state: u.state ?? "", zip: u.zip ?? "",
            phone: u.phone ?? "",
            lat: Number(u.lat ?? u.latitude),
            lng: Number(u.lng ?? u.longitude),
        }));
        return extras;
    }, [routes, unrouted, users]);

    const seedStopsFromUsers = React.useCallback(async () => {
        const ready = users
            .filter(u => (u.lat ?? u.latitude) != null && (u.lng ?? u.longitude) != null)
            .map(u => ({
                userId: u.id,
                name: `${u.first ?? ""} ${u.last ?? ""}`.trim(),
                address: `${u.address ?? ""}`.trim(),
                apt: u.apt ?? null,
                city: u.city ?? "", state: u.state ?? "", zip: u.zip ?? "",
                phone: u.phone ?? null, dislikes: u.dislikes ?? null,
                lat: u.lat ?? u.latitude,
                lng: u.lng ?? u.longitude,
            }));
        if (!ready.length) return;
        const res = await fetch("/api/route/auto-assign", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ day: selectedDay, newStops: ready }),
        });
        if (!res.ok) throw new Error(await res.text());
    }, [users, selectedDay]);

    async function autoGeocodeMissing() {
        const missing = users.filter(
            u => (u.lat ?? u.latitude) == null || (u.lng ?? u.longitude) == null
        ).map(u => ({
            id: u.id,
            address: u.address, city: u.city, state: u.state, zip: u.zip
        }));
        if (!missing.length) return [];
        try {
            setBusy(true);
            await geocodeMissingViaApi(missing);
        } finally {
            setBusy(false);
        }
        return users.filter(
            u => (u.lat ?? u.latitude) == null || (u.lng ?? u.longitude) == null
        );
    }

    const handleManualGeocoded = React.useCallback(async (updates) => {
        try {
            await saveGeocodesBulk(updates);
        } catch (e) {
            console.error("Saving manual geocodes failed", e);
        }
    }, []);

    React.useEffect(() => { if (open) setChooserOpen(true); }, [open]);

    const mapDrivers = React.useMemo(() => {
        return routes.map((r, i) => {
            const color = r.color || palette[i % palette.length];
            const dname = r.driverName || `Driver ${i + 1}`;
            const driverId = r.driverId;
            const stops = (r.stops || []).map((u, idx) => ({
                id: u.id, userId: u.userId ?? u.id, name: nameOf(u),
                address: `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim(),
                phone: u.phone ?? "", city: u.city ?? "", state: u.state ?? "", zip: u.zip ?? "",
                lat: Number(u.lat), lng: Number(u.lng),
                __driverId: driverId, __driverName: dname, __driverColor: color, __stopIndex: idx,
            })).filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
            return { id: String(driverId), driverId, name: dname, color, polygon: [], stops };
        });
    }, [routes]);

    const handleReassign = React.useCallback(async (stop, toDriverId) => {
        const toId = Number(toDriverId);
        setRoutes(prev => {
            const next = prev.map(r => ({ ...r, stops: [...(r.stops || [])] }));
            if (stop.__driverId) {
                const fromId = stop.__driverId;
                const fromIdx = next.findIndex(r => r.driverId === fromId);
                const toIdx   = next.findIndex(r => r.driverId === toId);
                if (fromIdx === -1 || toIdx === -1) return prev;
                const sIdx = next[fromIdx].stops.findIndex(s => s.id === stop.id);
                if (sIdx === -1) return prev;
                const [moved] = next[fromIdx].stops.splice(sIdx, 1);
                next[toIdx].stops.push({ ...moved, __driverId: toId });
                return next;
            } else {
                const toIdx = next.findIndex(r => r.driverId === toId);
                if (toIdx === -1) return prev;
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
            alert("Reassign didn’t save. View refreshed to server state.");
        }
    }, [selectedDay, loadRoutes]);

    const stopsPerDriverStr = routes.map(r => (r.stops || []).length).join(", ");

    const handleLoadExisting = React.useCallback(async () => {
        setChooserOpen(false);
        await loadRoutes();
        const extras = computeUnassignedGeocoded();
        if (extras.length) setUnrouted(prev => [...prev, ...extras]);
        setMapOpen(true);
    }, [loadRoutes, computeUnassignedGeocoded]);

    const handleCreateNew = React.useCallback(async ({ driverCount: cntFromUI, offerManual }) => {
        setChooserOpen(false);
        const cnt = Number(cntFromUI || driverCount);
        const msg = `This will regenerate drivers and stops for "${selectedDay}" and update the database.\n\nDriver count: ${cnt}\n${offerManual ? `Manual geolocation will open first.\n\n` : ``}Do you want to continue?`;
        if (typeof window !== "undefined") {
            const ok = window.confirm(msg);
            if (!ok) return;
        }
        if (offerManual) {
            const stillMissing = await autoGeocodeMissing();
            if (stillMissing.length) {
                setManualList(stillMissing);
                setManualOpen(true);
                setDriverCount(cnt);
                return;
            }
        }
        try {
            setBusy(true);
            await seedStopsFromUsers();
            await regenerate(cnt);
            setMapOpen(true);
        } catch (e) {
            console.error(e);
            alert(e?.message || String(e));
        } finally {
            setBusy(false);
        }
    }, [driverCount, selectedDay, autoGeocodeMissing, seedStopsFromUsers, regenerate]);

    const onManualCloseNew = React.useCallback(async () => {
        setManualOpen(false);
        try {
            setBusy(true);
            await seedStopsFromUsers();
            await regenerate(driverCount);
            setMapOpen(true);
        } catch (e) {
            console.error(e);
            alert(e?.message || String(e));
        } finally {
            setBusy(false);
        }
    }, [seedStopsFromUsers, regenerate, driverCount]);

    const handleExportWord = React.useCallback(async () => {
        try { setBusy(true); await exportDriversWord(users, selectedDay, driverCount); }
        catch (e) { console.error("Export Word failed:", e); }
        finally { setBusy(false); }
    }, [users, selectedDay, driverCount]);

    const handleExportLabels = React.useCallback(async () => {
        try {
            const allStops = [...routes.flatMap(r => (r.stops || [])), ...unrouted];
            if (!allStops.length) { alert("No stops to export."); return; }
            const doc = buildLabelsPDF({ stops: allStops, title: `Labels ${tsString()}` });
            doc.save(`labels ${tsString()}.pdf`);
        } catch (e) {
            console.error("Export Labels failed:", e);
            alert(e?.message || "Failed to export labels");
        }
    }, [routes, unrouted]);

    return (
        <>
            <StartRouteDialog
                open={chooserOpen}
                onClose={onClose}
                onLoadExisting={handleLoadExisting}
                onCreateNew={handleCreateNew}
                defaultDriverCount={driverCount}
            />

            <ManualGeocodeDialog
                open={manualOpen}
                onClose={onManualCloseNew}
                usersMissing={manualList}
                onGeocoded={handleManualGeocoded}
            />

            <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
                <DialogTitle>Drivers — Stops</DialogTitle>
                <DialogContent dividers>
                    {busy ? (
                        <Box sx={{ mb: 2 }}>
                            <LinearProgress />
                            <Typography variant="caption" sx={{ opacity: 0.75 }}>Working...</Typography>
                        </Box>
                    ) : routes.length ? (
                        <Stack spacing={0.5}>
                            <Typography variant="subtitle2">
                                Loaded {routes.length} drivers. Stops per driver: [{stopsPerDriverStr}]
                            </Typography>
                            <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                Time weights: {MIN_PER_MILE} min/mi, {MIN_PER_STOP} min/stop.
                            </Typography>
                        </Stack>
                    ) : (
                        <Typography variant="body2" sx={{ opacity: 0.7 }}>
                            Use the chooser to load or create a route. The map will open automatically.
                        </Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>Close</Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={mapOpen}
                onClose={() => setMapOpen(false)}
                maxWidth="lg"
                fullWidth
                PaperProps={{ style: { height: "84vh" } }}
            >
                <DialogTitle>Stops Map</DialogTitle>
                <DialogContent dividers sx={{ pb: 0 }}>
                    {routes.length || unrouted.length ? (
                        <DriversMapLeaflet
                            drivers={routes.map((r, i) => ({
                                driverId: r.driverId,
                                name: r.driverName || `Driver ${i + 1}`,
                                color: r.color || palette[i % palette.length],
                                polygon: [],
                                stops: (r.stops || []).map((u, idx) => ({
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
                                    __driverId: r.driverId,
                                    __stopIndex: idx,
                                })),
                            }))}
                            unrouted={unrouted}
                            onReassign={handleReassign}
                            onClose={() => setMapOpen(false)}
                            initialCenter={[41.1112, -74.0730]} // near Monsey
                            initialZoom={10}
                        />
                    ) : (
                        <Typography variant="body2" sx={{ opacity: 0.7 }}>
                            No data to display.
                        </Typography>
                    )}
                </DialogContent>
                <DialogActions sx={{ justifyContent: "space-between" }}>
                    <Box>
                        <Button onClick={() => setMapOpen(false)}>Close</Button>
                    </Box>
                    <Box>
                        <Button onClick={handleExportLabels} variant="outlined" sx={{ mr: 1 }}>
                            Download Labels (PDF)
                        </Button>
                        <Button onClick={handleExportWord} variant="contained">
                            Export Drivers (Word)
                        </Button>
                    </Box>
                </DialogActions>
            </Dialog>
        </>
    );
}