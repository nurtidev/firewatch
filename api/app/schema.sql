-- FireWatch core schema (Phase 1). Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS buildings (
    id            BIGSERIAL PRIMARY KEY,
    osm_id        BIGINT UNIQUE,
    address       TEXT,
    building_type TEXT,                 -- residential / public / industrial
    osm_tag       TEXT,                 -- raw OSM building=* value
    year_built    INTEGER,
    floors        INTEGER,
    geom          geometry(Polygon, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS buildings_geom_gist ON buildings USING GIST (geom);
CREATE INDEX IF NOT EXISTS buildings_type_idx ON buildings (building_type);

CREATE TABLE IF NOT EXISTS incidents (
    id          BIGSERIAL PRIMARY KEY,
    building_id BIGINT REFERENCES buildings(id) ON DELETE CASCADE,
    occurred_at DATE,
    severity    SMALLINT,              -- 1..5
    geom        geometry(Point, 4326)
);

CREATE INDEX IF NOT EXISTS incidents_geom_gist ON incidents USING GIST (geom);

CREATE TABLE IF NOT EXISTS risk_scores (
    building_id   BIGINT PRIMARY KEY REFERENCES buildings(id) ON DELETE CASCADE,
    score         SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
    model_version TEXT NOT NULL,
    explanation   JSONB,
    computed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS risk_scores_score_idx ON risk_scores (score);

-- Module 03 · AI operational cards -------------------------------------------

CREATE TABLE IF NOT EXISTS operational_cards (
    id          BIGSERIAL PRIMARY KEY,
    building_id BIGINT REFERENCES buildings(id) ON DELETE SET NULL,
    filename    TEXT,
    media_type  TEXT,
    file_path   TEXT,
    status      TEXT NOT NULL DEFAULT 'extracted',  -- extracted / failed
    extracted   JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prescriptions (
    id            BIGSERIAL PRIMARY KEY,
    card_id       BIGINT REFERENCES operational_cards(id) ON DELETE CASCADE,
    issue         TEXT,
    recommendation TEXT NOT NULL,
    deadline_days INTEGER,
    severity      TEXT,                              -- low / medium / high
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prescriptions_card_idx ON prescriptions (card_id);

-- Module 04 · Inspection planning -------------------------------------------

ALTER TABLE buildings ADD COLUMN IF NOT EXISTS district TEXT;
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS last_inspected DATE;

CREATE INDEX IF NOT EXISTS buildings_district_idx ON buildings (district);

CREATE TABLE IF NOT EXISTS inspectors (
    id       BIGSERIAL PRIMARY KEY,
    name     TEXT NOT NULL,
    district TEXT
);

-- Module 05 · Firefighting infrastructure ------------------------------------

CREATE TABLE IF NOT EXISTS fire_stations (
    id       BIGSERIAL PRIMARY KEY,
    osm_id   BIGINT UNIQUE,
    name     TEXT,
    vehicles INTEGER,
    geom     geometry(Point, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS fire_stations_geom_gist ON fire_stations USING GIST (geom);

CREATE TABLE IF NOT EXISTS hydrants (
    id         BIGSERIAL PRIMARY KEY,
    osm_id     BIGINT UNIQUE,
    status     TEXT,                 -- ok / broken
    last_check DATE,
    geom       geometry(Point, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS hydrants_geom_gist ON hydrants USING GIST (geom);
