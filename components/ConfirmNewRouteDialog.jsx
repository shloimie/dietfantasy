// components/ConfirmNewRouteDialog.jsx
"use client";

import * as React from "react";
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, Stack, Typography, TextField, FormControlLabel, Checkbox
} from "@mui/material";

export default function ConfirmNewRouteDialog({
                                                  open,
                                                  onClose,
                                                  initialDriverCount = 6,
                                                  initialOfferManual = true,
                                                  onConfirm, // ({ driverCount, offerManual }) => void
                                              }) {
    const [driverCount, setDriverCount] = React.useState(initialDriverCount);
    const [offerManual, setOfferManual] = React.useState(initialOfferManual);
    const [confirmText, setConfirmText] = React.useState("");

    const canConfirm = confirmText.trim().toLowerCase() === "yes";

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Confirm new route generation</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <Typography variant="body2">
                        This will regenerate drivers and stops for the selected day and update the database.
                        Type <b>YES</b> to confirm.
                    </Typography>
                    <TextField
                        size="small"
                        label='Type "YES" to confirm'
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                    />
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <TextField
                            type="number"
                            size="small"
                            label="Number of drivers"
                            value={driverCount}
                            onChange={(e) => setDriverCount(Math.max(1, Number(e.target.value || 1)))}
                            inputProps={{ min: 1 }}
                            sx={{ maxWidth: 200 }}
                        />
                    </Stack>
                    <FormControlLabel
                        control={<Checkbox checked={offerManual} onChange={(e) => setOfferManual(e.target.checked)} />}
                        label="Open manual geolocation before generating"
                    />
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    onClick={() => onConfirm?.({ driverCount, offerManual })}
                    variant="contained"
                    color="error"
                    disabled={!canConfirm}
                >
                    Confirm & Generate
                </Button>
            </DialogActions>
        </Dialog>
    );
}