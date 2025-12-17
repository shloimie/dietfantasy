// components/ChangePasswordDialog.jsx
"use client";

import * as React from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Button,
    Box,
    Alert,
    Typography,
} from "@mui/material";
import LockIcon from "@mui/icons-material/Lock";

export default function ChangePasswordDialog({ open, onClose, onSuccess }) {
    const [adminPassword, setAdminPassword] = React.useState("");
    const [newPassword, setNewPassword] = React.useState("");
    const [confirmPassword, setConfirmPassword] = React.useState("");
    const [error, setError] = React.useState("");
    const [loading, setLoading] = React.useState(false);

    const handleClose = () => {
        if (!loading) {
            setAdminPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setError("");
            onClose();
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");

        // Validation
        if (!adminPassword) {
            setError("Admin password is required");
            return;
        }

        if (!newPassword) {
            setError("New password is required");
            return;
        }

        if (newPassword.length < 3) {
            setError("New password must be at least 3 characters");
            return;
        }

        if (newPassword !== confirmPassword) {
            setError("New passwords do not match");
            return;
        }

        setLoading(true);
        try {
            const res = await fetch("/api/auth/change-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    adminPassword,
                    newPassword,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Failed to change password");
            }

            // Success
            setAdminPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setError("");
            if (onSuccess) onSuccess();
            handleClose();
        } catch (e) {
            setError(e.message || "Failed to change password");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <form onSubmit={handleSubmit}>
                <DialogTitle>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <LockIcon />
                        <Typography variant="h6">Change Password</Typography>
                    </Box>
                </DialogTitle>
                <DialogContent>
                    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
                        {error && (
                            <Alert severity="error" onClose={() => setError("")}>
                                {error}
                            </Alert>
                        )}

                        <Typography variant="body2" color="text.secondary">
                            Enter your admin password to verify your identity, then set a new app password.
                        </Typography>

                        <TextField
                            label="Admin Password"
                            type="password"
                            value={adminPassword}
                            onChange={(e) => setAdminPassword(e.target.value)}
                            disabled={loading}
                            required
                            fullWidth
                            autoFocus
                        />

                        <TextField
                            label="New App Password"
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            disabled={loading}
                            required
                            fullWidth
                            helperText="This will be the new password for logging into the app"
                        />

                        <TextField
                            label="Confirm New Password"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            disabled={loading}
                            required
                            fullWidth
                        />
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleClose} disabled={loading}>
                        Cancel
                    </Button>
                    <Button type="submit" variant="contained" disabled={loading}>
                        {loading ? "Changing..." : "Change Password"}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}

