-- Interface language per user: Albanian by default.
ALTER TABLE "User" ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'sq';
