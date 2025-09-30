// components/CityColorsDialog.jsx
"use client";

import * as React from "react";
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, TextField, Chip, Stack, Box
} from "@mui/material";

export default function CityColorsDialog({
                                             open,
                                             onClose,
                                             cityColors = {},      // <- defensively default to {}
                                             onChange = () => {},  // <- safe no-op
                                         }) {
    const [localColors, setLocalColors] = React.useState(cityColors || {});
    const [newCity, setNewCity] = React.useState("");
    const [newHex, setNewHex] = React.useState("#377eb8");

    React.useEffect(() => {
        // Sync when parent colors change
        setLocalColors(cityColors && typeof cityColors === "object" ? { ...cityColors } : {});
    }, [cityColors]);

    const handleSet = (city, hex) => {
        if (!city) return;
        setLocalColors((prev) => ({ ...prev, [city]: hex || "#377eb8" }));
    };

    const handleDelete = (city) => {
        setLocalColors((prev) => {
            const next = { ...prev };
            delete next[city];
            return next;
        });
    };

    const handleSave = () => {
        onChange(localColors); // push up to parent
        onClose?.();
    };

    const entries = Object.entries(localColors || {}).sort((a, b) =>
        a[0].localeCompare(b[0])
    );

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>City Colors</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2}>
                    <Box sx={{ display: "flex", gap: 1 }}>
                        <TextField
                            label="City"
                            value={newCity}
                            onChange={(e) => setNewCity(e.target.value)}
                            size="small"
                            fullWidth
                        />
                        <input
                            type="color"
                            value={newHex}
                            onChange={(e) => setNewHex(e.target.value)}
                            style={{ width: 56, height: 40, border: "1px solid #ccc", borderRadius: 6 }}
                            title="Pick color"
                        />
                        <Button
                            variant="contained"
                            onClick={() => {
                                const c = newCity.trim();
                                if (!c) return;
                                handleSet(c, newHex);
                                setNewCity("");
                            }}
                        >
                            Add / Update
                        </Button>
                    </Box>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {entries.length === 0 ? (
                            <em style={{ opacity: 0.6 }}>No cities yet</em>
                        ) : (
                            entries.map(([city, hex]) => (
                                <Chip
                                    key={city}
                                    label={`${city} (${hex})`}
                                    onDelete={() => handleDelete(city)}
                                    style={{
                                        borderColor: hex,
                                        borderWidth: 2,
                                        borderStyle: "solid",
                                        color: hex,
                                        fontWeight: 600,
                                    }}
                                    variant="outlined"
                                />
                            ))
                        )}
                    </div>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button onClick={handleSave} variant="contained">Save</Button>
            </DialogActions>
        </Dialog>
    );
}