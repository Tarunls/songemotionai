# Song Emotion AI

**[Live demo](https://songemotionai.vercel.app)**

Most music tools sort songs by genre or tempo. This one tries to sort them by how they actually feel.

Song Emotion AI scores a track across a 5-dimensional "emotional fingerprint" — intensity, mood, groove, tone, and texture — instead of forcing it into a single genre label or a flat "happy/sad" score. The idea is that two songs can both be labeled "sad" and feel completely different, and a single category can't capture that.

## How it works

The frontend (Next.js 16, React 19, Tailwind, Framer Motion) plays and visualizes tracks and collects listener feedback across each of the five dimensions. That feedback is written to a Supabase/Postgres backend, with row-level security policies scoping what can be read and written, so the ratings data stays structured and query-able as it grows.

On the backend, a Python service (FastAPI) handles the emotion modeling, built on PyTorch, Hugging Face Transformers, and sentence-transformers, with scikit-learn for the supporting analysis layer.

## Stack

**Frontend** — Next.js 16, React 19, TypeScript, Tailwind CSS, Framer Motion
**Backend** — Python, FastAPI, PyTorch, Transformers, scikit-learn
**Data** — Supabase (Postgres) with RLS policies for feedback storage

## Status

Actively evolving — the emotional fingerprint model improves as more listener feedback comes in through the live app.
