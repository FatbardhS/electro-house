-- AlterTable
ALTER TABLE "Component" ADD COLUMN     "circuitId" UUID;

-- CreateTable
CREATE TABLE "Circuit" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "boardComponentId" UUID,
    "phase" TEXT NOT NULL,
    "voltage" DOUBLE PRECISION NOT NULL,
    "protection" TEXT NOT NULL,
    "breakerRatingA" DOUBLE PRECISION,
    "breakerCurve" TEXT,
    "rcdGroup" TEXT,
    "residualCurrentMa" DOUBLE PRECISION,
    "cableType" TEXT,
    "crossSectionMm2" DOUBLE PRECISION,
    "manualLoadW" DOUBLE PRECISION,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Circuit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorLink" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "fromComponentId" UUID NOT NULL,
    "toComponentId" UUID NOT NULL,
    "lengthM" DOUBLE PRECISION NOT NULL,
    "cable" JSONB NOT NULL,
    "circuitId" UUID,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FloorLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Circuit_projectId_idx" ON "Circuit"("projectId");

-- CreateIndex
CREATE INDEX "FloorLink_projectId_idx" ON "FloorLink"("projectId");

-- AddForeignKey
ALTER TABLE "Component" ADD CONSTRAINT "Component_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "Circuit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wire" ADD CONSTRAINT "Wire_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "Circuit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Circuit" ADD CONSTRAINT "Circuit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Circuit" ADD CONSTRAINT "Circuit_boardComponentId_fkey" FOREIGN KEY ("boardComponentId") REFERENCES "Component"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorLink" ADD CONSTRAINT "FloorLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorLink" ADD CONSTRAINT "FloorLink_fromComponentId_fkey" FOREIGN KEY ("fromComponentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorLink" ADD CONSTRAINT "FloorLink_toComponentId_fkey" FOREIGN KEY ("toComponentId") REFERENCES "Component"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorLink" ADD CONSTRAINT "FloorLink_circuitId_fkey" FOREIGN KEY ("circuitId") REFERENCES "Circuit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
