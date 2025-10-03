// components/ManualGeocodeDialog.jsx
"use client";

import * as React from "react";
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, Box, Typography, Stack, TextField, LinearProgress, Chip
} from "@mui/material";
import { geocodeOneClient } from "../utils/geocodeOneClient";
import { geocodeMissingViaApi } from "../utils/geocodeMissingClient";
import { buildGeocodeQuery } from "../utils/addressHelpers";
import MapConfirmDialog from "./MapConfirmDialog";

/**
 * Props:
 * - open
 * - onClose
 * - usersMissing: Array<{ id, first, last, address, apt?, city, state, zip }>
 * - onGeocoded: (updates: Array<{ id, lat, lng }>) => void  // should persist to DB
 */
export default function ManualGeocodeDialog({
                                                open,
                                                onClose,
                                                usersMissing = [],
                                                onGeocoded,
                                            }) {
    const toRow = React.useCallback((u) => ({
        id: u.id,
        name: `${u.first ?? ""} ${u.last ?? ""}`.trim() || "Unnamed",
        address: String(u.address || ""),
        city: u.city || "",
        state: u.state || "",
        zip: u.zip || "",
        status: "pending", // pending → geocoding → ok|error
        lat: null,
        lng: null,
    }), []);

    const [rows, setRows] = React.useState(() => usersMissing.map(toRow));
    const [autoDone, setAutoDone] = React.useState(0);
    const [workingAuto, setWorkingAuto] = React.useState(false);

    const [pickerOpen, setPickerOpen] = React.useState(false);
    const [pickerRow, setPickerRow] = React.useState(null);

    React.useEffect(() => {
        if (!open) return;
        const next = usersMissing.map(toRow);
        setRows(next);
        setAutoDone(0);
    }, [open, usersMissing, toRow]);

    const updateField = (id, field, value) =>
        setRows(prev => prev.map(r => (r.id === id ? { ...r, [field]: value } : r)));

    const persistOK = (id, lat, lng) => {
        setRows(prev => prev.map(r => (r.id === id ? { ...r, status: "ok", lat, lng } : r)));
        setAutoDone(d => d + 1);
        onGeocoded?.([{ id, lat, lng }]); // persist upstream
    };

    const markError = (id) => {
        setRows(prev => prev.map(r => (r.id === id ? { ...r, status: "error" } : r)));
    };

    const geocodeRowAuto = async (row) => {
        const strictQ = buildGeocodeQuery(row);
        updateField(row.id, "status", "geocoding");
        try {
            const { lat, lng } = await geocodeOneClient(strictQ);
            persistOK(row.id, lat, lng);
            return true;
        } catch {
            // loose fallback: drop ZIP
            const looseQ = [row.address, row.city, row.state].filter(Boolean).join(", ");
            try {
                const { lat, lng } = await geocodeOneClient(looseQ);
                persistOK(row.id, lat, lng);
                return true;
            } catch {
                markError(row.id);
                return false;
            }
        }
    };

    const runAutoGeocoding = React.useCallback(async () => {
        if (!open || rows.length === 0) return;
        setWorkingAuto(true);

        // 1) bulk server-side (will write to DB for any successes)
        try {
            const payload = rows.map(r => ({
                id: r.id,
                address: r.address, // apt/unit intentionally not included
                city: r.city, state: r.state, zip: r.zip,
            }));
            await geocodeMissingViaApi(payload);
        } catch (e) {
            console.warn("Bulk auto geocode error (continuing):", e);
        }

        // 2) per-row fallback for any still pending/error (best-effort against current list)
        for (const row of rows) {
            if (row.status === "ok") continue;
            // eslint-disable-next-line no-await-in-loop
            await geocodeRowAuto(row);
        }

        // remove resolved rows; keep only those that still need manual
        setRows(prev => prev.filter(r => r.status !== "ok"));
        setWorkingAuto(false);
    }, [open, rows]);

    React.useEffect(() => {
        if (!open) return;
        runAutoGeocoding();
    }, [open, runAutoGeocoding]);

    const unresolvedCount = rows.filter(r => r.status !== "ok").length;

    const openPickerFor = (row) => { setPickerRow(row); setPickerOpen(true); };
    const onPickerConfirm = ({ lat, lng }) => {
        if (pickerRow) persistOK(pickerRow.id, lat, lng);
        setPickerOpen(false);
        setPickerRow(null);
        // remove resolved from list
        setRows(prev => prev.filter(r => r.id !== (pickerRow?.id)));
    };
    const onPickerClose = () => { setPickerOpen(false); setPickerRow(null); };

    const geocodeOneNow = async (row) => {
        await geocodeRowAuto(row);
        setRows(prev => prev.filter(r => r.status !== "ok"));
    };

    const geocodeAllUnresolvedNow = async () => {
        setWorkingAuto(true);
        for (const r of rows) {
            if (r.status === "ok") continue;
            // eslint-disable-next-line no-await-in-loop
            await geocodeRowAuto(r);
        }
        setRows(prev => prev.filter(r => r.status !== "ok"));
        setWorkingAuto(false);
    };

    return (
        <>
            <MapConfirmDialog
                open={pickerOpen}
                onClose={onPickerClose}
                initialQuery={
                    pickerRow ? buildGeocodeQuery(pickerRow) : ""
                }
                onConfirm={onPickerConfirm}
            />

            <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
                <DialogTitle>Manual Geocoding</DialogTitle>
                <DialogContent dividers>
                    {workingAuto && (
                        <Box sx={{ mb: 2 }}>
                            <LinearProgress />
                            <Typography variant="caption">Trying auto geocoding…</Typography>
                        </Box>
                    )}

                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap">
                        <Chip label={`Auto completed: ${autoDone}`} color={autoDone ? "success" : "default"} size="small" />
                        <Chip label={`Need manual: ${unresolvedCount}`} color={unresolvedCount ? "warning" : "default"} size="small" />
                        <Box sx={{ flex: 1 }} />
                        <Button size="small" variant="outlined" onClick={runAutoGeocoding} disabled={workingAuto}>
                            Retry auto
                        </Button>
                    </Stack>

                    {unresolvedCount === 0 ? (
                        <Typography variant="body2" sx={{ opacity: 0.8 }}>
                            🎉 All users were geocoded automatically.
                        </Typography>
                    ) : (
                        <Stack spacing={2}>
                            {rows.map((r) => (
                                <Box key={r.id} sx={{ p: 1, border: "1px solid #eee", borderRadius: 1 }}>
                                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                        {r.name} — ID #{r.id}
                                    </Typography>
                                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                                        <TextField
                                            size="small"
                                            label="Street (no unit)"
                                            value={r.address}
                                            onChange={(e) => updateField(r.id, "address", e.target.value)}
                                            fullWidth
                                        />
                                        <TextField size="small" label="City" value={r.city} onChange={(e) => updateField(r.id, "city", e.target.value)} />
                                        <TextField size="small" label="State" value={r.state} onChange={(e) => updateField(r.id, "state", e.target.value)} sx={{ width: 90 }} />
                                        <TextField size="small" label="ZIP" value={r.zip} onChange={(e) => updateField(r.id, "zip", e.target.value)} sx={{ width: 120 }} />
                                    </Stack>
                                    <Stack direction="row" spacing={1} sx={{ mt: 1 }} alignItems="center">
                                        <Button size="small" variant="outlined" onClick={() => geocodeOneNow(r)} disabled={workingAuto}>
                                            Auto-try again
                                        </Button>
                                        <Button size="small" variant="outlined" onClick={() => openPickerFor(r)} disabled={workingAuto}>
                                            Select on map
                                        </Button>
                                        <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                            {r.status === "pending" && "Needs geocode"}
                                            {r.status === "geocoding" && "Looking up…"}
                                            {r.status === "error" && "No match yet — try map"}
                                        </Typography>
                                    </Stack>
                                </Box>
                            ))}
                        </Stack>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose}>Done</Button>
                    <Button onClick={geocodeAllUnresolvedNow} variant="contained" disabled={workingAuto || unresolvedCount === 0}>
                        Auto-try all unresolved
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}