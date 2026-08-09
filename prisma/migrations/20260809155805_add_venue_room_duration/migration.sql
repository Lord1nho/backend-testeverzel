/*
  Warnings:

  - You are about to drop the column `location` on the `events` table. All the data in the column will be lost.
  - Added the required column `room` to the `events` table without a default value. This is not possible if the table is not empty.
  - Added the required column `venue` to the `events` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "venue" AS ENUM ('CINE_VERZEL_1', 'CINE_VERZEL_2');

-- AlterTable
ALTER TABLE "events" DROP COLUMN "location",
ADD COLUMN     "room" INTEGER NOT NULL,
ADD COLUMN     "venue" "venue" NOT NULL;

-- AlterTable
ALTER TABLE "external_catalog_items" ADD COLUMN     "duration_minutes" INTEGER;
