-- CreateIndex
CREATE INDEX "events_venue_room_status_idx" ON "events"("venue", "room", "status");
