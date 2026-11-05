-- CreateTable
CREATE TABLE "Wire" (
    "id" UUID NOT NULL,
    "floorId" UUID NOT NULL,
    "label" TEXT,
    "fromComponentId" UUID,
    "fromPortId" TEXT,
    "fromX" DOUBLE PRECISION NOT NULL,
    "fromY" DOUBLE PRECISION NOT NULL,
    "toComponentId" UUID,
    "toPortId" TEXT,
    "toX" DOUBLE PRECISION NOT NULL,
    "toY" DOUBLE PRECISION NOT NULL,
    "points" JSONB NOT NULL DEFAULT '[]',
    "cable" JSONB NOT NULL,
    "circuitId" UUID,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wire_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Wire_floorId_idx" ON "Wire"("floorId");

-- CreateIndex
CREATE INDEX "Wire_fromComponentId_idx" ON "Wire"("fromComponentId");

-- CreateIndex
CREATE INDEX "Wire_toComponentId_idx" ON "Wire"("toComponentId");

-- AddForeignKey
ALTER TABLE "Wire" ADD CONSTRAINT "Wire_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wire" ADD CONSTRAINT "Wire_fromComponentId_fkey" FOREIGN KEY ("fromComponentId") REFERENCES "Component"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wire" ADD CONSTRAINT "Wire_toComponentId_fkey" FOREIGN KEY ("toComponentId") REFERENCES "Component"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
