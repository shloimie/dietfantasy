// app/page.js
"use client";

import * as React from "react";
import {
    Box,
    Dialog,
    TextField,
    IconButton,
    InputAdornment,
} from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import { useState } from "react";

import UsersTable from "../components/UsersTable";
import ActionBar from "../components/ActionBar";
import UserModal from "../components/UserModal";
import CityColorsDialog from "../components/CityColorsDialog";
import DriversDialog from "../components/DriversDialog";
import DriversMap from "../components/DriversMap";



function useUsersApi() {
    const [users, setUsers] = React.useState([]);
    const [loading, setLoading] = React.useState(true);

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

    return { users, isLoading: loading, refetch };
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
            const rows = await res.json(); // [{ id, city, color }]
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
        setCityColors, // local state override if needed
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
   Page
   ========================= */

export default function UsersPage() {
    const { users, isLoading, refetch } = useUsersApi();

    // City colors (DB as source of truth)
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
    const [driversOpen, setDriversOpen] = React.useState(false);
    const [cityColorsOpen, setCityColorsOpen] = React.useState(false);

    // Map modal + data
    const [mapOpen, setMapOpen] = React.useState(false);
    const [mapData, setMapData] = React.useState({
        routes: [],
        selectedDay: "all",
        driverCount: 6,
    });
    const [selectedDay, setSelectedDay] = useState("all"); // if used elsewhere later

    // Search + sort
    const [query, setQuery] = React.useState("");
    const [sortKey, setSortKey] = React.useState(null);
    const [sortAsc, setSortAsc] = React.useState(true);

    const onSort = React.useCallback(
        (key) => {
            setSortAsc((prev) => (key === sortKey ? !prev : true));
            setSortKey(key);
        },
        [sortKey]
    );

    const displayedUsers = React.useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        const source = Array.isArray(users) ? users : [];

        // filter
        const filtered = !normalizedQuery
            ? source
            : source.filter((u) => {
                const fields = [
                    "first",
                    "last",
                    "address",
                    "apt",
                    "city",
                    "county",
                    "zip",
                    "state",
                    "phone",
                    "dislikes",
                    "medicaid",
                ];
                let hay = fields
                    .map((k) => {
                        const v = u?.[k];
                        if (k === "medicaid") return v ? "yes" : "no";
                        return v == null ? "" : String(v);
                    })
                    .join(" ")
                    .toLowerCase();

                if (u?.schedule) {
                    const days = [
                        "monday",
                        "tuesday",
                        "wednesday",
                        "thursday",
                        "friday",
                        "saturday",
                        "sunday",
                    ];
                    const short = ["m", "t", "w", "th", "f", "sa", "su"].filter(
                        (_, i) => u.schedule[days[i]]
                    );
                    hay += " " + short.join(" ");
                }
                return hay.includes(normalizedQuery);
            });

        // sort
        if (!sortKey) return filtered;
        const arr = filtered.slice();
        arr.sort((a, b) => {
            const av = (a?.[sortKey] ?? "").toString().toLowerCase();
            const bv = (b?.[sortKey] ?? "").toString().toLowerCase();
            if (av < bv) return sortAsc ? -1 : 1;
            if (av > bv) return sortAsc ? 1 : -1;
            return 0;
        });
        return arr;
    }, [users, query, sortKey, sortAsc]);

    /* ===== Actions (exports) ===== */

    const handleExportExcel = React.useCallback(async () => {
        try {
            const mod = await import("../utils/excelExport");
            const fn =
                mod.default ||
                mod.exportExcel ||
                mod.exportUsersToExcel ||
                mod.exportToExcel;
            if (typeof fn === "function") {
                await fn(displayedUsers, tsString);
            } else {
                console.warn("excelExport: no callable export found");
            }
        } catch (e) {
            console.error("Export Excel failed:", e);
        }
    }, [displayedUsers]);

    const handleExportClientsPdf = React.useCallback(async () => {
        try {
            const mod = await import("../utils/pdfClientList");
            const fn =
                mod.default || mod.buildClientListPDF || mod.exportClientListPDF;
            if (typeof fn === "function") {
                const doc = await fn(displayedUsers, tsString);
                if (doc?.save) doc.save(`clients ${tsString()}.pdf`);
            } else {
                console.warn("pdfClientList: no callable export found");
            }
        } catch (e) {
            console.error("Export Clients PDF failed:", e);
        }
    }, [displayedUsers]);

    const handleExportLabels = React.useCallback(async () => {
        try {
            const mod = await import("../utils/pdfLabels");
            const fn = mod.exportLabelsPDF || mod.default;
            if (typeof fn === "function") {
                await fn(
                    displayedUsers,
                    getCityColor,
                    (hex) => {
                        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(
                            hex || ""
                        );
                        return m
                            ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
                            : [0, 0, 0];
                    },
                    tsString
                );
            } else {
                console.warn("pdfLabels: exportLabelsPDF not found");
            }
        } catch (e) {
            console.error("Export Labels failed:", e);
        }
    }, [displayedUsers, getCityColor]);

    /* ===== Edit/Delete wiring ===== */

    const [editingUser, setEditingUser] = React.useState(null);

    const handleEdit = React.useCallback((u) => {
        setEditingUser(u || null);
        setUserModalOpen(true);
    }, []);

    const handleDelete = React.useCallback(
        async (id) => {
            if (!id) return;
            if (!confirm("Delete this user?")) return;
            try {
                await fetch(`/api/users/${id}`, { method: "DELETE" });
                await refetch();
            } catch (e) {
                console.error("Delete failed", e);
                alert("Delete failed");
            }
        },
        [refetch]
    );


    const [showDetails, setShowDetails] = React.useState(false);

    return (
        <Box sx={{ width: "100%", m: 0, p: 2 }}>
            {/* Search + live total + subtle details toggle */}
            <Box
                sx={{
                    mb: 2,
                    mt: 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                }}
            >
                {/* Search input */}
                <TextField
                    size="small"
                    fullWidth
                    label="Search clients (name, address, city, phone, etc.)"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    InputProps={{
                        endAdornment: query ? (
                            <InputAdornment position="end">
                                <IconButton
                                    aria-label="Clear search"
                                    onClick={() => setQuery("")}
                                    edge="end"
                                >
                                    <ClearIcon />
                                </IconButton>
                            </InputAdornment>
                        ) : null,
                    }}
                    sx={{ flex: 1 }}
                />

                {/* Right side: Total count + toggle */}
                <Box
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        whiteSpace: "nowrap",
                    }}
                >
                    <Box sx={{ color: "text.secondary", fontSize: 14 }}>
                        Total: {displayedUsers.length}
                    </Box>

                    {/* Subtle expand toggle */}
                    <IconButton
                        size="small"
                        onClick={() => setShowDetails((v) => !v)}
                        sx={{
                            border: "1px solid #ccc",
                            borderRadius: 1,
                            padding: "2px 6px",
                            fontSize: 12,
                            color: showDetails ? "primary.main" : "text.secondary",
                            backgroundColor: showDetails ? "action.hover" : "transparent",
                            "&:hover": { backgroundColor: "action.selected" },
                        }}
                        title={showDetails ? "Hide extra columns" : "Show extra columns"}
                    >
                        {showDetails ? "−" : "+"}
                    </IconButton>
                </Box>
            </Box>

            {/* Top actions */}
            <ActionBar
                busy={isLoading}
                onAddUser={() => {
                    setEditingUser(null);
                    setUserModalOpen(true);
                }}
                onExportExcel={handleExportExcel}
                onExportClientPdf={handleExportClientsPdf}
                onExportLabels={handleExportLabels}
                onOpenCityColors={() => setCityColorsOpen(true)}
                onOpenDrivers={() => setDriversOpen(true)}
            />

            {/* Users table */}
            <UsersTable
                users={displayedUsers}
                getCityColor={getCityColor}
                onSort={onSort}
                sortKey={sortKey}
                sortAsc={sortAsc}
                onEdit={handleEdit}
                onDelete={handleDelete}
                showDetails={showDetails}
            />

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
                    const newEntries = Object.entries(newMap || {});
                    const newKeys = new Set(newEntries.map(([k]) => norm(k)));

                    for (const [city, hex] of newEntries) {
                        await upsertCityColor(city, hex);
                    }

                    for (const oldCity of Object.keys(cityColors)) {
                        if (!newKeys.has(norm(oldCity))) {
                            await removeCityColor(oldCity);
                        }
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
            />

            {/* Map modal */}
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