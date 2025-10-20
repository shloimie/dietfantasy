"use client";

import * as React from "react";
import Image from "next/image";
import { Box, Dialog, IconButton } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";

import UsersTable from "../components/UsersTable";
import ActionBar from "../components/ActionBar";
import UserModal from "../components/UserModal";
import CityColorsDialog from "../components/CityColorsDialog";
import DriversDialog from "../components/DriversDialog";
import DriversMap from "../components/DriversMap";

/* =========================
   Users API hook
   ========================= */
function useUsersApi() {
    const [users, setUsers] = React.useState([]);
    const [loading, setLoading] = React.useState(true);

    const onUsersPatched = React.useCallback((updates) => {
        setUsers((prev) =>
            prev.map((u) => {
                const hit = updates.find((x) => x.id === u.id);
                return hit ? { ...u, lat: hit.lat, lng: hit.lng } : u;
            })
        );
    }, []);

    const refetch = React.useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch("/api/users");
            const data = await res.json();
            setUsers(Array.isArray(data) ? data : data?.users || []);
        } catch (e) {
            console.error("Fetch /api/users failed", e);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        refetch();
    }, [refetch]);

    return { users, isLoading: loading, refetch, onUsersPatched };
}

/* =========================
   City colors (DB-backed)
   ========================= */
const norm = (s) => String(s || "").trim().toLowerCase();

function useCityColorsApi() {
    const [cityColors, setCityColors] = React.useState({});

    const fetchCityColors = React.useCallback(async () => {
        try {
            const res = await fetch("/api/city-colors", { cache: "no-store" });
            const rows = await res.json();
            const map = {};
            for (const r of rows || []) {
                const key = norm(r.city);
                const raw = String(r.color || "").trim();
                map[key] = raw.startsWith("#") ? raw : `#${raw}`;
            }
            setCityColors(map);
        } catch (e) {
            console.error("Failed to load city colors", e);
            setCityColors({});
        }
    }, []);

    const upsertCityColor = React.useCallback(
        async (city, hex) => {
            const body = {
                city,
                color: String(hex || "").trim().startsWith("#")
                    ? String(hex || "").trim()
                    : `#${String(hex || "").trim()}`,
            };
            await fetch("/api/city-colors", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            await fetchCityColors();
        },
        [fetchCityColors]
    );

    const removeCityColor = React.useCallback(
        async (city) => {
            await fetch("/api/city-colors", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ city }),
            });
            await fetchCityColors();
        },
        [fetchCityColors]
    );

    React.useEffect(() => {
        fetchCityColors();
    }, [fetchCityColors]);

    const getCityColor = React.useCallback(
        (city) => (city ? cityColors[norm(city)] || null : null),
        [cityColors]
    );

    return {
        cityColors,
        getCityColor,
        setCityColors,
        fetchCityColors,
        upsertCityColor,
        removeCityColor,
    };
}

/* =========================
   Timestamp for filenames
   ========================= */
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

