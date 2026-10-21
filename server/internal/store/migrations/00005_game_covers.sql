-- +goose Up
-- Link to a cover picture of the game; empty when there is none.
ALTER TABLE games ADD COLUMN cover_url text NOT NULL DEFAULT '';

-- +goose Down
ALTER TABLE games DROP COLUMN cover_url;
