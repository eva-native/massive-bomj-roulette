-- +goose Up
-- Play sessions of a game: the time a player spent on it, saved from the
-- timer in the app or typed in by hand. Their sum is the player's hint for
-- the hours of the game. A playthrough lives in the event snapshot, so there
-- is no foreign key to it.
CREATE TABLE play_sessions (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id        bigint      NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    user_id         bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    playthrough_id  bigint      NOT NULL,
    started_at      timestamptz NOT NULL,
    duration_ms     bigint      NOT NULL CHECK (duration_ms > 0),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX play_sessions_playthrough_idx ON play_sessions (event_id, playthrough_id);

-- +goose Down
DROP TABLE play_sessions;
