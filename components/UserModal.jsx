import React from "react";
import { Dialog, TextField, Button } from "@mui/material";

const EMPTY = {
    id: undefined,
    first: "", last: "",
    address: "", apt: "",
    city: "", county: "", zip: "", state: "",
    phone: "", dislikes: "",
    medicaid: false, paused: false, complex: false,
    schedule: {
        monday: false, tuesday: false, wednesday: false,
        thursday: false, friday: false, saturday: false, sunday: false,
    },
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
        schedule: { ...EMPTY.schedule, ...(u.schedule || {}) },
    };
}

export default function UserModal({ open, onClose, onSaved, editingUser }) {
    const [form, setForm] = React.useState(EMPTY);

    // IMPORTANT: load defaults when opening or when editingUser changes
    React.useEffect(() => {
        if (!open) return; // don’t thrash while closed
        const base = { ...EMPTY };
        const incoming = editingUser ? { ...editingUser } : {};
        // merge shallow + schedule safely
        const schedule = { ...base.schedule, ...(incoming.schedule || {}) };
        setForm({ ...base, ...incoming, schedule });
    }, [open, editingUser]);

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
    const setSched = (k, v) => setForm(f => ({ ...f, schedule: { ...f.schedule, [k]: v }}));

    const handleSave = async () => {
        try {
            const method = form.id ? "PUT" : "POST";
            const url = form.id ? `/api/users/${form.id}` : "/api/users";
            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            });
            if (!res.ok) throw new Error(await res.text());
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
                    <TextField
                        label="First"
                        value={form.first}
                        onChange={(e) => set("first", e.target.value)}
                    />
                    <TextField
                        label="Last"
                        value={form.last}
                        onChange={(e) => set("last", e.target.value)}
                    />
                    <TextField
                        label="Address"
                        value={form.address}
                        onChange={(e) => set("address", e.target.value)}
                    />
                    <TextField
                        label="Apt"
                        value={form.apt}
                        onChange={(e) => set("apt", e.target.value)}
                    />
                    <TextField
                        label="City"
                        value={form.city}
                        onChange={(e) => set("city", e.target.value)}
                    />
                    <TextField
                        label="State"
                        value={form.state}
                        onChange={(e) => set("state", e.target.value)}
                    />
                    <TextField
                        label="ZIP"
                        value={form.zip}
                        onChange={(e) => set("zip", e.target.value)}
                    />
                    <TextField
                        label="Phone"
                        value={form.phone}
                        onChange={(e) => set("phone", e.target.value)}
                    />
                    <TextField
                        label="County"
                        value={form.county}
                        onChange={(e) => set("county", e.target.value)}
                    />
                    <TextField
                        label="Dislikes"
                        value={form.dislikes}
                        onChange={(e) => set("dislikes", e.target.value)}
                    />
                </div>

                {/* Example schedule toggles (customize to your UI) */}
                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {["monday","tuesday","wednesday","thursday","friday","saturday","sunday"].map(d => (
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

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                    <Button onClick={onClose}>Cancel</Button>
                    <Button variant="contained" onClick={handleSave}>
                        {form.id ? "Save Changes" : "Create"}
                    </Button>
                </div>
            </div>
        </Dialog>
    );
}