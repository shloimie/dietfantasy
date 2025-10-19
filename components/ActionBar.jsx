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
                    color="info"
                    onClick={onOpenDrivers}
                    disabled={disabled}
                    startIcon={<RouteIcon />}
                    sx={{ minWidth: 120, borderRadius: 9999 }}
                >
                    Route
                </Button>
            </Box>

            {/* Expanded shelf */}
            <Collapse in={openMore} unmountOnExit>
                <Box
                    sx={{
                        mt: 2,
                        background: "#fff",
                        border: "1px solid rgba(0,0,0,0.12)",
                        borderRadius: 2,
                        boxShadow: "0 8px 22px rgba(16,24,40,.06), 0 2px 8px rgba(16,24,40,.04)",
                        px: 2,
                        py: 1.5,
                    }}
                >
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" justifyContent="center">
                        <Button variant="contained" onClick={onAddUser} disabled={disabled}>
                            Add User
                        </Button>
                        <Button variant="outlined" onClick={onExportExcel} disabled={disabled}>
                            Export Excel
                        </Button>
                        <Button variant="outlined" onClick={onExportClientPdf} disabled={disabled}>
                            Export Clients (PDF)
                        </Button>
                        <Button variant="outlined" onClick={onExportLabels} disabled={disabled}>
                            Labels (PDF)
                        </Button>
                        <Button variant="outlined" onClick={onOpenCityColors} disabled={disabled}>
                            City Colors
                        </Button>
                    </Stack>
                </Box>
            </Collapse>
        </Box>
    );
}
