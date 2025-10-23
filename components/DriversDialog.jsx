"use client";

import * as React from "react";
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, Box, Typography
} from "@mui/material";
import Link from "next/link";
import dynamic from "next/dynamic";
const DriversMapLeaflet = dynamic(() => import("./DriversMapLeaflet"), { ssr: false });

import ManualGeocodeDialog from "./ManualGeocodeDialog";
import { exportRouteLabelsPDF } from "../utils/pdfRouteLabels";

// NEW: MUI pieces for the history dropdown
import { FormControl, InputLabel, MenuItem, Select } from "@mui/material";

/* =================== helpers / palette =================== */
const palette = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#17becf", "#bcbd22", "#393b79",
    "#ad494a", "#637939", "#ce6dbd", "#8c6d31", "#7f7f7f",
];

const nameOf = (u = {}) => {
    const n = u.name ?? u.fullName ?? `${u.first ?? ""} ${u.last ?? ""}`.trim();
    if (n) return n;
    const addr = `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim();
    return addr || "Unnamed";
};

/* ========= complex detection (unchanged) ========= */
const toBool = (v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        return s === "true" || s === "1" || s === "yes" || s === "y";
    }
    return false;
};
const displayNameLoose = (u = {}) => {
    const cands = [
        u.name, u.fullName,
        `${u.first ?? ""} ${u.last ?? ""}`.trim(),
        `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
        u?.user?.name,
        `${u?.user?.first ?? ""} ${u?.user?.last ?? ""}`.trim(),
    ].filter(Boolean);
    return cands[0] || "";
};
const normalize = (s) =>
    String(s || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .trim();
const normalizePhone = (s) => String(s || "").replace(/\D+/g, "").replace(/^1/, "");
const normalizeAddr = (u = {}) =>
    normalize([u.address || u.addr || "", u.apt || u.unit || "", u.city || "", u.state || "", u.zip || ""].filter(Boolean).join(", "));
const llKey = (u) => {
    const lat = typeof u.lat === "number" ? u.lat : u.latitude;
    const lng = typeof u.lng === "number" ? u.lng : u.longitude;
    const lk = Number.isFinite(lat) ? lat.toFixed(4) : "";
    const gk = Number.isFinite(lng) ? lng.toFixed(4) : "";
    return `${lk}|${gk}`;
};
function buildComplexIndex(users = []) {
    const idSet = new Set();
    const nameSet = new Set();
    const phoneSet = new Set();
    const addrSet = new Set();
    const llSet = new Set();

    for (const u of users) {
        const isCx =
            toBool(u?.complex) ||
            toBool(u?.isComplex) ||
            toBool(u?.flags?.complex) ||
            toBool(u?.user?.complex) ||
            toBool(u?.User?.complex) ||
            toBool(u?.client?.complex);
        if (!isCx) continue;

        if (u.id != null) idSet.add(String(u.id));
        const nm = normalize(displayNameLoose(u));
        if (nm) nameSet.add(nm);
        const ph = normalizePhone(u.phone);
        if (ph) phoneSet.add(ph);
        const ak = normalizeAddr(u);
        if (ak) addrSet.add(ak);
        const ll = llKey(u);
        if (ll !== "|") llSet.add(ll);
    }
    return { idSet, nameSet, phoneSet, addrSet, llSet };
}
function markStopComplex(stop, idx, idxs) {
    const s = stop || {};
    const direct =
        toBool(s?.complex) ||
        toBool(s?.isComplex) ||
        toBool(s?.flags?.complex) ||
        toBool(s?.user?.complex) ||
        toBool(s?.User?.complex) ||
        toBool(s?.client?.complex);
    if (direct) return { ...s, complex: true, __complexSource: "stop.direct" };

    const ids = [
        s.userId, s.userID, s.userid, s?.user?.id, s?.User?.id, s?.client?.id, s.id,
    ].map(v => (v == null ? null : String(v))).filter(Boolean);
    for (const id of ids) {
        if (idxs.idSet.has(id)) return { ...s, complex: true, __complexSource: "user.id" };
    }

    const nm = normalize(displayNameLoose(s));
    if (nm && idxs.nameSet.has(nm)) return { ...s, complex: true, __complexSource: "user.name" };

    const ph = normalizePhone(s.phone || s?.user?.phone);
    if (ph && idxs.phoneSet.has(ph)) return { ...s, complex: true, __complexSource: "user.phone" };

    const ak = normalizeAddr(s);
    if (ak && idxs.addrSet.has(ak)) return { ...s, complex: true, __complexSource: "user.addr" };

    const ll = llKey(s);
    if (ll !== "|" && idxs.llSet.has(ll)) return { ...s, complex: true, __complexSource: "user.latlng" };

    return { ...s, complex: false, __complexSource: "none" };
}

/* ===== driver numbering helpers (keep Driver 0 first) ===== */
const parseDriverNum = (name) => {
    const m = /driver\s+(\d+)/i.exec(String(name || ""));
    return m ? parseInt(m[1], 10) : null;
};
const rankForRoute = (route, idxFallback = 0) => {
    const n = parseDriverNum(route?.driverName || route?.name);
    return Number.isFinite(n) ? n : idxFallback;
};

/* ======================================================== */

export default function DriversDialog({
                                          open,
                                          onClose,
                                          users = [],
                                          initialDriverCount = 6,
                                          initialSelectedDay = "all",
                                          onUsersPatched,
                                      }) {
    const [driverCount, setDriverCount] = React.useState(Number(initialDriverCount || 6));
    const [selectedDay] = React.useState(initialSelectedDay || "all");

    const [routes, setRoutes] = React.useState([]);
    const [unrouted, setUnrouted] = React.useState([]);

    const [mapOpen, setMapOpen] = React.useState(false);
    const [busy, setBusy] = React.useState(false);

    // NEW: last runs
    const [runs, setRuns] = React.useState([]); // [{id, createdAtISO}]
    const [selectedRunId, setSelectedRunId] = React.useState("");

    // Map API reference (set once via onExpose)
    const mapApiRef = React.useRef(null);

    // Stats coming from the map (selected count, etc.)
    const [stats, setStats] = React.useState({ selectedCount: 0, totalAssigned: 0, unroutedVisible: 0, indexItems: [] });

    // Manual geocode dialog
    const [missingBatch, setMissingBatch] = React.useState([]);
    const [manualOpen, setManualOpen] = React.useState(false);

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

    // NEW: fetch last 10 runs
    const fetchRuns = React.useCallback(async () => {
        try {
            const res = await fetch(`/api/route/runs?day=${selectedDay}`, { cache: "no-store" });
            const data = await res.json();
            setRuns(Array.isArray(data.runs) ? data.runs : []);
        } catch (e) {
            console.error("Failed to load runs:", e);
            setRuns([]);
        }
    }, [selectedDay]);

    React.useEffect(() => {
        if (!open) return;
        const missing = users.filter(u => (u.lat ?? u.latitude) == null || (u.lng ?? u.longitude) == null);
        setMissingBatch(missing);
        setMapOpen(true);
        loadRoutes();
        fetchRuns(); // NEW
    }, [open, users, loadRoutes, fetchRuns]);

    async function handleManualGeocoded(updates) {
        try {
            await Promise.all(
                updates.map(({ id, lat, lng, ...rest }) =>
                    fetch(`/api/users/${id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ lat, lng, cascadeStops: true, ...rest }),
                    }).then(async (r) => {
                        if (!r.ok) throw new Error(await r.text().catch(() => `HTTP ${r.status}`));
                    })
                )
            );
            onUsersPatched?.(updates);
            setMissingBatch((prev) => prev.filter((u) => !updates.some((x) => x.id === u.id)));
        } catch (err) {
            console.error("Manual geocode save failed:", err);
            alert("Save failed: " + (err.message || "Unknown error"));
        }
    }

    /* ============================================================
     *  📌 ADD: SAVE-CURRENT RUN HELPER (big block you can search for)
     * ============================================================ */
    /* ============================================================
 *  📌 ADD: SAVE-CURRENT RUN HELPER (targets selected run when present)
 * ============================================================ */
    const saveTimerRef = React.useRef(null);
    const saveCurrentRun = React.useCallback((immediate = false) => {
        const doPost = async () => {
            try {
                await fetch("/api/route/runs/save-current", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    // send selectedRunId so we overwrite THAT run
                    body: JSON.stringify({
                        day: selectedDay,
                        runId: selectedRunId ? Number(selectedRunId) : undefined,
                    }),
                });
            } catch (e) {
                console.warn("save-current failed:", e);
            }
        };
        if (immediate) {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            doPost();
            return;
        }
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(doPost, 800); // debounce rapid edits
    }, [selectedDay, selectedRunId]);
    /* ============================================================ */
    /* ============================================================ */

    // === Single reassign used by the map for individual popup assigns ===
    const handleReassign = React.useCallback(async (stop, toDriverId) => {
        const toId = Number(toDriverId);
        // optimistic local UI (in dialog routes copy)
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
        if (!stop.__driverId) {
            setUnrouted(prev => prev.filter(u => String(u.id) !== String(stop.id)));
        }

        try {
            const res = await fetch("/api/route/reassign", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    day: selectedDay,
                    toDriverId: toId,
                    stopId: Number(stop.id),
                    userId: Number(stop.userId) || undefined
                }),
            });
            if (!res.ok) throw new Error(await res.text());

            /* ============================
             *  📌 CALL SAVE-CURRENT HERE
             * ============================ */
            saveCurrentRun(); // debounced after single assign

        } catch (e) {
            console.error("Reassign failed:", e);
            await loadRoutes();
            alert("Reassign didn’t save. View refreshed.");
        }
    }, [selectedDay, loadRoutes, saveCurrentRun]);

    // Map-facing drivers (kept in sync with dialog routes)
    const mapDrivers = React.useMemo(() => {
        return (routes || []).map((r, i) => {
            const driverId = Number(r.driverId ?? r.id);
            const color = r.color || palette[i % palette.length];
            const dname = r.driverName || r.name || `Driver ${i}`;
            const stops = (r.stops || [])
                .map((u, idx) => ({
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
                }))
                .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
            return { id: String(driverId), driverId, name: dname, color, polygon: [], stops };
        });
    }, [routes]);

    const routeStops = React.useMemo(() => routes.map(r => (r.stops || [])), [routes]);
    const driverColors = React.useMemo(() => routes.map((r, i) => r.color || palette[i % palette.length]), [routes]);

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

    // NEW: format ISO -> "M/D h:mma"
    function fmt(iso) {
        try {
            const d = new Date(iso);
            const mo = d.getMonth() + 1;
            const da = d.getDate();
            let h = d.getHours();
            const m = String(d.getMinutes()).padStart(2, "0");
            const ampm = h >= 12 ? "PM" : "AM";
            h = h % 12 || 12;
            return `${mo}/${da} ${h}:${m}${ampm}`;
        } catch {
            return iso || "";
        }
    }

// NEW: regenerate routes (fresh version)
    async function regenerateRoutes() {
        const countStr = window.prompt("How many drivers for the new route?", String(driverCount));
        if (countStr == null) return;
        const count = Number(countStr);
        if (!Number.isFinite(count) || count <= 0) {
            alert("Enter a valid number.");
            return;
        }

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

            // Refresh map data
            await loadRoutes();

            // Refresh the history dropdown (server already prunes to last 10)
            await fetchRuns();

            // ✅ Make the newest run the active one so subsequent edits save back to it
            try {
                const r = await fetch(`/api/route/runs?day=${selectedDay}`, { cache: "no-store" });
                const d = await r.json();
                if (Array.isArray(d.runs) && d.runs.length > 0) {
                    // API returns newest first (createdAt desc)
                    setSelectedRunId(String(d.runs[0].id));
                }
            } catch (selErr) {
                console.warn("Could not set newest run as active:", selErr);
            }

            // No saveCurrentRun() here; generate already created a new RouteRun row.
        } catch (e) {
            console.error(e);
            alert("Failed to regenerate.");
        } finally {
            setBusy(false);
        }
    }
    async function resetAllRoutes() {
        if (!routes.length) return;
        const ok = window.confirm(`Reset ALL routes for "${selectedDay}"? This will clear completed flags.`);
        if (!ok) return;

        const driverIds = Array.from(new Set(routes.map(r => r.driverId).filter(Boolean)));
        setBusy(true);
        try {
            await Promise.all(driverIds.map(id =>
                fetch("/api/route/reset", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ driverId: id, day: selectedDay, clearProof: false }),
                })
            ));
            await loadRoutes();

            /* ============================
             *  📌 CALL SAVE-CURRENT HERE
             * ============================ */
            saveCurrentRun(true); // immediate after bulk change

        } catch (e) {
            console.error(e);
            alert("Failed to reset routes.");
        } finally {
            setBusy(false);
        }
    }

    async function optimizeAllRoutes() {
        if (!routes.length) return;
        const driverIds = Array.from(new Set(routes.map(r => r.driverId).filter(Boolean)));
        setBusy(true);
        try {
            await Promise.all(driverIds.map(id =>
                fetch("/api/route/optimize", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ driverId: id, day: selectedDay }),
                })
            ));
            await loadRoutes();

            /* ============================
             *  📌 CALL SAVE-CURRENT HERE
             * ============================ */
            saveCurrentRun(true); // immediate after bulk change

        } catch (e) {
            console.error(e);
            alert("Failed to optimize routes.");
        } finally {
            setBusy(false);
        }
    }

    // ===== PDF helpers (unchanged but referenced) =====
    const buildSortedForLabels = React.useCallback(() => {
        const meta = (routes || []).map((r, i) => ({
            i,
            num: rankForRoute(r, i),
            color: r?.color,
            name: r?.driverName || r?.name || `Driver ${i}`,
        }));
        meta.sort((a, b) => {
            const aa = Number.isFinite(a.num) ? a.num : a.i;
            const bb = Number.isFinite(b.num) ? b.num : b.i;
            return aa - bb || a.i - b.i;
        });
        const colorsSorted = meta.map((m, idx) => m.color || driverColors[m.i] || palette[idx % palette.length]);
        const enrichedSorted = meta.map((m, newIdx) => {
            const driverNum = Number.isFinite(m.num) ? m.num : newIdx;
            const driverName = `Driver ${driverNum}`;
            const arr = (routeStops[m.i] || []);
            return arr.map((s, si) => ({
                ...s,
                __driverNumber: driverNum,
                __driverName: driverName,
                __stopIndex: si,
            }));
        });
        return { enrichedSorted, colorsSorted };
    }, [routes, routeStops, driverColors]);

    // NEW: apply a selected run
    // NEW: apply a selected run (fresh version)
    async function applyRun(id) {
        if (!id) return;
        const ok = window.confirm("Apply this saved route? This will overwrite current assignments.");
        if (!ok) return;

        try {
            setBusy(true);

            const res = await fetch("/api/route/apply-run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ runId: Number(id) }),
            });
            if (!res.ok) throw new Error(await res.text());

            // ✅ Mark the applied run as the "active" run so future edits save back to THIS run
            setSelectedRunId(String(id));

            // Refresh current assignments from DB
            await loadRoutes();

            // NOTE: Do NOT call saveCurrentRun() here.
            // We want to keep history immutable; only your subsequent edits should save back to this run.
        } catch (e) {
            console.error(e);
            alert("Failed to apply route.");
        } finally {
            setBusy(false);
        }
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
                <DialogTitle sx={{ pb: 1 }}>
                    <Box
                        sx={{
                            display: "grid",
                            gridTemplateColumns: "1fr auto 1fr",
                            alignItems: "center",
                            gap: 1,
                        }}
                    >
                        {/* LEFT: Title + history dropdown */}
                        <Box sx={{ justifySelf: "start", fontWeight: 600, display: "flex", alignItems: "center", gap: 1 }}>
                            <span>Routes Map</span>

                            {/* NEW: Last 10 Runs dropdown */}
                            <FormControl size="small" sx={{ minWidth: 220 }}>
                                <InputLabel id="route-run-label">Last 10 Routes</InputLabel>
                                <Select
                                    labelId="route-run-label"
                                    label="Last 10 Routes"
                                    value={selectedRunId}
                                    onChange={(e) => {
                                        const id = String(e.target.value || "");
                                        setSelectedRunId(id);
                                        if (id) applyRun(id);
                                    }}
                                    disabled={busy || runs.length === 0}
                                >
                                    {runs.map(r => (
                                        <MenuItem key={r.id} value={String(r.id)}>
                                            {fmt(r.createdAt)}
                                        </MenuItem>
                                    ))}
                                    {runs.length === 0 && <MenuItem value="" disabled>(No history)</MenuItem>}
                                </Select>
                            </FormControl>
                        </Box>

                        {/* CENTER: generate */}
                        <Button
                            onClick={regenerateRoutes}
                            variant="contained"
                            color="error"
                            disabled={busy}
                            sx={{ justifySelf: "center", fontWeight: 700, borderRadius: 2 }}
                        >
                            Generate New Route
                        </Button>

                        {/* RIGHT: link */}
                        <Box sx={{ justifySelf: "end" }}>
                            <Link
                                href="/drivers"
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: 12, color: "#4b5563", textDecoration: "none" }}
                                onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                                onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                            >
                                Drivers →
                            </Link>
                        </Box>
                    </Box>
                </DialogTitle>

                <DialogContent dividers sx={{ position: "relative", p: 0 }}>
                    <Box sx={{ height: "100%", width: "100%", position: "relative" }}>
                        <DriversMapLeaflet
                            drivers={mapDrivers}
                            unrouted={unrouted}
                            onReassign={handleReassign}
                            busy={busy}
                            onExpose={(api) => { mapApiRef.current = api || null; }}
                            onComputedStats={(s) => setStats(s)}
                            initialCenter={[40.7128, -74.006]}
                            initialZoom={5}
                        />
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
                                const idxs = buildComplexIndex(users);
                                const complexMarked = (routeStops || []).map((stops) =>
                                    (stops || []).map((s, si) => markStopComplex(s, si, idxs))
                                );
                                const { enrichedSorted, colorsSorted } = buildSortedForLabels();
                                const complexById = new Map();
                                complexMarked.forEach(route => route.forEach(s => complexById.set(String(s.id), s)));
                                const stampedWithComplex = enrichedSorted.map(route =>
                                    route.map(s => {
                                        const cm = complexById.get(String(s.id));
                                        return cm ? { ...s, complex: cm.complex, __complexSource: cm.__complexSource } : s;
                                    })
                                );
                                await exportRouteLabelsPDF(stampedWithComplex, colorsSorted, tsString);
                            } finally {
                                setBusy(false);
                            }
                        }}
                        variant="outlined"
                        disabled={busy || !hasRoutes}
                    >
                        Download Labels
                    </Button>

                    <Button onClick={resetAllRoutes} variant="outlined" disabled={busy || !hasRoutes}>
                        Reset All Routes
                    </Button>

                    <Button onClick={optimizeAllRoutes} variant="outlined" disabled={busy || !hasRoutes}>
                        Optimize All Routes
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}