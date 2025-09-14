// components/DriversDialog.jsx
// Option B: Exporter computes routes internally using driverCount.
// Full dialog with day select, driver count, geocode-missing, generate, and export.

"use client";
import { exportDriversWord } from "../utils/driversWord";
import { tsString } from "../utils/driversPdf";
import * as React from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Stack,
    TextField,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Typography,
    LinearProgress,
    Box,
} from "@mui/material";

import { exportDriversPDF } from "../utils/driversPdf"; // now outputs .docx but keeps same name
import {
    apiGeocodeMissing,
    planRoutes,                          // legacy wrapper → array-of-arrays, good for preview
    getGeocodedCandidates,
    normalizeDay,
} from "../utils/routing";

const DAYS = [
    { value: "all", label: "All Days" },
    { value: "monday", label: "Monday" },
    { value: "tuesday", label: "Tuesday" },
    { value: "wednesday", label: "Wednesday" },
    { value: "thursday", label: "Thursday" },
    { value: "friday", label: "Friday" },
    { value: "saturday", label: "Saturday" },
    { value: "sunday", label: "Sunday" },
];

export default function DriversDialog({
                                          open,
                                          onClose,
                                          users = [],
                                          defaultDay = "all",
                                          defaultDrivers = 4,
                                      }) {
    const [selectedDay, setSelectedDay] = React.useState(defaultDay);
    const [numDrivers, setNumDrivers] = React.useState(defaultDrivers);
    const [busy, setBusy] = React.useState(false);

    // preview state (optional, for “Generate Routes”)
    const [routes, setRoutes] = React.useState([]);
    const [unrouted, setUnrouted] = React.useState([]);

    // summary counts
    const { activeCount, geocodedCount, missingCount } = React.useMemo(() => {
        const dayKey = normalizeDay(selectedDay);
        const arr = Array.isArray(users) ? users : [];
        const active = arr.filter((u) => !u?.paused && (dayKey ? !!u?.schedule?.[dayKey] : true));
        const geocoded = active.filter((u) => (u?.lat ?? u?.latitude) != null && (u?.lng ?? u?.longitude) != null);
        return {
            activeCount: active.length,
            geocodedCount: geocoded.length,
            missingCount: active.length - geocoded.length,
        };
    }, [users, selectedDay]);

    const driverCount = Number(numDrivers || 0); // <- Option B: define it locally

    async function handleGeocodeMissing() {
        try {
            setBusy(true);
            await apiGeocodeMissing(); // your /api/route/geocode-missing endpoint
        } catch (err) {
            console.error("Geocode missing failed:", err);
            alert("Geocoding failed. Check server logs.");
        } finally {
            setBusy(false);
        }
    }

    async function handleGenerate() {
        try {
            setBusy(true);
            // preview: compute candidates for the selected day and geocoded only
            const candidates = getGeocodedCandidates(users, selectedDay);
            const arr = planRoutes(candidates, driverCount); // array of arrays (legacy wrapper)
            setRoutes(arr);
            // unrouted preview for UI only (not required for export)
            const dayKey = normalizeDay(selectedDay);
            const active = (users || []).filter((u) => !u?.paused && (dayKey ? !!u?.schedule?.[dayKey] : true));
            const missing = active.filter((u) => (u?.lat ?? u?.latitude) == null || (u?.lng ?? u?.longitude) == null);
            setUnrouted(missing);
        } catch (err) {
            console.error("Generate routes failed:", err);
            alert("Failed to generate routes. See console.");
        } finally {
            setBusy(false);
        }
    }

    async function handleExport() {
        try {
            setBusy(true);
            // Option B: the exporter computes routes internally from (users, selectedDay, driverCount)
            await exportDriversPDF(users, selectedDay, driverCount);
        } catch (err) {
            console.error("Export failed:", err);
            alert("Failed to export drivers. See console.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
            <DialogTitle>Drivers</DialogTitle>

            <DialogContent dividers>
                <Stack spacing={2}>
                    {busy && <LinearProgress />}

                    <Stack direction="row" spacing={2}>
                        <FormControl size="small" sx={{ minWidth: 200 }}>
                            <InputLabel id="day-select-label">Day</InputLabel>
                            <Select
                                labelId="day-select-label"
                                label="Day"
                                value={selectedDay}
                                onChange={(e) => setSelectedDay(e.target.value)}
                            >
                                {DAYS.map((d) => (
                                    <MenuItem key={d.value} value={d.value}>
                                        {d.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <TextField
                            size="small"
                            label="# of drivers"
                            type="number"
                            value={numDrivers}
                            onChange={(e) => setNumDrivers(e.target.value)}
                            inputProps={{ min: 1 }}
                            sx={{ width: 160 }}
                        />
                    </Stack>

                    <Stack direction="row" spacing={3}>
                        <Stat label="Active" value={activeCount} />
                        <Stat label="Geocoded" value={geocodedCount} />
                        <Stat label="Missing" value={missingCount} />
                    </Stack>

                    {routes?.length > 0 && (
                        <Box sx={{ mt: 1 }}>
                            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                                Preview (after “Generate Routes”):
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Built {routes.length} routes. Stops per driver: [
                                {routes.map((r, i) => (i ? `, ${r.length}` : r.length)).join("")}]
                            </Typography>
                            {!!unrouted?.length && (
                                <Typography variant="body2" color="text.secondary">
                                    Unlocated addresses: {unrouted.length}
                                </Typography>
                            )}
                        </Box>
                    )}
                </Stack>
            </DialogContent>

            <DialogActions>
                <Button onClick={handleGeocodeMissing} disabled={busy}>
                    Geocode Missing
                </Button>

                <Button onClick={handleGenerate} disabled={busy}>
                    Generate Routes
                </Button>

                {/*<Button*/}
                {/*    variant="contained"*/}
                {/*    onClick={handleExport}*/}
                {/*    disabled={busy || !driverCount}*/}
                {/*>*/}
                {/*    Export Drivers (Word)*/}
                {/*</Button>*/}

                {/*<Button*/}
                {/*    variant="outlined"*/}
                {/*    onClick={() => exportDriversWord(routes, unrouted, tsString)}*/}
                {/*>*/}
                {/*    Export Drivers (Word)*/}
                {/*</Button>*/}

                <Button
                    variant="contained"
                    onClick={() => exportDriversWord(users, selectedDay, driverCount)}
                >
                    Export Drivers (Word)
                </Button>



                <Button onClick={onClose} disabled={busy}>
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
}

function Stat({ label, value }) {
    return (
        <Box>
            <Typography variant="caption" color="text.secondary">
                {label}
            </Typography>
            <Typography variant="h6">{value ?? 0}</Typography>
        </Box>
    );
}