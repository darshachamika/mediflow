CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS opd_faq_vectors (
    guide_id integer NOT NULL REFERENCES opd_faq_guides ("Id") ON DELETE CASCADE,
    model text NOT NULL,
    embedding vector NOT NULL,
    PRIMARY KEY (guide_id, model)
);
