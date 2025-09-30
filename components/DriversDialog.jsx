// components/DriversDialog.jsx
"use client";
import RegenerateDialog from "./RegenerateDialog";

import * as React from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    LinearProgress,
    Stack,
} from "@mui/material";

import { MIN_PER_MILE, MIN_PER_STOP } from "../utils/routing";
import exportDriversWord from "../utils/driversWord";
import { buildDriversPDF } from "../utils/driversPdf";
import { geocodeMissingViaApi } from "../utils/geocodeMissingClient";

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

/* ---------- component ---------- */
export default function DriversDialog({
                                          open,
                                          onClose,
                                          users = [],            // full user list from UsersPage
                                          initialDriverCount = 6,
                                          initialSelectedDay = "all",
                                          onShowMap,
                                      }) {
    const [driverCount] = React.useState(Number(initialDriverCount || 6));
    const [selectedDay] = React.useState(initialSelectedDay || "all");

    const [routes, setRoutes] = React.useState([]);
    const [stopsPerDriver, setStopsPerDriver] = React.useState([]);
    const [busy, setBusy] = React.useState(false);

    const hasRoutes = Array.isArray(routes) && routes.length > 0;
    const [regenOpen, setRegenOpen] = React.useState(false);
    const [regenBusy, setRegenBusy] = React.useState(false);
    /* ---- load persisted routes ---- */
    async function loadPersisted() {
        setBusy(true);
        try {
            const res = await fetch(`/api/route/routes?day=${selectedDay}`);
            const data = await res.json();
            const newRoutes = data.routes || [];
            setRoutes(newRoutes.map(r => r.stops));
            setStopsPerDriver(newRoutes.map(r => r.stops.length));
        } catch (e) {
            console.error("Failed to load persisted routes", e);
        } finally {
            setBusy(false);
        }
    }

    /* ---- regenerate from scratch ---- */
    async function regenerateFromScratch() {
        setBusy(true);
        try {
            await fetch("/api/route/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ day: selectedDay, driverCount }),
            });
            await loadPersisted();
        } catch (e) {
            alert("Failed to regenerate routes: " + (e?.message || e));
        } finally {
            setBusy(false);
        }
    }

    /* ---- auto-assign newly geocoded users ---- */
    async function assignNewStops(newUsers) {
        if (!newUsers.length) return;
        try {
            await fetch("/api/route/auto-assign", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    day: selectedDay,
                    newStops: newUsers.map(u => ({
                        name: `${u.first ?? ""} ${u.last ?? ""}`.trim(),
                        address: `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim(),
                        city: u.city ?? "",
                        state: u.state ?? "",
                        zip: u.zip ?? "",
                        phone: u.phone ?? "",
                        dislikes: u.dislikes ?? "",
                        lat: Number(u.lat ?? u.latitude),
                        lng: Number(u.lng ?? u.longitude),
                    })),
                }),
            });
        } catch (e) {
            console.error("Failed to auto-assign stops", e);
        }
    }

    /* ---- geocode missing + slot them in ---- */
    async function geocodeAndAssignMissing() {
        const missing = users.filter(
            u => (u.lat ?? u.latitude) == null || (u.lng ?? u.longitude) == null
        );
        if (!missing.length) return;

        try {
            setBusy(true);
            const result = await geocodeMissingViaApi(missing);
            console.log("Geocode result:", result);

            // Build updated user objects with lat/lng now filled
            const updatedUsers = missing.map(u => ({
                ...u,
                lat: u.lat ?? u.latitude,
                lng: u.lng ?? u.longitude,
            }));

            await assignNewStops(updatedUsers);
            await loadPersisted();
        } catch (e) {
            console.error("Failed geocoding + assigning new users", e);
        } finally {
            setBusy(false);
        }
    }

    /* ---- export: Word ---- */
    const handleExportWord = React.useCallback(async () => {
        try {
            setBusy(true);
            await exportDriversWord(users, selectedDay, driverCount);
            setBusy(false);
        } catch (e) {
            console.error("Export Word failed:", e);
            setBusy(false);
        }
    }, [users, selectedDay, driverCount]);

    /* ---- export: PDF (optional) ---- */
    const handleExportPdf = React.useCallback(async () => {
        try {
            if (!hasRoutes) return;
            const normalizedRoutes = routes.map((r) =>
                r.map((u) => ({
                    ...u,
                    lat: u.lat ?? u.latitude,
                    lng: u.lng ?? u.longitude,
                }))
            );
            const doc = buildDriversPDF({
                routes: normalizedRoutes,
                unrouted: [],
                selectedDay,
            });
            doc.save(`drivers ${tsString()}.pdf`);
        } catch (e) {
            console.error("Export PDF failed:", e);
        }
    }, [hasRoutes, routes, selectedDay]);

    /* ---- view map ---- */
    const handleViewMap = React.useCallback(() => {
        if (!hasRoutes) return;
        if (typeof onShowMap === "function") {
            onShowMap({ routes, selectedDay, driverCount });
        } else {
            console.warn("onShowMap prop not provided to DriversDialog");
        }
    }, [onShowMap, hasRoutes, routes, selectedDay, driverCount]);

    /* ---- load persisted + geocode missing on open ---- */
    React.useEffect(() => {
        if (open) {
            loadPersisted().then(() => {
                geocodeAndAssignMissing();
            });
        }
    }, [open, selectedDay]);

    /* ---- render ---- */
    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>Drivers — Routes</DialogTitle>
            <DialogContent dividers>
                {busy ? (
                    <Box sx={{ mb: 2 }}>
                        <LinearProgress />
                        <Typography variant="caption" sx={{ opacity: 0.75 }}>
                            Working...
                        </Typography>
                    </Box>
                ) : hasRoutes ? (
                    <Stack spacing={0.5}>
                        <Typography variant="subtitle2">
                            Loaded {routes.length} routes. Stops per driver: [{stopsPerDriver.join(", ")}]
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.7 }}>
                            Time weights: {MIN_PER_MILE} min/mi, {MIN_PER_STOP} min/stop.
                        </Typography>
                    </Stack>
                ) : (
                    <Typography variant="body2" sx={{ opacity: 0.7 }}>
                        No routes yet. Click “Regenerate Routes”.
                    </Typography>
                )}
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose} disabled={busy}>
                    Close
                </Button>

                <Button
                    onClick={() => setRegenOpen(true)}
                    variant="contained"
                    color="error"
                    disabled={busy}
                >
                    Regenerate Routes
                </Button>

                <Button
                    onClick={handleViewMap}
                    variant="outlined"
                    disabled={busy || !hasRoutes}
                >
                    View Map
                </Button>

                <Button
                    onClick={handleExportWord}
                    variant="outlined"
                    disabled={busy || !hasRoutes}
                >
                    Export Drivers (Word)
                </Button>

                {/* Uncomment if you want PDF export */}
                {/* <Button
          onClick={handleExportPdf}
          variant="outlined"
          disabled={busy || !hasRoutes}
        >
          Export Drivers (PDF)
        </Button> */}
                <RegenerateDialog
                    open={regenOpen}
                    onClose={() => setRegenOpen(false)}
                    busy={regenBusy}
                    onConfirm={async (driverCount) => {
                        try {
                            setRegenBusy(true);
                            const res = await fetch("/api/route/generate", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ day: selectedDay, driverCount }),
                            });
                            const data = await res.json();

                            // update local state immediately so map/export work
                            setRoutes(data.routes.map(r => r.stops));
                            setStopsPerDriver(data.routes.map(r => r.stops.length));

                            setRegenOpen(false);
                        } catch (e) {
                            alert("Failed to regenerate routes: " + (e?.message || e));
                        } finally {
                            setRegenBusy(false);
                        }

                    }}
                />
            </DialogActions>
        </Dialog>
    );
}