"use client";

import React, { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import {
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Checkbox,
    FormControlLabel,
    Chip,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import Image from "next/image";

export default function UsersPage() {
    const [users, setUsers] = useState([]);
    const [search, setSearch] = useState("");
    const [sortKey, setSortKey] = useState("city");
    const [sortAsc, setSortAsc] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [selectedDay, setSelectedDay] = useState("all");

    const [form, setForm] = useState({
        first: "",
        last: "",
        address: "",
        apt: "",
        city: "",
        dislikes: "",
        county: "",
        zip: "",
        state: "",
        phone: "",
        medicaid: false,
        paused: false,
        complex: false,
        schedule: {
            monday: true,
            tuesday: true,
            wednesday: true,
            thursday: true,
            friday: true,
            saturday: true,
            sunday: true,
        },
    });

    // City color mapping (persisted in DB via /api/city-colors)
    const [cityColors, setCityColors] = useState({});
    const [cityDialogOpen, setCityDialogOpen] = useState(false);
    const [cityInput, setCityInput] = useState("");
    const [colorInput, setColorInput] = useState("#008000");
    const [logoDataUrl, setLogoDataUrl] = useState(null);

    const columns = [
        { key: "first", label: "FIRST" },
        { key: "last", label: "LAST" },
        { key: "address", label: "ADDRESS" },
        { key: "apt", label: "APT" },
        { key: "city", label: "CITY" },
        { key: "dislikes", label: "DISLIKES" },
        { key: "county", label: "COUNTY" },
        { key: "zip", label: "ZIP" },
        { key: "state", label: "STATE" },
        { key: "phone", label: "PHONE" },
        { key: "medicaid", label: "MEDICAID" },
        { key: "paused", label: "paused" },
        { key: "complex", label: "complex" },
        { key: "schedule", label: "SCHEDULE" },
    ];

    // Initial loads
    useEffect(() => {
        fetchUsers();
        fetchCityColors();
    }, []);

    async function fetchUsers() {
        try {
            const res = await fetch("/api/users", { cache: "no-store" });
            if (!res.ok) throw new Error(`GET /api/users ${res.status}`);
            const data = await res.json();
            setUsers(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error("fetchUsers error:", err);
            alert("Failed to load users. Check server/API logs.");
        }
    }

    async function fetchCityColors() {
        try {
            const res = await fetch("/api/city-colors", { cache: "no-store" });
            if (!res.ok) throw new Error(`GET /api/city-colors ${res.status}`);
            const rows = await res.json();
            const map = {};
            for (const r of rows) map[String(r.city).toLowerCase()] = r.color;
            setCityColors(map);
        } catch (e) {
            console.error("fetchCityColors error:", e);
        }
    }

    function handleSort(key) {
        if (sortKey === key) setSortAsc(!sortAsc);
        else {
            setSortKey(key);
            setSortAsc(true);
        }
    }

    // Case-insensitive sort for the on-screen table
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

    // Ordering used by all exports (paused excluded; optional day filter; complex at bottom)
    function buildOrderedUsers(day = "all") {
        const isDay = (u) => {
            if (day === "all") return true;
            const k = day; // "monday".."sunday"
            return Boolean(u.schedule?.[k]);
        };
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

    // Timestamp helper like "9-7 10:52PM"
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

    async function handleSubmit() {
        const payload = {
            ...form,
            apt: form.apt || null,
            dislikes: form.dislikes || null,
            county: form.county || null,
            zip: form.zip || null,
            medicaid: Boolean(form.medicaid),
            schedule: { ...(form.schedule || {}) },
        };

        try {
            let res;
            if (editingUser) {
                res = await fetch(`/api/users/${encodeURIComponent(editingUser.id)}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });
            } else {
                res = await fetch(`/api/users`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });
            }
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`${res.status} ${res.statusText}: ${text}`);
            }
        } catch (err) {
            console.error("save user error:", err);
            alert(`Save failed: ${err?.message || err}`);
            return;
        }

        closeModal();
        fetchUsers();
    }

    async function handleDelete(id) {
        if (!confirm("Delete this user?")) return;
        try {
            const res = await fetch(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`${res.status} ${res.statusText}: ${text}`);
            }
            fetchUsers();
        } catch (err) {
            console.error("delete error:", err);
            alert(`Delete failed: ${err?.message || err}`);
        }
    }

    // City color helpers
    const cityKey = (c) => String(c || "").trim().toLowerCase();
    const getCityColor = (c) => cityColors[cityKey(c)] || null;
    const hexToRgb = (hex) => {
        if (!hex || typeof hex !== "string") return [0, 0, 0];
        const m = hex.replace("#", "");
        const bigint = parseInt(
            m.length === 3 ? m.split("").map((ch) => ch + ch).join("") : m,
            16
        );
        return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
    };

    // ===== Exports =====

    function exportToExcel() {
        const finalData = buildOrderedUsers(selectedDay).map((u) => {
            const s = u.schedule || {};
            return {
                FIRST: u.first ?? "",
                LAST: u.last ?? "",
                ADDRESS: u.address ?? "",
                APT: u.apt ?? "",
                CITY: u.city ?? "",
                DISLIKES: u.dislikes ?? "",
                COUNTY: u.county ?? "",
                ZIP: u.zip ?? "",
                STATE: u.state ?? "",
                PHONE: u.phone ?? "",
                MEDICAID: u.medicaid ? "Yes" : "No",
                PAUSED: u.paused ? "Yes" : "No",
                COMPLEX: u.complex ? "Yes" : "No",
                MON: s.monday ? "Y" : "",
                TUE: s.tuesday ? "Y" : "",
                WED: s.wednesday ? "Y" : "",
                THU: s.thursday ? "Y" : "",
                FRI: s.friday ? "Y" : "",
                SAT: s.saturday ? "Y" : "",
                SUN: s.sunday ? "Y" : "",
            };
        });
        const worksheet = XLSX.utils.json_to_sheet(finalData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Users");
        XLSX.writeFile(workbook, `master ${tsString()}.xlsx`);
    }

    async function exportToPDFLabels() {
        const ordered = buildOrderedUsers(selectedDay);

        // Load logo data URL once (cached in state)
        async function ensureLogo() {
            if (logoDataUrl) return logoDataUrl;
            try {
                const res = await fetch(
                    "https://thedietfantasy.com/wp-content/uploads/2023/07/logos-03-03.png",
                    { mode: "cors" }
                );
                const blob = await res.blob();
                const reader = new FileReader();
                const p = new Promise((resolve) => {
                    reader.onloadend = () => resolve(reader.result);
                });
                reader.readAsDataURL(blob);
                const dataUrl = await p;
                setLogoDataUrl(dataUrl);
                return dataUrl;
            } catch {
                return null; // continue without a logo if it fails to load
            }
        }

        // Avery 5163 = 2 columns, 4 rows per page (labels 4" x 2") on US Letter
        const doc = new jsPDF({ unit: "in", format: "letter" });

        const labelWidth = 4;
        const labelHeight = 2;
        const marginLeft = 0.25;
        const marginTop = 0.5;

        const padLeft = 0.2; // text left padding inside a label
        const padRight = 0.2; // right padding
        const padTop = 0.2; // top padding

        // nominal logo size (keeps ~3:1 aspect)
        const LOGO_W = 1.0; // inches
        const LOGO_H = 0.33; // inches

        let x = marginLeft;
        let y = marginTop;
        let col = 0;
        let row = 0;

        const logo = await ensureLogo();

        ordered.forEach((u) => {
            // Per your request: do NOT print the schedule/days on labels
            const lines = [
                `${u.first ?? ""} ${u.last ?? ""}`,
                `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`,
                `${u.city ?? ""} ${u.state ?? ""}`,
                `Phone: ${u.phone ?? ""}`,
                `Dislikes: ${u.dislikes ?? ""}`,
            ];

            // set text color based on city
            const hex = getCityColor(u.city);
            if (hex) {
                const [r, g, b] = hexToRgb(hex);
                doc.setTextColor(r, g, b);
            } else {
                doc.setTextColor(0, 0, 0);
            }

            doc.setFontSize(11);

            // Measure widest text line to decide if there's room for a top-right logo
            const textX = x + padLeft;
            const widths = lines.map((ln) => doc.getTextWidth(ln));
            const maxW = Math.max(...widths, 0);
            const rightEdgeOfText = textX + maxW;
            const availableRight = x + labelWidth - padRight - rightEdgeOfText; // horizontal gap to right border

            // Draw logo in top-right ONLY if it fits without overlapping text block
            if (logo && availableRight >= LOGO_W + 0.05) {
                const logoX = x + labelWidth - padRight - LOGO_W;
                const logoY = y + padTop;
                try {
                    doc.addImage(logo, "PNG", logoX, logoY, LOGO_W, LOGO_H);
                } catch {
                    // ignore image embed error
                }
            }

            // Draw text lines
            lines.forEach((line, idx) => {
                doc.text(line, textX, y + 0.4 + idx * 0.3);
            });

            // advance to next slot
            col++;
            if (col === 2) {
                col = 0;
                row++;
                x = marginLeft;
                y += labelHeight;
            } else {
                x += labelWidth;
            }

            if (row === 4) {
                doc.addPage();
                x = marginLeft;
                y = marginTop;
                col = 0;
                row = 0;
            }
        });

        doc.save(`label ${tsString()}.pdf`);
    }

    function exportClientListPDF() {
        const ordered = buildOrderedUsers(selectedDay);

        const doc = new jsPDF({ unit: "in", format: "letter" });
        const pageW = 8.5;
        const pageH = 11;
        const margin = 0.5;
        const columnGap = 0.5;
        const contentW = pageW - margin * 2;
        const colW = (contentW - columnGap) / 2; // two columns

        // Bigger font + larger check boxes
        const lineH = 0.38; // spacing between rows
        const box = 0.22; // checkbox size
        const boxTextGap = 0.14; // space between box and name

        let x = margin; // start left column
        let y = margin;
        let col = 0; // 0 left, 1 right

        // Header
        doc.setFontSize(16);
        doc.setTextColor(0, 0, 0);
        doc.text("Client List", margin, y);
        y += 0.45;

        // Body font
        doc.setFontSize(13);

        const drawRow = (name) => {
            // If the next line would overflow, move to next column or page
            if (y + lineH > pageH - margin) {
                if (col === 0) {
                    col = 1;
                    x = margin + colW + columnGap;
                    y = margin;
                    // redraw header on new column
                    doc.setFontSize(16);
                    doc.text("Client List", x, y);
                    y += 0.45;
                    doc.setFontSize(13);
                } else {
                    doc.addPage();
                    col = 0;
                    x = margin;
                    y = margin;
                    doc.setFontSize(16);
                    doc.text("Client List", x, y);
                    y += 0.45;
                    doc.setFontSize(13);
                }
            }
            // Checkbox outline using 4 lines (no fill artifacts)
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.02);
            const topY = y - (box - 0.04);
            doc.line(x, topY, x + box, topY); // top
            doc.line(x, topY, x, topY + box); // left
            doc.line(x + box, topY, x + box, topY + box); // right
            doc.line(x, topY + box, x + box, topY + box); // bottom
            // Name text
            doc.text(name, x + box + boxTextGap, y + 0.02);
            y += lineH;
        };

        ordered.forEach((u) => {
            const name = `${u.first ?? ""} ${u.last ?? ""}`.trim();
            drawRow(name || "(Unnamed)");
        });

        doc.save(`client list ${tsString()}.pdf`);
    }

    // ===== Modal controls =====

    function openModal(user = null) {
        setEditingUser(user);
        if (user) {
            setForm({
                ...user,
                medicaid: Boolean(user.medicaid),
                schedule: {
                    monday: true,
                    tuesday: true,
                    wednesday: true,
                    thursday: true,
                    friday: true,
                    saturday: true,
                    sunday: true,
                    ...(user.schedule || {}),
                },
            });
        } else {
            setForm({
                first: "",
                last: "",
                address: "",
                apt: "",
                city: "",
                dislikes: "",
                county: "",
                zip: "",
                state: "",
                phone: "",
                medicaid: false,
                paused: false,
                complex: false,
                schedule: {
                    monday: true,
                    tuesday: true,
                    wednesday: true,
                    thursday: true,
                    friday: true,
                    saturday: true,
                    sunday: true,
                },
            });
        }
        setModalOpen(true);
    }

    function closeModal() {
        setModalOpen(false);
        setEditingUser(null);
    }

    // ===== City color API actions =====

    async function addCityColor() {
        const key = cityKey(cityInput);
        if (!key) return;
        try {
            const res = await fetch("/api/city-colors", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ city: key, color: colorInput }),
            });
            if (!res.ok) throw new Error(await res.text());
            await fetchCityColors();
            setCityInput("");
        } catch (e) {
            console.error("addCityColor error:", e);
            alert("Saving city color failed.");
        }
    }

    async function removeCityColor(key) {
        try {
            const res = await fetch(
                `/api/city-colors/${encodeURIComponent(key)}`,
                { method: "DELETE" }
            );
            if (!res.ok) throw new Error(await res.text());
            await fetchCityColors();
        } catch (e) {
            console.error("removeCityColor error:", e);
            alert("Removing city color failed.");
        }
    }

    // ===== Render =====

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

            <div
                style={{
                    marginBottom: 12,
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                }}
            >
                <input
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ padding: 6, width: 240 }}
                />
                <Button variant="contained" onClick={() => openModal()}>
                    Add User
                </Button>

                <FormControl size="small" style={{ minWidth: 160 }}>
                    <InputLabel id="day-select-label">Day filter</InputLabel>
                    <Select
                        labelId="day-select-label"
                        value={selectedDay}
                        label="Day filter"
                        onChange={(e) => setSelectedDay(e.target.value)}
                    >
                        <MenuItem value="all">All days</MenuItem>
                        <MenuItem value="monday">Monday</MenuItem>
                        <MenuItem value="tuesday">Tuesday</MenuItem>
                        <MenuItem value="wednesday">Wednesday</MenuItem>
                        <MenuItem value="thursday">Thursday</MenuItem>
                        <MenuItem value="friday">Friday</MenuItem>
                        <MenuItem value="saturday">Saturday</MenuItem>
                        <MenuItem value="sunday">Sunday</MenuItem>
                    </Select>
                </FormControl>

                <Button variant="outlined" onClick={exportToExcel}>
                    Export Excel
                </Button>
                <Button variant="outlined" onClick={() => exportToPDFLabels()}>
                    Export Labels PDF
                </Button>
                <Button variant="outlined" onClick={exportClientListPDF}>
                    Client List PDF
                </Button>
                <Button variant="text" onClick={() => setCityDialogOpen(true)}>
                    City Colors
                </Button>
            </div>

            <table border="1" cellPadding="6" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                <tr>
                    {columns.map((c) => (
                        <th
                            key={c.key}
                            onClick={() => handleSort(c.key)}
                            style={{ cursor: "pointer" }}
                            title="Click to sort"
                        >
                            {c.label}
                        </th>
                    ))}
                    <th>ACTIONS</th>
                </tr>
                </thead>
                <tbody>
                {filteredUsers.map((u) => (
                    <tr key={u.id}>
                        <td>{u.first}</td>
                        <td>{u.last}</td>
                        <td>{u.address}</td>
                        <td>{u.apt}</td>
                        <td>
                <span
                    style={{
                        color: getCityColor(u.city) || "inherit",
                        fontWeight: 600,
                    }}
                >
                  {u.city}
                </span>
                        </td>
                        <td>{u.dislikes}</td>
                        <td>{u.county}</td>
                        <td>{u.zip}</td>
                        <td>{u.state}</td>
                        <td>{u.phone}</td>
                        <td>{u.medicaid ? "Yes" : "No"}</td>
                        <td>{u.paused ? "Yes" : "No"}</td>
                        <td>{u.complex ? "Yes" : "No"}</td>
                        <td>
                            {u.schedule
                                ? ["M", "T", "W", "Th", "F", "Sa", "Su"]
                                    .filter((_, i) => {
                                        const k = [
                                            "monday",
                                            "tuesday",
                                            "wednesday",
                                            "thursday",
                                            "friday",
                                            "saturday",
                                            "sunday",
                                        ];
                                        return u.schedule[k[i]];
                                    })
                                    .join(" ")
                                : ""}
                        </td>
                        <td>
                            <Button size="small" onClick={() => openModal(u)}>
                                Edit
                            </Button>
                            <Button
                                size="small"
                                color="error"
                                onClick={() => handleDelete(u.id)}
                                style={{ marginLeft: 6 }}
                            >
                                Delete
                            </Button>
                        </td>
                    </tr>
                ))}
                </tbody>
            </table>

            {/* Add/Edit User Modal */}
            <Dialog open={modalOpen} onClose={closeModal} fullWidth maxWidth="sm">
                <DialogTitle>{editingUser ? "Edit User" : "Add User"}</DialogTitle>
                <DialogContent>
                    {[
                        { key: "first", label: "FIRST" },
                        { key: "last", label: "LAST" },
                        { key: "address", label: "ADDRESS" },
                        { key: "apt", label: "APT" },
                        { key: "city", label: "CITY" },
                        { key: "dislikes", label: "DISLIKES" },
                        { key: "county", label: "COUNTY" },
                        { key: "zip", label: "ZIP" },
                        { key: "state", label: "STATE" },
                        { key: "phone", label: "PHONE" },
                    ].map(({ key, label }) => (
                        <TextField
                            key={key}
                            label={label}
                            value={form[key] ?? ""}
                            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                            fullWidth
                            margin="dense"
                        />
                    ))}

                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={!!form.medicaid}
                                onChange={(e) => setForm({ ...form, medicaid: e.target.checked })}
                            />
                        }
                        label="Medicaid"
                    />

                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #eee" }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Schedule (days)</div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, auto)", gap: 8 }}>
                            {[
                                "monday",
                                "tuesday",
                                "wednesday",
                                "thursday",
                                "friday",
                                "saturday",
                                "sunday",
                            ].map((day) => (
                                <FormControlLabel
                                    key={day}
                                    control={
                                        <Checkbox
                                            checked={!!form.schedule?.[day]}
                                            onChange={(e) =>
                                                setForm({
                                                    ...form,
                                                    schedule: { ...(form.schedule || {}), [day]: e.target.checked },
                                                })
                                            }
                                        />
                                    }
                                    label={day[0].toUpperCase() + day.slice(1)}
                                />
                            ))}
                        </div>
                    </div>

                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={form.paused}
                                onChange={(e) => setForm({ ...form, paused: e.target.checked })}
                            />
                        }
                        label="paused"
                    />
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={form.complex}
                                onChange={(e) => setForm({ ...form, complex: e.target.checked })}
                            />
                        }
                        label="complex"
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeModal}>Cancel</Button>
                    <Button onClick={handleSubmit} variant="contained">
                        Save
                    </Button>
                </DialogActions>
            </Dialog>

            {/* City Colors Dialog */}
            <Dialog
                open={cityDialogOpen}
                onClose={() => setCityDialogOpen(false)}
                fullWidth
                maxWidth="sm"
            >
                <DialogTitle>City Colors</DialogTitle>
                <DialogContent>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "8px 0" }}>
                        <TextField
                            label="City"
                            value={cityInput}
                            onChange={(e) => setCityInput(e.target.value)}
                            placeholder="e.g., Monsey"
                        />
                        <input
                            type="color"
                            value={colorInput}
                            onChange={(e) => setColorInput(e.target.value)}
                            style={{
                                width: 48,
                                height: 48,
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                            }}
                            aria-label="Choose color"
                        />
                        <Button variant="contained" onClick={addCityColor}>
                            Add / Update
                        </Button>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                        {Object.entries(cityColors).map(([key, hex]) => (
                            <Chip
                                key={key}
                                label={`${key} (${hex})`}
                                style={{ background: hex, color: "#fff" }}
                                deleteIcon={<DeleteIcon htmlColor="#fff" />}
                                onDelete={() => removeCityColor(key)}
                            />
                        ))}
                    </div>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCityDialogOpen(false)}>Close</Button>
                </DialogActions>
            </Dialog>
        </div>
    );
}