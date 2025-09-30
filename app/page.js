// app/page.js
"use client";

import * as React from "react";
import { Box, Dialog, TextField, IconButton, InputAdornment, Button } from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import {useState} from "react";
import UsersTable from "../components/UsersTable";
import ActionBar from "../components/ActionBar";

import UserModal from "../components/UserModal";
import CityColorsDialog from "../components/CityColorsDialog";
import DriversDialog from "../components/DriversDialog";
import DriversMap from "../components/DriversMap";

/* =========================
   Color helpers
   ========================= */

const PALETTE = [
    "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
    "#46f0f0", "#f032e6", "#bcf60c", "#fabebe", "#008080",
    "#e6beff", "#9a6324", "#fffac8", "#800000", "#aaffc3",
    "#808000", "#ffd8b1", "#000075", "#808080", "#ffffff"
];

function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
}

function buildCityColors(users) {
    const map = {};
    (users || []).forEach(u => {
        const city = String(u?.city || "").trim();
        if (!city) return;
        if (!map[city]) {
            const idx = hashStr(city) % PALETTE.length;
            map[city] = PALETTE[idx];
        }
    });
    return map;
}

/* =========================
   Data loading
   ========================= */

function useUsersApi() {
    const [users, setUsers] = React.useState([]);
    const [loading, setLoading] = React.useState(true);

    const refetch = React.useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch("/api/users");
            const data = await res.json();
            setUsers(Array.isArray(data) ? data : (data?.users || []));
        } catch (e) {
            console.error("Fetch /api/users failed", e);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => { refetch(); }, [refetch]);

    return { users, isLoading: loading, refetch };
}

/* Timestamp for filenames */
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



export default function UsersPage() {
    const { users, isLoading, refetch } = useUsersApi();

    // City colors
    const [cityColors, setCityColors] = React.useState({});
    React.useEffect(() => { setCityColors(buildCityColors(users)); }, [users]);
    const getCityColor = React.useCallback(
        (city) => cityColors[String(city || "").trim()] || null,
        [cityColors]
    );

    // Modals
    const [userModalOpen, setUserModalOpen] = React.useState(false);
    const [driversOpen, setDriversOpen] = React.useState(false);
    const [cityColorsOpen, setCityColorsOpen] = React.useState(false);

    // Map modal + data
    const [mapOpen, setMapOpen] = React.useState(false);
    const [mapData, setMapData] = React.useState({ routes: [], selectedDay: "all", driverCount: 6 });
    const [selectedDay, setSelectedDay] = useState("all");


    // Search + sort
    const [query, setQuery] = React.useState("");
    const [sortKey, setSortKey] = React.useState(null);
    const [sortAsc, setSortAsc] = React.useState(true);

    const onSort = React.useCallback((key) => {
        setSortAsc((prev) => (key === sortKey ? !prev : true));
        setSortKey(key);
    }, [sortKey]);

    const displayedUsers = React.useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        const source = Array.isArray(users) ? users : [];

        // filter
        const filtered = !normalizedQuery ? source : source.filter((u) => {
            const fields = ["first","last","address","apt","city","county","zip","state","phone","dislikes","medicaid"];
            let hay = fields.map((k) => {
                const v = u?.[k];
                if (k === "medicaid") return v ? "yes" : "no";
                return v == null ? "" : String(v);
            }).join(" ").toLowerCase();

            if (u?.schedule) {
                const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
                const short = ["m","t","w","th","f","sa","su"].filter((_, i) => u.schedule[days[i]]);
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
            const fn = mod.default || mod.exportExcel || mod.exportUsersToExcel || mod.exportToExcel;
            if (typeof fn === "function") {
                await fn(users);
            } else {
                console.warn("excelExport: no callable export found");
            }
        } catch (e) {
            console.error("Export Excel failed:", e);
        }
    }, [users]);

    const handleExportClientsPdf = React.useCallback(async () => {
        try {
            const mod = await import("../utils/pdfClientList");
            const fn = mod.default || mod.buildClientListPDF || mod.exportClientListPDF;
            if (typeof fn === "function") {
                const doc = await fn(users);
                if (doc?.save) doc.save(`clients ${tsString()}.pdf`);
            } else {
                console.warn("pdfClientList: no callable export found");
            }
        } catch (e) {
            console.error("Export Clients PDF failed:", e);
        }
    }, [users]);

    const handleExportLabels = React.useCallback(async () => {
        try {
            const mod = await import("../utils/pdfLabels");
            const fn = mod.exportLabelsPDF || mod.default;
            if (typeof fn === "function") {
                await fn(users, getCityColor, (hex) => {
                    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
                    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
                }, tsString);
            } else {
                console.warn("pdfLabels: exportLabelsPDF not found");
            }
        } catch (e) {
            console.error("Export Labels failed:", e);
        }
    }, [users, getCityColor]);

    /* ===== Edit/Delete wiring ===== */

    const [editingUser, setEditingUser] = React.useState(null);

    const handleEdit = React.useCallback((u) => {
        setEditingUser(u || null);
        setUserModalOpen(true);
    }, []);

    const handleDelete = React.useCallback(async (id) => {
        if (!id) return;
        if (!confirm("Delete this user?")) return;
        try {
            await fetch(`/api/users/${id}`, { method: "DELETE" });
            await refetch();
        } catch (e) {
            console.error("Delete failed", e);
            alert("Delete failed");
        }
    }, [refetch]);

    /* ===== Render ===== */

    return (
        <Box sx={{ p: 2 }}>
            {/* Search bar */}
            <Box sx={{ mb: 2, mt: 1 }}>
                <TextField
                    size="small"
                    fullWidth
                    label="Search clients (name, address, city, phone, etc.)"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    InputProps={{
                        endAdornment: query ? (
                            <InputAdornment position="end">
                                <IconButton aria-label="Clear search" onClick={() => setQuery("")} edge="end">
                                    <ClearIcon />
                                </IconButton>
                            </InputAdornment>
                        ) : null
                    }}
                />
            </Box>

            {/* Top actions */}
            <ActionBar
                busy={isLoading}
                onAddUser={() => { setEditingUser(null); setUserModalOpen(true); }}
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
            />

            {/* Modals */}
            <UserModal
                key={editingUser?.id ?? "new"}        // remount when switching add/edit
                open={userModalOpen}
                onClose={() => { setUserModalOpen(false); setEditingUser(null); }}
                onSaved={refetch}
                editingUser={editingUser}             // pass selected user (or null)
            />

            <CityColorsDialog
                open={cityColorsOpen}
                onClose={() => setCityColorsOpen(false)}
                cityColors={cityColors}
                onSave={(newMap) => setCityColors(newMap || {})}
            />

            {/* Drivers dialog — using full users list; switch to displayedUsers if you want it filtered */}
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

            {/* Quick test button; remove if you have a Drivers button elsewhere */}
            <Box sx={{ position: "fixed", bottom: 16, right: 16, display: { xs: "none", md: "block" } }}>
                <Button variant="contained" onClick={() => setDriversOpen(true)}>Open Drivers</Button>
            </Box>

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