// components/ActionBar.jsx
"use client";

import * as React from "react";
import {
    Box,
    Button,
    Chip,
    Collapse,
    IconButton,
    InputAdornment,
    Stack,
    TextField,
} from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import RouteIcon from "@mui/icons-material/AltRoute";
import LockIcon from "@mui/icons-material/Lock";
import LogoutIcon from "@mui/icons-material/Logout";

export default function ActionBar({
                                      // state / display
                                      busy = false,
                                      search = "",
                                      setSearch = () => {},
                                      total = 0,

                                      // shelf control is owned by page (chin toggles this)
                                      openMore = false,
                                      setOpenMore = () => {},

                                      // actions
                                      onAddUser = () => {},
                                      onExportExcel = () => {},
                                      onExportClientPdf = () => {},
                                      onExportLabels = () => {},
                                      onOpenCityColors = () => {},
                                      onOpenDrivers = () => {},
                                      onChangePassword = () => {},
                                      onResetLogins = () => {},
                                  }) {
    const disabled = Boolean(busy);

    return (
        <Box sx={{ width: "100%", display: "grid", placeItems: "center" }}>
            {/* Main pill */}
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.75,
                    background: "#fff",
                    border: "1px solid rgba(0,0,0,0.05)",
                    borderRadius: "9999px",
                    boxShadow: "0 10px 24px rgba(0,0,0,0.08)",
                    px: 3,
                    py: 1.5,
                    maxWidth: 1100,
                    width: "100%",
                    justifyContent: "center",
                    position: "relative",
                    zIndex: 3, // sits above chin to hide the chin's top outline
                }}
            >
                <TextField
                    size="small"
                    placeholder="Search clients (name, address, city, phone, etc.)"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    sx={{
                        flex: 1,
                        minWidth: 520,
                        maxWidth: 760,
                        "& .MuiInputBase-root": { borderRadius: 9999 },
                    }}
                    InputProps={{
                        endAdornment: search ? (
                            <InputAdornment position="end">
                                <IconButton
                                    aria-label="Clear search"
                                    onClick={() => setSearch("")}
                                    edge="end"
                                    size="small"
                                >
                                    <ClearIcon fontSize="small" />
                                </IconButton>
                            </InputAdornment>
                        ) : null,
                    }}
                />

                <Chip label={`Total: ${total}`} variant="outlined" sx={{ fontWeight: 700 }} />
                <Button
                    variant="contained"
                    onClick={onAddUser}
                    disabled={disabled}
                    sx={{
                        minWidth: 120,
                        borderRadius: 9999,
                        fontWeight: 600,
                        textTransform: "none",
                        background: "linear-gradient(90deg, #4ade80, #22c55e)",
                        color: "#fff",
                        boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
                        transition: "all 0.2s ease",
                        "&:hover": {
                            background: "linear-gradient(90deg, #22c55e, #16a34a)",
                            boxShadow: "0 4px 10px rgba(0,0,0,0.1)",
                            transform: "translateY(-1px)",
                        },
                    }}
                >
                    Add User
                </Button>


                <Button
                    variant="contained"
                    onClick={onOpenDrivers}
                    disabled={disabled}
                    startIcon={<RouteIcon />}
                    sx={{
                        minWidth: 120,
                        borderRadius: 9999,
                        fontWeight: 600,
                        textTransform: "none",
                        background: "linear-gradient(90deg, #4ade80, #22c55e)", // lighter green gradient
                        color: "#fff",
                        boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
                        transition: "all 0.2s ease",
                        "&:hover": {
                            background: "linear-gradient(90deg, #22c55e, #16a34a)",
                            boxShadow: "0 4px 10px rgba(0,0,0,0.1)",
                            transform: "translateY(-1px)",
                        },
                    }}
                >
                    Route
                </Button>
            </Box>

            {/* Expanded shelf */}
            {/* Expanded shelf */}
            <Collapse in={openMore} unmountOnExit>
                <Box
                    sx={{
                        mt: 2,
                        background: "#fff",
                        border: "1px solid rgba(0,0,0,0.08)",
                        borderRadius: 2,
                        boxShadow: "0 8px 22px rgba(16,24,40,.06), 0 2px 8px rgba(16,24,40,.04)",
                        px: 2,
                        py: 1.5,
                    }}
                >
                    <Stack
                        direction="row"
                        spacing={1.5}
                        useFlexGap
                        flexWrap="wrap"
                        justifyContent="center"
                        sx={{
                            py: 1,
                            "& button": {
                                borderRadius: "9999px",
                                textTransform: "none",
                                fontWeight: 600,
                                px: 2.5,
                                transition: "all 0.2s ease",
                            },
                        }}
                    >


                        {/* Outlined buttons */}
                        <Button
                            variant="outlined"
                            onClick={onExportExcel}
                            disabled={disabled}
                            sx={{
                                borderColor: "#22c55e",
                                color: "#166534",
                                "&:hover": {
                                    borderColor: "#16a34a",
                                    backgroundColor: "rgba(34,197,94,0.08)",
                                },
                            }}
                        >
                            Export Excel
                        </Button>

                        <Button
                            variant="outlined"
                            onClick={onExportClientPdf}
                            disabled={disabled}
                            sx={{
                                borderColor: "#22c55e",
                                color: "#166534",
                                "&:hover": {
                                    borderColor: "#16a34a",
                                    backgroundColor: "rgba(34,197,94,0.08)",
                                },
                            }}
                        >
                            Export Clients (PDF)
                        </Button>

                        <Button
                            variant="outlined"
                            onClick={onExportLabels}
                            disabled={disabled}
                            sx={{
                                borderColor: "#22c55e",
                                color: "#166534",
                                "&:hover": {
                                    borderColor: "#16a34a",
                                    backgroundColor: "rgba(34,197,94,0.08)",
                                },
                            }}
                        >
                            Labels (PDF)
                        </Button>

                        <Button
                            variant="outlined"
                            onClick={onOpenCityColors}
                            disabled={disabled}
                            sx={{
                                borderColor: "#22c55e",
                                color: "#166534",
                                "&:hover": {
                                    borderColor: "#16a34a",
                                    backgroundColor: "rgba(34,197,94,0.08)",
                                },
                            }}
                        >
                            City Colors
                        </Button>

                        <Button
                            variant="outlined"
                            onClick={onChangePassword}
                            disabled={disabled}
                            startIcon={<LockIcon />}
                            sx={{
                                borderColor: "#ef4444",
                                color: "#991b1b",
                                "&:hover": {
                                    borderColor: "#dc2626",
                                    backgroundColor: "rgba(239,68,68,0.08)",
                                },
                            }}
                        >
                            Change Password
                        </Button>

                        <Button
                            variant="outlined"
                            onClick={onResetLogins}
                            disabled={disabled}
                            startIcon={<LogoutIcon />}
                            sx={{
                                borderColor: "#f59e0b",
                                color: "#92400e",
                                "&:hover": {
                                    borderColor: "#d97706",
                                    backgroundColor: "rgba(245,158,11,0.08)",
                                },
                            }}
                        >
                            Reset Logins
                        </Button>
                    </Stack>
                </Box>
            </Collapse>
        </Box>
    );
}
