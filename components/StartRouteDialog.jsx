// components/StartRouteDialog.jsx
"use client";

import * as React from "react";
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, Stack, Typography, TextField, FormControlLabel, Checkbox, Divider
} from "@mui/material";

export default function StartRouteDialog({
                                             open,
                                             onClose,
                                             onLoadExisting,
                                             onCreateNew,
                                             onAutoGeocodeAll, // optional
                                             defaultDriverCount = 6,
                                         }) {
    const [driverCount, setDriverCount] = React.useState(defaultDriverCount);
    const [offerManual, setOfferManual] = React.useState(true);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Routes — Load existing or create new?</DialogTitle>
            <DialogContent>
                <Stack spacing={2} sx={{ mt: 1 }}>
                    <Typography variant="body2">
                        Load the current routes and open the map. Any newly geocoded-but-unassigned users appear as gray points for manual assignment.
                    </Typography>

                    <Button variant="contained" size="large" onClick={onLoadExisting}>
                        Load existing route (recommended)
                    </Button>

                    {onAutoGeocodeAll && (
                        <Button variant="outlined" onClick={onAutoGeocodeAll}>
                            Auto Geocode All (show summary)
                        </Button>
                    )}

                    <Divider sx={{ my: 1 }} />

                    <Typography variant="subtitle2">Create a new route</Typography>
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
                    onClick={() => onCreateNew?.({ driverCount, offerManual })}
                    color="error"
                    variant="outlined"
                >
                    Create new (advanced)
                </Button>
            </DialogActions>
        </Dialog>
    );
}