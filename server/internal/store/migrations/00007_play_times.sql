-- +goose Up
-- One total per game instead of a list of sessions: the time a player has
-- saved from the timer in the app or typed in. A playthrough lives in the
-- event snapshot, so there is no foreign key to it.
DROP TABLE play_sessions;

CREATE TABLE play_times (
    event_id        bigint      NOT NULL REFERENCES events (id) ON DELETE CASCADE,
    playthrough_id  bigint      NOT NULL,
    user_id         bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    total_ms        bigint      NOT NULL CHECK (total_ms >= 0),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, playthrough_id)
);

-- +goose Down
DROP TABLE play_times;

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
