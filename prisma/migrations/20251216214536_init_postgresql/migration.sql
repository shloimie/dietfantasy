-- CreateTable
CREATE TABLE "public"."User" (
    "id" SERIAL NOT NULL,
    "first" TEXT NOT NULL,
    "last" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "apt" TEXT,
    "city" TEXT NOT NULL,
    "dislikes" TEXT,
    "county" TEXT,
    "zip" TEXT,
    "state" TEXT,
    "phone" TEXT,
    "medicaid" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "complex" BOOLEAN NOT NULL DEFAULT false,
    "clientId" TEXT,
    "caseId" TEXT,
    "billings" JSONB NOT NULL DEFAULT '[]',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "geocodedAt" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "visits" JSONB NOT NULL DEFAULT '[]',
    "sign_token" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bill" BOOLEAN NOT NULL DEFAULT true,
    "delivery" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Signature" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "strokes" JSONB NOT NULL,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Route" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "stop_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Schedule" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "monday" BOOLEAN NOT NULL DEFAULT true,
    "tuesday" BOOLEAN NOT NULL DEFAULT true,
    "wednesday" BOOLEAN NOT NULL DEFAULT true,
    "thursday" BOOLEAN NOT NULL DEFAULT true,
    "friday" BOOLEAN NOT NULL DEFAULT true,
    "saturday" BOOLEAN NOT NULL DEFAULT true,
    "sunday" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CityColor" (
    "id" SERIAL NOT NULL,
    "city" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CityColor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Driver" (
    "id" SERIAL NOT NULL,
    "day" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "stopIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Stop" (
    "id" SERIAL NOT NULL,
    "day" TEXT NOT NULL,
    "userId" INTEGER,
    "order" INTEGER,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "apt" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "phone" TEXT,
    "dislikes" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "proofUrl" TEXT,
    "assignedDriverId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RouteRun" (
    "id" SERIAL NOT NULL,
    "day" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "RouteRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_sign_token_key" ON "public"."User"("sign_token");

-- CreateIndex
CREATE INDEX "User_clientId_idx" ON "public"."User"("clientId");

-- CreateIndex
CREATE INDEX "User_caseId_idx" ON "public"."User"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "Signature_user_id_slot_key" ON "public"."Signature"("user_id", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "Schedule_userId_key" ON "public"."Schedule"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CityColor_city_key" ON "public"."CityColor"("city");

-- CreateIndex
CREATE INDEX "Driver_day_idx" ON "public"."Driver"("day");

-- CreateIndex
CREATE INDEX "Stop_day_idx" ON "public"."Stop"("day");

-- CreateIndex
CREATE INDEX "RouteRun_day_createdAt_idx" ON "public"."RouteRun"("day", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "public"."Signature" ADD CONSTRAINT "Signature_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Schedule" ADD CONSTRAINT "Schedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
