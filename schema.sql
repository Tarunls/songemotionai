-- Supabase Schema for AI Music Emotion Visualizer
-- Updated for 5-dimensional Emotional Fingerprint training pipeline

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Drop the old table if migrating (comment this out if you want to keep old data)
-- DROP TABLE IF EXISTS track_feedback;

CREATE TABLE track_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    track_id TEXT NOT NULL,
    user_intensity INT,
    user_mood INT,
    user_groove INT,
    user_tone INT,
    user_texture INT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row Level Security (RLS) Policies
ALTER TABLE track_feedback ENABLE ROW LEVEL SECURITY;

-- Allow inserts (In production, restrict to authenticated users)
CREATE POLICY "Enable insert for all users" ON track_feedback
    FOR INSERT WITH CHECK (true);

-- Allow users to read their own feedback (Or open it for public aggregated models)
CREATE POLICY "Enable read access for all users" ON track_feedback
    FOR SELECT USING (true);
