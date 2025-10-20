// components/UserModal.jsx
"use client";

import React from "react";
import {
    Dialog, TextField, Button, Stack, Typography, Box,
    Collapse, List, ListItemButton, ListItemText, LinearProgress, Alert, Zoom,
    FormControlLabel, Checkbox, Divider
} from "@mui/material";
import DoneIcon from "@mui/icons-material/Done";
import MapConfirmDialog from "./MapConfirmDialog";
import { geocodeOneClient } from "../utils/geocodeOneClient";
import { buildGeocodeQuery } from "../utils/addressHelpers";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const ALL_TRUE = DAYS.reduce((a, d) => (a[d] = true, a), {});
const ALL_FALSE = DAYS.reduce((a, d) => (a[d] = false, a), {});

const EMPTY = {
    id: undefined,
    first: "", last: "",
    address: "", apt: "",
    city: "", county: "", zip: "", state: "",
    phone: "", dislikes: "",
    medicaid: false, paused: false, complex: false,
    schedule: { ...ALL_FALSE },
    lat: null, lng: null,
};

function normalizeUser(u = {}) {
    const isNew = !u.id;

    return {
        ...EMPTY,
        ...u,
        first: u.first ?? "",
        last: u.last ?? "",
        address: u.address ?? "",
        apt: u.apt ?? "",
        city: u.city ?? "",
        county: u.county ?? "",
        zip: u.zip ?? "",
        state: u.state ?? "",
        phone: u.phone ?? "",
        dislikes: u.dislikes ?? "",

        // ✅ Default Medicaid to true for new users
        medicaid: isNew ? !!(u.medicaid ?? true) : !!u.medicaid,

        // keep existing behavior for others (but safe defaults for new)
        paused: isNew ? !!(u.paused ?? false) : !!u.paused,
        complex: isNew ? !!(u.complex ?? false) : !!u.complex,

        // you already default new user schedule to all true
        schedule: u.id ? { ...ALL_FALSE, ...(u.schedule || {}) } : { ...ALL_TRUE },

        lat: typeof u.lat === "number" ? u.lat : (typeof u.latitude === "number" ? u.latitude : null),
        lng: typeof u.lng === "number" ? u.lng : (typeof u.longitude === "number" ? u.longitude : null),
    };
}

function streetQueryNoUnit({ address, city, state, zip }) {
    const parts = [address, city, state, zip].filter(Boolean);
    return parts.join(", ");
}

