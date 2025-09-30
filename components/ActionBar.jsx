// components/ActionBar.jsx
"use client";

import * as React from "react";
import { Box, Button, Stack } from "@mui/material";

/**
 * ActionBar
 * - Buttons only disable when `busy === true`
 * - All handlers are optional (safe no-ops by default)
 */
export default function ActionBar({
                                      busy = false,
                                      onAddUser = () => {},
                                      onExportExcel = () => {},
                                      onExportClientPdf = () => {},
                                      onExportLabels = () => {},
                                      onOpenCityColors = () => {},
                                      onOpenDrivers = () => {},

                                  }) {
    const disabled = Boolean(busy);

    return (
        <Box sx={{ mb: 2 }}>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">

                <Button
                    variant="contained"
                    onClick={onAddUser}
                    disabled={disabled}
                >
                    Add User
                </Button>

                <Button
                    variant="outlined"
                    onClick={onExportExcel}
                    disabled={disabled}
                >
                    Export Excel
                </Button>

                <Button
                    variant="outlined"
                    onClick={onExportClientPdf}
                    disabled={disabled}
                >
                    Export Clients (PDF)
                </Button>

                <Button
                    variant="outlined"
                    onClick={onExportLabels}
                    disabled={disabled}
                >
                    Labels (PDF)
                </Button>

                <Button
                    variant="outlined"
                    onClick={onOpenCityColors}
                    disabled={disabled}
                >
                    City Colors
                </Button>

                <Button
                    variant="contained"
                    color="info"
                    onClick={onOpenDrivers}
                    disabled={disabled}
                >
                    Drivers
                </Button>
            </Stack>
        </Box>
    );
}