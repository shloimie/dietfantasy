-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "first" TEXT NOT NULL,
    "last" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "apt" TEXT,
    "city" TEXT NOT NULL,
    "dislikes" TEXT,
    "county" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "medicaid" TEXT NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "complex" BOOLEAN NOT NULL DEFAULT false
);
