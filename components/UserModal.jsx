// components/UserModal.jsx
"use client";

import React from "react";
import {
    Dialog, TextField, Button, Stack, Typography, Box,
    Collapse, List, ListItemButton, ListItemText, LinearProgress
} from "@mui/material";

import MapConfirmDialog from "./MapConfirmDialog";
import { geocodeOneClient, searchGeocodeCandidates } from "../utils/geocodeOneClient";
import { buildGeocodeQuery } from "../utils/addressHelpers";

const DAYS = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
const ALL_TRUE = DAYS.reduce((a,d)=> (a[d]=true,a), {});
const ALL_FALSE = DAYS.reduce((a,d)=> (a[d]=false,a), {});

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
        medicaid: !!u.medicaid,
        paused: !!u.paused,
        complex: !!u.complex,
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

    React.useEffect(() => {
        if (!open) return;
        const base = editingUser ? normalizeUser(editingUser) : normalizeUser({});
        setForm(base);
        setGeoBusy(false);
        setGeoErr("");
        setCandsOpen(false);
        setCands([]);
        setHint(null);
    }, [open, editingUser]);

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
    const setSched = (k, v) => setForm(f => ({ ...f, schedule: { ...f.schedule, [k]: v }}));

    async function tryAutoGeocode() {
        setGeoBusy(true);
        setGeoErr("");
        setCandsOpen(false);
        setCands([]);
        setHint(null);

        const qStrict = buildGeocodeQuery({
            address: form.address,
            city: form.city, state: form.state, zip: form.zip,
        }) || streetQueryNoUnit(form);

        try {
            const a = await geocodeOneClient(qStrict);
            setForm(f => ({ ...f, lat: a.lat, lng: a.lng }));
            setGeoBusy(false);
            return true;
        } catch {
            const qLoose = streetQueryNoUnit({ address: form.address, city: form.city, state: form.state, zip: "" });
            try {
                const a2 = await geocodeOneClient(qLoose);
                setForm(f => ({ ...f, lat: a2.lat, lng: a2.lng }));
                setGeoBusy(false);
                return true;
            } catch (e2) {
                setGeoErr(e2?.message || "Address not found");
                setGeoBusy(false);
                await openSuggestions();
                return false;
            }
        }
    }

    async function openSuggestions() {
        setCandsOpen(true);
        setCands([]);
        setGeoBusy(true);
        setGeoErr("");
        try {
            const q = streetQueryNoUnit(form);
            const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(q)}&limit=8`, { cache: "no-store" });
            const data = await res.json();
            setCands(Array.isArray(data?.items) ? data.items : []);
            setHint({ shownFor: q, queryUsed: data?.queryUsed || q });
        } catch (e) {
            setGeoErr(e?.message || "Suggestion lookup failed");
        } finally {
            setGeoBusy(false);
        }
    }

    function pickCandidate(item) {
        if (!Number.isFinite(Number(item?.lat)) || !Number.isFinite(Number(item?.lng))) return;
        setForm(f => ({ ...f, lat: Number(item.lat), lng: Number(item.lng) }));
        setCandsOpen(false);
        setGeoErr("");
    }

    async function onMapConfirm({ lat, lng }) {
        setForm(f => ({ ...f, lat, lng }));
        setMapOpen(false);
        setGeoErr("");
    }

    const handleSave = async () => {
        try {
            const isEdit = !!form.id;

            if (!isEdit && !(typeof form.lat === "number" && typeof form.lng === "number")) {
                const ok = await tryAutoGeocode();
                if (!ok) {
                    alert("Pick a location (suggestion or map) before creating.");
                    return;
                }
            }

            const method = isEdit ? "PUT" : "POST";
            const url = isEdit ? `/api/users/${form.id}` : "/api/users";
            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            });
            if (!res.ok) throw new Error(await res.text());
            const saved = await res.json().catch(() => ({}));

            // Seed as UNROUTED for this day if new & geocoded
            if (!isEdit && typeof form.lat === "number" && typeof form.lng === "number") {
                const newStops = [{
                    userId: saved?.id ?? form.id,
                    name: `${form.first ?? ""} ${form.last ?? ""}`.trim(),
                    address: `${form.address ?? ""}`.trim(),
                    apt: form.apt ?? null,
                    city: form.city ?? "", state: form.state ?? "", zip: form.zip ?? "",
                    phone: form.phone ?? null, dislikes: form.dislikes ?? null,
                    lat: form.lat, lng: form.lng,
                }];
                await fetch("/api/route/auto-assign", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ day: selectedDay || "all", newStops }),
                }).catch(() => {});
            }

            onSaved?.();
            onClose?.();
        } catch (e) {
            console.error(e);
            alert("Save failed");
        }
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
            <div style={{ padding: 16 }}>
                <h3 style={{ marginTop: 0 }}>
                    {form.id ? "Edit Client" : "Add Client"}
                </h3>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <TextField label="First" value={form.first} onChange={(e) => set("first", e.target.value)} />
                    <TextField label="Last"  value={form.last}  onChange={(e) => set("last", e.target.value)} />
                    <TextField label="Address" value={form.address} onChange={(e) => set("address", e.target.value)} />
                    <TextField label="Apt"     value={form.apt}     onChange={(e) => set("apt", e.target.value)} />
                    <TextField label="City"    value={form.city}    onChange={(e) => set("city", e.target.value)} />
                    <TextField label="State"   value={form.state}   onChange={(e) => set("state", e.target.value)} />
                    <TextField label="ZIP"     value={form.zip}     onChange={(e) => set("zip", e.target.value)} />
                    <TextField label="Phone"   value={form.phone}   onChange={(e) => set("phone", e.target.value)} />
                    <TextField label="County"  value={form.county}  onChange={(e) => set("county", e.target.value)} />
                    <TextField label="Dislikes" value={form.dislikes} onChange={(e) => set("dislikes", e.target.value)} />
                </div>

                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {DAYS.map(d => (
                        <label key={d} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <input
                                type="checkbox"
                                checked={!!form.schedule?.[d]}
                                onChange={(e) => setSched(d, e.target.checked)}
                            />
                            {d.slice(0,3).toUpperCase()}
                        </label>
                    ))}
                </div>

                {/* Geocode */}
                <Box sx={{ mt: 2, p: 1.5, border: "1px solid #eee", borderRadius: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography variant="subtitle2">Location</Typography>
                        {geoBusy && <LinearProgress sx={{ width: 120 }} />}
                        <Box sx={{ flex: 1 }} />
                        <Button size="small" variant="outlined" onClick={() => tryAutoGeocode()} disabled={geoBusy}>
                            Auto geocode
                        </Button>
                        <Button size="small" onClick={openSuggestions} disabled={geoBusy}>
                            See suggestions
                        </Button>
                        <Button size="small" onClick={() => setMapOpen(true)} disabled={geoBusy}>
                            Select on map
                        </Button>
                    </Stack>

                    {typeof form.lat === "number" && typeof form.lng === "number" ? (
                        <Typography variant="caption" sx={{ mt: 1, display: "block", color: "#2e7d32" }}>
                            ✓ Geocoded: {form.lat.toFixed(6)}, {form.lng.toFixed(6)}
                        </Typography>
                    ) : (
                        <Typography variant="caption" sx={{ mt: 1, display: "block", opacity: 0.75 }}>
                            Not geocoded yet.
                        </Typography>
                    )}

                    {!!geoErr && (
                        <Typography variant="caption" sx={{ mt: 0.5, display: "block", color: "#d32f2f" }}>
                            {geoErr}
                        </Typography>
                    )}

                    {hint && hint.queryUsed && hint.shownFor && hint.queryUsed !== hint.shownFor && (
                        <Typography variant="caption" sx={{ display: "block", mt: 0.5, opacity: 0.8 }}>
                            Showing results for <b>{hint.queryUsed}</b>. Search instead for <b>{hint.shownFor}</b>.
                        </Typography>
                    )}

                    <Collapse in={candsOpen} unmountOnExit>
                        <Box sx={{ mt: 1, border: "1px dashed #ccc", borderRadius: 1, maxHeight: 220, overflow: "auto" }}>
                            {cands.length ? (
                                <List dense>
                                    {cands.map((c, idx) => (
                                        <ListItemButton key={idx} onClick={() => pickCandidate(c)}>
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

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                    <Button onClick={onClose}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleSave}
                        disabled={geoBusy || (!form.id && !(typeof form.lat === "number" && typeof form.lng === "number"))}
                        title={!form.id && !(typeof form.lat === "number" && typeof form.lng === "number")
                            ? "Pick a location first"
                            : undefined}
                    >
                        {form.id ? "Save Changes" : "Create"}
                    </Button>
                </div>
            </div>

            <MapConfirmDialog
                open={mapOpen}
                onClose={() => setMapOpen(false)}
                initialQuery={streetQueryNoUnit(form)}
                onConfirm={onMapConfirm}
            />
        </Dialog>
    );
}