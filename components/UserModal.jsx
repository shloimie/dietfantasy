import React from "react";
import {
    Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
    FormControlLabel, TextField
} from "@mui/material";

const emptyForm = {
    first: "", last: "", address: "", apt: "", city: "", dislikes: "",
    county: "", zip: "", state: "", phone: "",
    medicaid: false, paused: false, complex: false,
    schedule: { monday:true, tuesday:true, wednesday:true, thursday:true, friday:true, saturday:true, sunday:true }
};

export default function UserModal({ open, onClose, onSave, editingUser }) {
    const [form, setForm] = React.useState(emptyForm);

    React.useEffect(() => {
        if (editingUser) {
            setForm({
                ...emptyForm,
                ...editingUser,
                medicaid: Boolean(editingUser.medicaid),
                schedule: { ...emptyForm.schedule, ...(editingUser.schedule || {}) },
            });
        } else {
            setForm(emptyForm);
        }
    }, [editingUser]);

    const handleSave = async () => {
        const payload = {
            ...form,
            apt: form.apt || null,
            dislikes: form.dislikes || null,
            county: form.county || null,
            zip: form.zip || null,
            medicaid: Boolean(form.medicaid),
            schedule: { ...(form.schedule || {}) },
        };
        await onSave(payload, editingUser);
    };

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
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
                        {["monday","tuesday","wednesday","thursday","friday","saturday","sunday"].map((day) => (
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
                <Button onClick={onClose}>Cancel</Button>
                <Button onClick={handleSave} variant="contained">Save</Button>
            </DialogActions>
        </Dialog>
    );
}