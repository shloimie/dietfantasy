"use client";

import * as React from "react";
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, Box, Typography, LinearProgress
} from "@mui/material";
import Link from "next/link";
import dynamic from "next/dynamic";
const DriversMapLeaflet = dynamic(() => import("./DriversMapLeaflet"), { ssr: false });

import ManualGeocodeDialog from "./ManualGeocodeDialog";
// ⬇️ Restore the original labels renderer so names & tiny numbers render as before
import { exportRouteLabelsPDF } from "../utils/pdfRouteLabels";

/* =================== helpers / palette =================== */
const palette = [
    "#1f77b4","#ff7f0e","#2ca02c",
    "#d62728","#9467bd",
    "#8c564b","#e377c2",
    "#fc9003","#bcbd22","#17becf"
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
        u.name,
        u.fullName,
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

    React.useEffect(() => {
        if (!open) return;
        const missing = users.filter(u => (u.lat ?? u.latitude) == null || (u.lng ?? u.longitude) == null);
        setMissingBatch(missing);
        setMapOpen(true);
        loadRoutes();
    }, [open, users, loadRoutes]);

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
        } catch (e) {
            console.error("Reassign failed:", e);
            await loadRoutes();
            alert("Reassign didn’t save. View refreshed.");
        }
    }, [selectedDay, loadRoutes]);

    // Map-facing drivers (kept in sync with dialog routes)
    const mapDrivers = React.useMemo(() => {
        return (routes || []).map((r, i) => {
            // make sure we always have a numeric, unique driverId
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

                    // IMPORTANT: tag the stop with the numeric owner driver id
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

    async function regenerateRoutes() {
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
        } catch (e) {
            console.error(e);
            alert("Failed to optimize routes.");
        } finally {
            setBusy(false);
        }
    }

    // ===== Sort routes so Driver 0 is first; propagate numbers to stops for PDF =====
// ===== Sort routes so Driver 0 is first; propagate numbers & names to stops for PDF =====
    const parseDriverNum = (name) => {
        const m = /driver\s+(\d+)/i.exec(String(name || ""));
        return m ? parseInt(m[1], 10) : null;
    };
    const rankForRoute = (route, idxFallback = 0) => {
        const n = parseDriverNum(route?.driverName || route?.name);
        return Number.isFinite(n) ? n : idxFallback;
    };

    const buildSortedForLabels = React.useCallback(() => {
        // Build sortable meta
        const meta = (routes || []).map((r, i) => ({
            i,
            num: rankForRoute(r, i),                 // numeric driver rank if present
            color: r?.color,
            name: r?.driverName || r?.name || `Driver ${i}`,
        }));

        // Sort: Driver 0, 1, 2 … (fallback to index when missing)
        meta.sort((a, b) => {
            const aa = Number.isFinite(a.num) ? a.num : a.i;
            const bb = Number.isFinite(b.num) ? b.num : b.i;
            return aa - bb || a.i - b.i;
        });

        // Colors in sorted order (fallback palette)
        const colorsSorted = meta.map((m, idx) => m.color || driverColors[m.i] || palette[idx % palette.length]);

        // Stamp zero-based driver number AND explicit "Driver X" name on each stop
        const enrichedSorted = meta.map((m, newIdx) => {
            const driverNum = Number.isFinite(m.num) ? m.num : newIdx; // zero-based
            const driverName = `Driver ${driverNum}`;
            const arr = (routeStops[m.i] || []);
            return arr.map((s, si) => ({
                ...s,
                __driverNumber: driverNum,          // 0-based; if the PDF does (+1), you still get 0 -> 1 only if they add; we override name too
                __driverName: driverName,           // force exact label text “Driver 0/1/…”
                __stopIndex: si,                    // 0-based stop index (PDF usually renders 1-based for readability)
            }));
        });

        return { enrichedSorted, colorsSorted };
    }, [routes, routeStops, driverColors]);
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
                        <Box sx={{ justifySelf: "start", fontWeight: 600 }}>Routes Map</Box>

                        <Button
                            onClick={regenerateRoutes}
                            variant="contained"
                            color="error"
                            disabled={busy}
                            sx={{ justifySelf: "center", fontWeight: 700, borderRadius: 2 }}
                        >
                            Generate New Route
                        </Button>

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

                        {/*{busy && (*/}
                        {/*    <Box*/}
                        {/*        sx={{*/}
                        {/*            position: "absolute", inset: 0, display: "flex",*/}
                        {/*            alignItems: "flex-start", justifyContent: "center",*/}
                        {/*            pointerEvents: "none", background: "rgba(255,255,255,0.35)"*/}
                        {/*        }}*/}
                        {/*    >*/}
                        {/*        <Box sx={{ mt: 2 }}>*/}
                        {/*            <LinearProgress sx={{ width: 260 }} />*/}
                        {/*            <Typography variant="caption" sx={{ display: "block", textAlign: "center", mt: 0.5, opacity: 0.8 }}>*/}
                        {/*                Loading…*/}
                        {/*            </Typography>*/}
                        {/*        </Box>*/}
                        {/*    </Box>*/}
                        {/*)}*/}
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

                    {/* Download Labels — use pdfRouteLabels with sorted order & stamped numbers */}
                    <Button
                        onClick={async () => {
                            setBusy(true);
                            try {
                                // 1) Mark complex flags on the original stops (keeps names/phones intact)
                                const idxs = buildComplexIndex(users);
                                const complexMarked = (routeStops || []).map((stops) =>
                                    (stops || []).map((s, si) => markStopComplex(s, si, idxs))
                                );

                                // 2) Sort routes so Driver 0 is first and stamp driverNumber/driverName/stopIndex
                                const { enrichedSorted, colorsSorted } = buildSortedForLabels();

                                // 3) Merge complex flags back into the stamped objects by stop id
                                const complexById = new Map();
                                complexMarked.forEach(route => route.forEach(s => complexById.set(String(s.id), s)));

                                const stampedWithComplex = enrichedSorted.map(route =>
                                    route.map(s => {
                                        const cm = complexById.get(String(s.id));
                                        return cm ? { ...s, complex: cm.complex, __complexSource: cm.__complexSource } : s;
                                    })
                                );

                                // 4) Render with the original pdfRouteLabels (names + tiny numbers preserved)
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