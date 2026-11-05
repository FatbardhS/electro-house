-- AlterTable
ALTER TABLE "Floor" ADD COLUMN     "drawingRevision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Layer" (
    "id" UUID NOT NULL,
    "floorId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Layer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Component" (
    "id" UUID NOT NULL,
    "floorId" UUID NOT NULL,
    "typeKey" TEXT NOT NULL,
    "typeVersion" INTEGER NOT NULL,
    "layerKey" TEXT NOT NULL,
    "label" TEXT,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mountHeightMm" INTEGER,
    "description" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Component_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Layer_floorId_key_key" ON "Layer"("floorId", "key");

-- CreateIndex
CREATE INDEX "Component_floorId_idx" ON "Component"("floorId");

-- AddForeignKey
ALTER TABLE "Layer" ADD CONSTRAINT "Layer_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Component" ADD CONSTRAINT "Component_floorId_fkey" FOREIGN KEY ("floorId") REFERENCES "Floor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
