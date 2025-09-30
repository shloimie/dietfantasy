import { useState, useEffect } from "react";
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, TextField
} from "@mui/material";

export default function RegenerateDialog({ open, onClose, onConfirm, busy }) {
    const [drivers, setDrivers] = useState(6);

    useEffect(() => {
        if (open) setDrivers(6); // reset every time it's opened
    }, [open]);

    return (
        <Dialog open={open} onClose={busy ? undefined : onClose}>
            <DialogTitle>Regenerate Routes</DialogTitle>
            <DialogContent>
                <TextField
                    margin="dense"
                    label="Number of Drivers"
                    type="number"
                    value={drivers}
                    onChange={(e) => setDrivers(Math.max(1, Number(e.target.value || 1)))}
                    fullWidth
                    autoFocus
                    disabled={busy}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={busy}>Cancel</Button>
                <Button
                    onClick={() => onConfirm?.(drivers)}
                    disabled={busy}
                    color="error"
                    variant="contained"
                >
                    {busy ? "Working..." : "Regenerate"}
                </Button>
            </DialogActions>
        </Dialog>
    );
}