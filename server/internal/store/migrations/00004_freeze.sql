-- +goose Up
-- Version of the item catalog the event's points were last computed with.
ALTER TABLE events ADD COLUMN rules_version text NOT NULL DEFAULT '';
-- Final standings of a finished event; reads use this instead of the engine.
ALTER TABLE event_states ADD COLUMN frozen jsonb;

-- +goose Down
ALTER TABLE event_states DROP COLUMN frozen;
ALTER TABLE events DROP COLUMN rules_version;