export default function UserModal({ open, onClose, onSaved, editingUser, selectedDay = "all" }) {
    const [form, setForm] = React.useState(EMPTY);
    const [geoBusy, setGeoBusy] = React.useState(false);
    const [geoErr, setGeoErr] = React.useState("");
    const [candsOpen, setCandsOpen] = React.useState(false);
    const [cands, setCands] = React.useState([]);
    const [hint, setHint] = React.useState(null);
    const [mapOpen, setMapOpen] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [geoSuccess, setGeoSuccess] = React.useState(false);

    // separate flag for background persisting lat/lng (doesn't block UI)
    const [geoPersisting, setGeoPersisting] = React.useState(false);

    const inflight = React.useRef(new Set());

    // --- helper: minimal PUT to persist lat/lng (and normalized address) for existing users
    async function persistLatLng(userId, geo) {
        if (!Number.isFinite(Number(userId))) return;
        setGeoPersisting(true);
        try {
            const res = await fetch(`/api/users/${userId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    lat: geo.lat, lng: geo.lng,
                    ...(geo.address ? { address: geo.address } : {}),
                    ...(geo.city ? { city: geo.city } : {}),
                    ...(geo.state ? { state: geo.state } : {}),
                    ...(geo.zip ? { zip: geo.zip } : {}),
                }),
            });
            // ignore response; non-blocking
        } catch (_) {
            // swallow error
        } finally {
            setGeoPersisting(false);
        }
    }

    const trackedFetch = async (input, init = {}) => {
        const ctrl = new AbortController();
        const sig = init.signal
            ? (() => { try { return AbortSignal.any([init.signal, ctrl.signal]); } catch { return ctrl.signal; } })()
            : ctrl.signal;
        inflight.current.add(ctrl);
        try {
            const timeout = setTimeout(() => ctrl.abort(), 10000);
            const res = await fetch(input, { ...init, signal: sig });
            clearTimeout(timeout);
            return res;
        } finally {
            inflight.current.delete(ctrl);
            setGeoBusy(false);
        }
    };

    const abortAll = () => {
        for (const ctrl of inflight.current) ctrl.abort();
        inflight.current.clear();
        setGeoBusy(false);
        setGeoErr("");
    };

    React.useEffect(() => {
        if (!open) return;
        const base = editingUser ? normalizeUser(editingUser) : normalizeUser({});
        setForm(base);
        setGeoBusy(false);
        setGeoErr("");
        setCandsOpen(false);
        setCands([]);
        setHint(null);
        setSaving(false);
        setGeoSuccess(false);
        setGeoPersisting(false);
        abortAll();
    }, [open, editingUser]);

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
    const setSched = (k, v) => setForm(f => ({ ...f, schedule: { ...f.schedule, [k]: v } }));

    async function tryAutoGeocode() {
        if (saving || geoBusy) return;
        setGeoBusy(true);
        setGeoErr("");
        setCandsOpen(false);
        setCands([]);
        setHint(null);
        setGeoSuccess(false);

        const qStrict = buildGeocodeQuery({
            address: form.address,
            city: form.city, state: form.state, zip: form.zip,
        }) || streetQueryNoUnit(form);

        try {
            const a = await geocodeOneClient(qStrict);
            setForm(f => ({ ...f, lat: a.lat, lng: a.lng }));
            if (form.id) {
                await persistLatLng(form.id, {
                    lat: a.lat, lng: a.lng,
                    address: form.address, city: form.city, state: form.state, zip: form.zip,
                });
            }
            setGeoSuccess(true);
            setTimeout(() => setGeoSuccess(false), 2000);
        } catch {
            try {
                const qLoose = streetQueryNoUnit({ address: form.address, city: form.city, state: form.state, zip: "" });
                const a2 = await geocodeOneClient(qLoose);
                setForm(f => ({ ...f, lat: a2.lat, lng: a2.lng }));
                if (form.id) {
                    await persistLatLng(form.id, {
                        lat: a2.lat, lng: a2.lng,
                        address: form.address, city: form.city, state: form.state, zip: form.zip,
                    });
                }
                setGeoSuccess(true);
                setTimeout(() => setGeoSuccess(false), 2000);
            } catch (e2) {
                setGeoErr("Address not found. Try suggestions or map selection.");
            }
        } finally {
            setGeoBusy(false);
        }
    }

    async function openSuggestions() {
        if (saving || geoBusy) return;
        setCandsOpen(true);
        setCands([]);
        setGeoBusy(true);
        setGeoErr("");
        try {
            const q = streetQueryNoUnit(form);
            const res = await trackedFetch(`/api/geocode/search?q=${encodeURIComponent(q)}&limit=8`, { cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP error ${res.status}`);
            const data = await res.json();
            setCands(Array.isArray(data?.items) ? data.items : []);
            setHint({ shownFor: q, queryUsed: data?.queryUsed || q });
        } catch (e) {
            if (e?.name !== "AbortError") {
                setGeoErr("Failed to load suggestions. Try again or use map.");
            }
        } finally {
            setGeoBusy(false);
        }
    }

    async function pickCandidate(item) {
        const lat = Number(item?.lat), lng = Number(item?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        setForm(f => ({ ...f, lat, lng }));
        setCandsOpen(false);
        setGeoErr("");
        if (form.id) {
            await persistLatLng(form.id, {
                lat, lng,
                address: form.address, city: form.city, state: form.state, zip: form.zip,
            });
        }
        setGeoSuccess(true);
        setTimeout(() => setGeoSuccess(false), 2000);
    }

    async function onMapConfirm({ lat, lng }) {
        setForm(f => ({ ...f, lat, lng }));
        setMapOpen(false);
        setGeoErr("");
        if (form.id) {
            await persistLatLng(form.id, {
                lat, lng,
                address: form.address, city: form.city, state: form.state, zip: form.zip,
            });
        }
        setGeoSuccess(true);
        setTimeout(() => setGeoSuccess(false), 2000);
    }

    const handleSave = async () => {
        if (saving || geoBusy) return;
        if (!form.id && !(typeof form.lat === "number" && typeof form.lng === "number")) {
            setGeoErr("Please geocode the address first (use Auto, Suggestions, or Map).");
            return;
        }
        setSaving(true);
        abortAll();

        try {
            const isEdit = !!form.id;
            const method = isEdit ? "PUT" : "POST";
            const url = isEdit ? `/api/users/${form.id}` : "/api/users";

            const payload = {
                first: form.first, last: form.last,
                address: form.address, apt: form.apt,
                city: form.city, county: form.county, state: form.state, zip: form.zip,
                phone: form.phone, dislikes: form.dislikes,
                medicaid: !!form.medicaid, paused: !!form.paused, complex: !!form.complex,
                schedule: form.schedule,
                ...(typeof form.lat === "number" ? { lat: form.lat } : {}),
                ...(typeof form.lng === "number" ? { lng: form.lng } : {}),
            };

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
            const saved = await res.json().catch(() => ({}));

            const newUserId = saved?.user?.id ?? saved?.id ?? form.id;

            if (!isEdit && typeof form.lat === "number" && typeof form.lng === "number") {
                const newStops = [{
                    userId: newUserId,
                    name: `${form.first ?? ""} ${form.last ?? ""}`.trim(),
                    address: `${form.address ?? ""}`.trim(),
                    apt: form.apt ?? null,
                    city: form.city ?? "", state: form.state ?? "", zip: form.zip ?? "",
                    phone: form.phone ?? null, dislikes: form.dislikes ?? null,
                    lat: form.lat, lng: form.lng,
                }];
                fetch("/api/route/auto-assign", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ day: selectedDay || "all", newStops }),
                }).catch(() => {});
            }

            onSaved?.();
            onClose?.();
        } catch (e) {
            console.error("Save error:", e);
            alert("Save failed: " + (e.message || "Unknown error"));
            setSaving(false);
        }
    };

    const handleDialogClose = (event, reason) => {
        if (saving && (reason === "backdropClick" || reason === "escapeKeyDown")) return;
        abortAll();
        onClose?.();
    };

    const createDisabled =
        saving || geoBusy || geoPersisting ||
        (!form.id && !(typeof form.lat === "number" && typeof form.lng === "number"));

    return (
        <Dialog
            open={open}
            onClose={handleDialogClose}
            fullWidth
            maxWidth="md"
            disableEscapeKeyDown={saving}
            sx={{ "& .MuiDialog-paper": { margin: 0, maxWidth: "90vw" } }}
        >
            <Box sx={{ padding: 2, opacity: saving ? 0.9 : 1, margin: 0 }}>
                <Typography variant="h6" sx={{ margin: 0 }}>
                    {form.id ? "Edit Client" : "Add Client"}
                </Typography>

                {/* Core fields */}
                <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5, mt: 2 }}>
                    <TextField label="First" value={form.first} onChange={(e) => set("first", e.target.value)} disabled={saving} />
                    <TextField label="Last" value={form.last} onChange={(e) => set("last", e.target.value)} disabled={saving} />
                    <TextField label="Address" value={form.address} onChange={(e) => set("address", e.target.value)} disabled={saving} />
                    <TextField label="Apt" value={form.apt} onChange={(e) => set("apt", e.target.value)} disabled={saving} />
                    <TextField label="City" value={form.city} onChange={(e) => set("city", e.target.value)} disabled={saving} />
                    <TextField label="State" value={form.state} onChange={(e) => set("state", e.target.value)} disabled={saving} />
                    <TextField label="ZIP" value={form.zip} onChange={(e) => set("zip", e.target.value)} disabled={saving} />
                    <TextField label="Phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} disabled={saving} />
                    <TextField label="County" value={form.county} onChange={(e) => set("county", e.target.value)} disabled={saving} />
                    <TextField label="Dislikes" value={form.dislikes} onChange={(e) => set("dislikes", e.target.value)} disabled={saving} />
                </Box>

                {/* Flags */}
                <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Flags</Typography>
                    <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" sx={{ opacity: saving ? 0.7 : 1, pointerEvents: saving ? "none" : "auto" }}>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={!!form.medicaid}
                                    onChange={(e) => set("medicaid", e.target.checked)}
                                    disabled={saving}
                                    size="small"
                                />
                            }
                            label="Medicaid"
                        />
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={!!form.paused}
                                    onChange={(e) => set("paused", e.target.checked)}
                                    disabled={saving}
                                    size="small"
                                />
                            }
                            label="Paused"
                        />
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={!!form.complex}
                                    onChange={(e) => set("complex", e.target.checked)}
                                    disabled={saving}
                                    size="small"
                                />
                            }
                            label="Complex"
                        />
                    </Stack>

                    {/* Helper messages */}
                    {!!form.paused && (
                        <Alert severity="info" sx={{ mt: 1 }}>
                            This client is <strong>paused</strong> and should be excluded from new routes.
                        </Alert>
                    )}
                    {!!form.complex && (
                        <Alert severity="warning" sx={{ mt: 1 }}>
                            This client is marked <strong>complex</strong>. They’ll print on the special Complex labels page.
                        </Alert>
                    )}
                </Box>

                {/* Schedule */}
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Weekly Schedule</Typography>
                <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", opacity: saving ? 0.7 : 1, pointerEvents: saving ? "none" : "auto" }}>
                    {DAYS.map(d => (
                        <label key={d} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <input
                                type="checkbox"
                                checked={!!form.schedule?.[d]}
                                onChange={(e) => setSched(d, e.target.checked)}
                                disabled={saving}
                            />
                            {d.slice(0, 3).toUpperCase()}
                        </label>
                    ))}
                </Box>

                {/* Geocoding */}
                <Box sx={{ mt: 2, p: 1.5, border: "1px solid #eee", borderRadius: 1, opacity: saving ? 0.7 : 1, margin: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography variant="subtitle2">Location</Typography>
                        {(geoBusy || geoPersisting) && <LinearProgress sx={{ width: 120 }} />}
                        <Box sx={{ flex: 1 }} />
                        <Button size="small" variant="outlined" onClick={tryAutoGeocode} disabled={geoBusy || saving}>
                            Auto Geocode
                        </Button>
                        <Button size="small" onClick={openSuggestions} disabled={geoBusy || saving}>
                            See Suggestions
                        </Button>
                        <Button size="small" onClick={() => setMapOpen(true)} disabled={geoBusy || saving}>
                            Select on Map
                        </Button>
                    </Stack>

                    {geoSuccess && (
                        <Zoom in={geoSuccess}>
                            <Box sx={{ display: "flex", alignItems: "center", mt: 1, color: "#2e7d32" }}>
                                <DoneIcon sx={{ mr: 0.5, transform: "scale(1.2)", transition: "transform 0.2s" }} />
                                <Typography variant="caption">Geocoded Successfully! 🎉</Typography>
                            </Box>
                        </Zoom>
                    )}

                    {typeof form.lat === "number" && typeof form.lng === "number" && !geoSuccess ? (
                        <Typography variant="caption" sx={{ mt: 1, display: "block", color: "#2e7d32" }}>
                            ✓ Geocoded: {form.lat.toFixed(6)}, {form.lng.toFixed(6)}
                            {geoPersisting ? " (saving…)" : ""}
                        </Typography>
                    ) : !geoSuccess ? (
                        <Typography variant="caption" sx={{ mt: 1, display: "block", opacity: 0.75 }}>
                            Not geocoded yet.
                        </Typography>
                    ) : null}

                    {!!geoErr && (
                        <Alert severity="error" sx={{ mt: 1 }}>
                            {geoErr}
                        </Alert>
                    )}

                    <Collapse in={candsOpen} unmountOnExit>
                        <Box sx={{ mt: 1, border: "1px dashed #ccc", borderRadius: 1, maxHeight: 220, overflow: "auto", margin: 0 }}>
                            {cands.length ? (
                                <List dense>
                                    {cands.map((c, idx) => (
                                        <ListItemButton key={idx} onClick={() => pickCandidate(c)} disabled={saving}>
                                            <ListItemText
                                                primary={c.label}
                                                secondary={`${Number(c.lat).toFixed(5)}, ${Number(c.lng).toFixed(5)} — ${c.provider}`}
                                            />
                                        </ListItemButton>
                                    ))}
                                </List>
                            ) : (
                                <Typography variant="caption" sx={{ p: 1, display: "block", opacity: 0.75 }}>
                                    No suggestions yet.
                                </Typography>
                            )}
                        </Box>
                    </Collapse>
                </Box>

                {/* Actions */}
                <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 2, margin: 0 }}>
                    <Button onClick={handleDialogClose} disabled={saving}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleSave}
                        disabled={createDisabled}
                        aria-busy={saving ? "true" : undefined}
                        title={createDisabled && !form.id ? "Please geocode the address first" : undefined}
                    >
                        {saving ? "Saving…" : (form.id ? "Save Changes" : "Create")}
                    </Button>
                </Box>
            </Box>

            <MapConfirmDialog
                open={mapOpen}
                onClose={() => { abortAll(); setMapOpen(false); }}
                initialQuery={streetQueryNoUnit(form)}
                onConfirm={onMapConfirm}
            />
        </Dialog>
    );
}