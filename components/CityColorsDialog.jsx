import React from "react";
import { Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";

export default function CityColorsDialog({
                                             open, onClose,
                                             cityColors, addCityColor, removeCityColor
                                         }) {
    const [cityInput, setCityInput] = React.useState("");
    const [colorInput, setColorInput] = React.useState("#008000");

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
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
                        style={{ width: 48, height: 48, border: "none", background: "transparent", cursor: "pointer" }}
                        aria-label="Choose color"
                    />
                    <Button
                        variant="contained"
                        onClick={async () => {
                            await addCityColor(cityInput, colorInput);
                            setCityInput("");
                        }}
                    >
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
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
}