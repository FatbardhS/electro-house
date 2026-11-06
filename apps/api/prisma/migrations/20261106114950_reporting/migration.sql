-- AlterTable
ALTER TABLE "Floor" ADD COLUMN     "cableRouting" TEXT NOT NULL DEFAULT 'ceiling',
ADD COLUMN     "ceilingHeightMm" INTEGER NOT NULL DEFAULT 2600;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "Material" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,4) NOT NULL,
    "packSize" DECIMAL(12,3),
    "category" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialRule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "materialId" UUID NOT NULL,
    "quantity" DECIMAL(12,4) NOT NULL,
    "labourMinutes" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Material_organizationId_name_idx" ON "Material"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Material_organizationId_code_key" ON "Material"("organizationId", "code");

-- CreateIndex
CREATE INDEX "MaterialRule_organizationId_target_idx" ON "MaterialRule"("organizationId", "target");

-- AddForeignKey
ALTER TABLE "Material" ADD CONSTRAINT "Material_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRule" ADD CONSTRAINT "MaterialRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRule" ADD CONSTRAINT "MaterialRule_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