/* =========================
   Complex detection (restored)
   ========================= */
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
        `${u.first ?? ""} ${u.last ?? ""}`.trim(),
        u.fullName,
        `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
        u?.user?.name,
        `${u?.user?.first ?? ""} ${u?.user?.last ?? ""}`.trim(),
    ].filter(Boolean);
    return cands[0] || "";
};
const normalizeName = (s) =>
    String(s || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .trim();
const normalizePhone = (s) => String(s || "").replace(/\D+/g, "").replace(/^1/, "");
const normalizeAddr = (u = {}) =>
    normalizeName(
        [u.address || u.addr || "", u.apt || u.unit || "", u.city || "", u.state || "", u.zip || ""]
            .filter(Boolean)
            .join(", ")
    );
const latKey = (lat) => (typeof lat === "number" ? lat.toFixed(4) : "");
const lngKey = (lng) => (typeof lng === "number" ? lng.toFixed(4) : "");
const latLngKey = (u) => `${latKey(u.lat ?? u.latitude)}|${lngKey(u.lng ?? u.longitude)}`;
function buildForceComplexIndex(users = []) {
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
        const nm = normalizeName(displayNameLoose(u));
        if (nm) nameSet.add(nm);
        const ph = normalizePhone(u.phone);
        if (ph) phoneSet.add(ph);
        const ak = normalizeAddr(u);
        if (ak) addrSet.add(ak);
        const ll = latLngKey(u);
        if (ll !== "|") llSet.add(ll);
    }
    return { idSet, nameSet, phoneSet, addrSet, llSet };
}
function markStopComplex(stop, forceIdx) {
    const s = stop || {};
    const direct =
        toBool(s?.complex) ||
        toBool(s?.isComplex) ||
        toBool(s?.flags?.complex) ||
        toBool(s?.user?.complex) ||
        toBool(s?.User?.complex) ||
        toBool(s?.client?.complex);
    if (direct) return { ...s, complex: true };
    const ids = [s.userId, s.userID, s.userid, s?.user?.id, s?.User?.id, s?.client?.id, s.id]
        .map((v) => (v == null ? null : String(v)))
        .filter(Boolean);
    for (const id of ids) if (forceIdx.idSet.has(id)) return { ...s, complex: true };
    const nm = normalizeName(displayNameLoose(s));
    if (nm && forceIdx.nameSet.has(nm)) return { ...s, complex: true };
    const ph = normalizePhone(s.phone || s?.user?.phone);
    if (ph && forceIdx.phoneSet.has(ph)) return { ...s, complex: true };
    const ak = normalizeAddr(s);
    if (ak && forceIdx.addrSet.has(ak)) return { ...s, complex: true };
    const ll = latLngKey(s);
    if (ll !== "|" && forceIdx.llSet.has(ll)) return { ...s, complex: true };
    return { ...s, complex: false };
}

/* =========================
   Page
   ========================= */
export default function UsersPage() {
    const { users, isLoading, refetch, onUsersPatched } = useUsersApi();

    const {
        cityColors,
        getCityColor,
        setCityColors,
        fetchCityColors,
        upsertCityColor,
        removeCityColor,
    } = useCityColorsApi();

    // Modals
    const [userModalOpen, setUserModalOpen] = React.useState(false);
    const [editingUser, setEditingUser] = React.useState(null);
    const [driversOpen, setDriversOpen] = React.useState(false);
    const [cityColorsOpen, setCityColorsOpen] = React.useState(false);

    // Map modal + data
    const [mapOpen, setMapOpen] = React.useState(false);
    const [mapData, setMapData] = React.useState({ routes: [], selectedDay: "all", driverCount: 6 });

    // Header shelf control (chin)
    const [openMore, setOpenMore] = React.useState(false);

    // Search + counters + visible rows (from table)
    const [search, setSearch] = React.useState("");
    const [visibleCount, setVisibleCount] = React.useState(0);
    const [visibleRows, setVisibleRows] = React.useState([]);

    // exports (operate on current visibleRows)
    const doExportExcel = React.useCallback(async () => {
        try {
            const mod = await import("../utils/excelExport");
            const fn = mod.default || mod.exportExcel || mod.exportUsersToExcel || mod.exportToExcel;
            if (typeof fn === "function") await fn(visibleRows, tsString);
        } catch (e) {
            console.error("Export Excel failed:", e);
        }
    }, [visibleRows]);

    const doExportClientsPdf = React.useCallback(async () => {
        try {
            const mod = await import("../utils/pdfClientList");
            const fn = mod.default || mod.buildClientListPDF || mod.exportClientListPDF;
            if (typeof fn === "function") {
                const doc = await fn(visibleRows, tsString);
                if (doc?.save) doc.save(`clients ${tsString()}.pdf`);
            }
        } catch (e) {
            console.error("Export Clients PDF failed:", e);
        }
    }, [visibleRows]);

    /* ===== Driver-number aware labels export (keeps names + tiny numbers) ===== */
    const parseDriverNum = (name) => {
        const m = /driver\s+(\d+)/i.exec(String(name || ""));
        return m ? parseInt(m[1], 10) : null;
    };

    const doExportLabels = React.useCallback(async () => {
        try {
            // Need both: enriched stops AND driver meta (names/colors) to sort by true driver number
            const dayKey = (mapData?.selectedDay || "all").toLowerCase();

            const [routesRes, enrichRes] = await Promise.all([
                fetch(`/api/route/routes?day=${encodeURIComponent(dayKey)}`, { cache: "no-store" }),
                fetch("/api/labels/enrich", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        routes: Array.isArray(mapData?.routes) ? mapData.routes : [],
                        users,
                        strict: false,
                        debug: false
                    }),
                }),
            ]);

            if (!routesRes.ok || !enrichRes.ok) return;

            const routesData = await routesRes.json();
            const { routes: enrichedRoutes } = await enrichRes.json();

            const meta = (routesData?.routes || []).map((r, i) => ({
                i,
                num: parseDriverNum(r?.driverName || r?.name),
                color: r?.color,
            }));

            // Sort: Driver 0, 1, 2 … (fallback to index when missing)
            meta.sort((a, b) => {
                const aa = Number.isFinite(a.num) ? a.num : a.i;
                const bb = Number.isFinite(b.num) ? b.num : b.i;
                return aa - bb || a.i - b.i;
            });

            // Colors in sorted order
            const colorsSorted = meta.map(m => m.color);

            // Stamp __driverNumber (0-based) and __stopIndex on each stop, in sorted order
            const enrichedSorted = meta.map((m, newIdx) => {
                const n = Number.isFinite(m.num) ? m.num : newIdx; // zero-based
                const arr = enrichedRoutes?.[m.i] || [];
                return arr.map((s, si) => ({
                    ...s,
                    __driverNumber: n,
                    __stopIndex: si,
                }));
            });

            const mod = await import("../utils/pdfRouteLabels");
            const fn = mod.exportRouteLabelsPDF || mod.default;
            if (typeof fn === "function") await fn(enrichedSorted, colorsSorted, tsString);
        } catch (e) {
            console.error("Export Route Labels failed:", e);
        }
    }, [mapData?.routes, mapData?.selectedDay, users]);

    return (
        <Box
            component="main"
            data-page="users"
            sx={{
                height: "100vh",
                width: "100vw",
                bgcolor: "#7ed6a7",
                p: "30px",
                overflow: "hidden",
                display: "grid",
                gridTemplateRows: "auto 1fr",
                gap: 8,
            }}
        >
            {/* Header card */}
            <Box
                sx={{
                    position: "relative",
                    zIndex: 2,
                    bgcolor: "#fff",
                    border: "1px solid rgba(0,0,0,0.08)",
                    borderRadius: 3,
                    boxShadow: "0 6px 22px rgba(0,0,0,0.06)",
                    px: 3,
                    pt: 2.25,
                    pb: 5,
                    overflow: "visible",
                }}
            >
                <Box sx={{ display: "flex", justifyContent: "center", mb: 2.5 }}>
                    <Image
                        src="https://thedietfantasy.com/wp-content/uploads/2023/07/logos-03-03.png"
                        alt="The Diet Fantasy"
                        width={420}
                        height={126}
                        priority
                        style={{ height: 92, width: "auto" }}
                    />
                </Box>

                {/* Floating Action Bar */}
                <Box sx={{ position: "relative", zIndex: 3 }}>
                    <ActionBar
                        busy={isLoading}
                        search={search}
                        setSearch={setSearch}
                        total={visibleCount}
                        openMore={openMore}
                        setOpenMore={setOpenMore}
                        onAddUser={() => {
                            setEditingUser(null);
                            setUserModalOpen(true);
                        }}
                        onExportExcel={doExportExcel}
                        onExportClientPdf={doExportClientsPdf}
                        onExportLabels={doExportLabels}
                        onOpenCityColors={() => setCityColorsOpen(true)}
                        onOpenDrivers={() => setDriversOpen(true)}
                    />
                </Box>

                {/* Floating toggle button */}
                <IconButton
                    onClick={() => setOpenMore((v) => !v)}
                    aria-label={openMore ? "Hide more actions" : "Show more actions"}
                    size="medium"
                    sx={{
                        position: "absolute",
                        left: "50%",
                        transform: "translateX(-50%)",
                        bottom: -28,
                        width: 48,
                        height: 48,
                        background: "#fff",
                        border: "1px solid rgba(0,0,0,0.10)",
                        borderRadius: "50%",
                        boxShadow: "0 8px 20px rgba(0,0,0,0.12)",
                        zIndex: 3,
                        "&:hover": { background: "#fff" },
                    }}
                >
                    {openMore ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </IconButton>
            </Box>

            {/* Scrollable content area */}
            <Box
                sx={{
                    minHeight: 0,
                    overflow: "hidden",
                    bgcolor: "#fff",
                    border: "1px solid rgba(0,0,0,0.08)",
                    borderRadius: 3,
                    position: "relative",
                }}
            >
                <UsersTable
                    users={users}
                    search={search}
                    getCityColor={getCityColor}
                    onVisibleCountChange={setVisibleCount}
                    onVisibleRowsChange={setVisibleRows}
                    onEdit={(u) => {
                        setEditingUser(u);
                        setUserModalOpen(true);
                    }}
                    onDelete={async (id) => {
                        if (!id) return;
                        if (!confirm("Delete this user?")) return;
                        await fetch(`/api/users/${id}`, { method: "DELETE" });
                        await refetch();
                    }}
                />
            </Box>

            {/* Modals */}
            <UserModal
                key={editingUser?.id ?? "new"}
                open={userModalOpen}
                onClose={() => {
                    setUserModalOpen(false);
                    setEditingUser(null);
                }}
                onSaved={refetch}
                editingUser={editingUser}
            />

            <CityColorsDialog
                open={cityColorsOpen}
                onClose={async () => {
                    setCityColorsOpen(false);
                    await fetchCityColors();
                }}
                cityColors={cityColors}
                onSave={async (newMap) => {
                    const entries = Object.entries(newMap || {});
                    const newKeys = new Set(entries.map(([k]) => norm(k)));
                    for (const [city, hex] of entries) await upsertCityColor(city, hex);
                    for (const oldCity of Object.keys(cityColors)) {
                        if (!newKeys.has(norm(oldCity))) await removeCityColor(oldCity);
                    }
                    setCityColors(newMap || {});
                    await fetchCityColors();
                }}
            />

            <DriversDialog
                open={driversOpen}
                onClose={() => setDriversOpen(false)}
                users={users}
                initialDriverCount={6}
                initialSelectedDay="all"
                onShowMap={({ routes, selectedDay, driverCount }) => {
                    setMapData({ routes, selectedDay, driverCount });
                    setMapOpen(true);
                }}
                onUsersPatched={onUsersPatched}
            />

            <Dialog open={mapOpen} onClose={() => setMapOpen(false)} fullWidth maxWidth="lg">
                <div style={{ height: 600 }}>
                    <DriversMap
                        routes={mapData.routes || []}
                        selectedDay={mapData.selectedDay || "all"}
                        driverCount={mapData.driverCount || 6}
                        getCityColor={getCityColor}
                    />
                </div>
            </Dialog>
        </Box>
    );
}