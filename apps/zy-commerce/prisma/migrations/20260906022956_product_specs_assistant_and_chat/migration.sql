-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "brand" TEXT,
ADD COLUMN     "specs" JSONB;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "assistantEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "assistantGreeting" TEXT,
ADD COLUMN     "assistantName" TEXT NOT NULL DEFAULT 'Product Assistant';

-- CreateTable
CREATE TABLE "ChatConversation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatConversation_tenantId_lastMessageAt_idx" ON "ChatConversation"("tenantId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatConversation_tenantId_sessionToken_key" ON "ChatConversation"("tenantId", "sessionToken");

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
