"use client";

import React, { useMemo, useState } from "react";
import Image from "next/image";
import { Button, FormControl, InputLabel, MenuItem, Select } from "@mui/material";

import { useUsers } from "../hooks/useUsers";
import { useCityColors } from "../hooks/useCityColors";

import ActionBar from "../components/ActionBar";
import UsersTable from "../components/UsersTable";
import CityColorsDialog from "../components/CityColorsDialog";
import UserModal from "../components/UserModal";

import { exportExcel } from "../utils/excelExport";
import { exportClientListPDF } from "../utils/pdfClientList";
import { exportLabelsPDF } from "../utils/pdfLabels";
import { exportDriversPDF } from "../utils/driversPdf";
import DriversDialog from "../components/DriversDialog";

import { buildDriversPDF } from "../utils/driversPdf";

import { apiGeocodeMissing, apiPlanRoutes, planRoutes } from "../utils/routing";


export default function UsersPage() {
    const {
        users,
        fetchUsers,
        addUser,
        updateUser,
        deleteUser,
    } = useUsers();

    const {
        cityColors,
        fetchCityColors,
        addCityColor,
        removeCityColor,
        getCityColor,
        hexToRgb,
    } = useCityColors();

    const [search, setSearch] = useState("");
    const [sortKey, setSortKey] = useState("city");
    const [sortAsc, setSortAsc] = useState(true);
    const [selectedDay, setSelectedDay] = useState("all");

    const [modalOpen, setModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [driversModalOpen, setDriversModalOpen] = useState(false);
    const [cityDialogOpen, setCityDialogOpen] = useState(false);

    // initial loads
    React.useEffect(() => {
        fetchUsers();
        fetchCityColors();
    }, []); // eslint-disable-line

    function handleSort(key) {
        if (sortKey === key) setSortAsc(!sortAsc);
        else {
            setSortKey(key);
            setSortAsc(true);
        }
    }

    // Case-insensitive filtered + sorted table view
    const filteredUsers = useMemo(() => {
        const s = search.toLowerCase();
        const base = users.filter((u) =>
            Object.values(u).some((val) => String(val ?? "").toLowerCase().includes(s))
        );
        return base.sort((a, b) => {
            const av = String(a[sortKey] ?? "").toLowerCase();
            const bv = String(b[sortKey] ?? "").toLowerCase();
            if (av < bv) return sortAsc ? -1 : 1;
            if (av > bv) return sortAsc ? 1 : -1;
            return 0;
        });
    }, [users, search, sortKey, sortAsc]);

    // Ordering used by exports
    function buildOrderedUsers(day = "all") {
        const isDay = (u) => (day === "all" ? true : Boolean(u.schedule?.[day]));
        const active = users.filter((u) => !u.paused && isDay(u));
        const byCityLast = (a, b) => {
            const ac = String(a.city ?? "").toLowerCase();
            const bc = String(b.city ?? "").toLowerCase();
            if (ac !== bc) return ac.localeCompare(bc);
            return String(a.last ?? "").toLowerCase().localeCompare(String(b.last ?? "").toLowerCase());
        };
        const nonComplex = active.filter((u) => !u.complex).sort(byCityLast);
        const complex = active.filter((u) => u.complex).sort(byCityLast);
        return [...nonComplex, ...complex];
    }

    // Timestamp like "9-7 10:52PM"
    function tsString() {
        const d = new Date();
        const mm = d.getMonth() + 1;
        const dd = d.getDate();
        let h = d.getHours();
        const m = d.getMinutes();
        const ampm = h >= 12 ? "PM" : "AM";
        h = h % 12;
        if (h === 0) h = 12;
        const min = String(m).padStart(2, "0");
        return `${mm}-${dd} ${h}:${min}${ampm}`;
    }

    // Add/Edit modal
    function openModal(user = null) {
        setEditingUser(user);
        setModalOpen(true);
    }
    function closeModal() {
        setModalOpen(false);
        setEditingUser(null);
    }

    async function handleGeocodeMissing() {
        try {
            const data = await apiGeocodeMissing();
            alert(`Updated: ${data.updated}, Failed: ${data.failed}`);
            await fetchUsers();
        } catch (e) {
            alert("Failed to geocode: " + e.message);
        }
    }

    async function handleGenerateDrivers(numDrivers) {
        try {
            const data = await apiPlanRoutes(numDrivers, selectedDay);
            buildDriversPDF(data, getCityColor);
        } catch (e) {
            alert("Failed to generate driver list: " + e.message);
        }
    }
    // Actions
    const onSaveUser = async (payload, editing) => {
        if (editing) await updateUser(editing.id, payload);
        else await addUser(payload);
        closeModal();
        fetchUsers();
    };

    const onDeleteUser = async (id) => {
        if (!confirm("Delete this user?")) return;
        await deleteUser(id);
        fetchUsers();
    };

    // Exports
    const onExportExcel = () =>
        exportExcel(buildOrderedUsers(selectedDay), tsString());

    const onExportLabels = () =>
        exportLabelsPDF(buildOrderedUsers(selectedDay), getCityColor, hexToRgb, tsString);

    const onExportClientList = () =>
        exportClientListPDF(buildOrderedUsers(selectedDay), tsString);

    const onGeocodeMissing = async () => {
        if (!confirm("Geocode users missing coordinates now?")) return;
        try {
            const res = await fetch("/api/geocode/missing", { method: "POST" });
            const data = await res.json();
            alert(`Geocoded: ${data.updatedCount}, Failed: ${data.failedCount}`);
            fetchUsers();
        } catch {
            alert("Geocoding failed. Check logs and MAPBOX_ACCESS_TOKEN.");
        }
    };

    const onExportDrivers = async () => {
        const d = window.prompt("How many drivers?", "6");
        const drivers = Math.max(1, Number(d || 1));
        exportDriversPDF(buildOrderedUsers(selectedDay), drivers, tsString);
    };

    return (
        <div style={{ padding: 20, fontFamily: "Arial, sans-serif" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
                <Image
                    src="https://thedietfantasy.com/wp-content/uploads/2023/07/logos-03-03.png"
                    alt="The Diet Fantasy"
                    width={300}
                    height={100}
                    priority
                />
            </div>

            <ActionBar
                search={search}
                setSearch={setSearch}
                selectedDay={selectedDay}
                setSelectedDay={setSelectedDay}
                onAdd={() => openModal()}
                onExportExcel={onExportExcel}
                onExportLabels={onExportLabels}
                onExportClientList={onExportClientList}
                onCityColors={() => setCityDialogOpen(true)}
                onGeocodeMissing={onGeocodeMissing}
                onExportDrivers={onExportDrivers}
                setDriversModalOpen={setDriversModalOpen}
                total={filteredUsers.length}
            />

            <UsersTable
                users={filteredUsers}
                onSort={handleSort}
                sortKey={sortKey}
                sortAsc={sortAsc}
                getCityColor={getCityColor}
                onEdit={(u) => openModal(u)}
                onDelete={onDeleteUser}
            />

            {/* Add/Edit User Modal */}
            <UserModal
                open={modalOpen}
                onClose={closeModal}
                onSave={onSaveUser}
                editingUser={editingUser}
            />

            {/* City Colors */}
            <CityColorsDialog
                open={cityDialogOpen}
                onClose={() => setCityDialogOpen(false)}
                cityColors={cityColors}
                addCityColor={addCityColor}
                removeCityColor={removeCityColor}
            />
            <DriversDialog
                open={driversModalOpen}
                onClose={() => setDriversModalOpen(false)}
                users={filteredUsers}          // <-- not `users`; pass what you render
                selectedDay={selectedDay}
                onUsersRefetch={fetchUsers}
            />
        </div>
    );
}