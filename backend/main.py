import os
import random
import tempfile
import base64
import numpy as np
import httpx
import librosa
import re
import pickle
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

url: str = os.environ.get("SUPABASE_URL", "")
key: str = os.environ.get("SUPABASE_ANON_KEY", "")
supabase: Client | None = create_client(url, key) if url and key else None

app = FastAPI(title="AI Music Emotion Visualizer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class EmotionPrediction(BaseModel):
    valence: float
    arousal: float

class EmotionalFingerprint(BaseModel):
    """5-dimensional human training data for the emotion model."""
    track_id: str
    user_intensity: int
    user_mood: int
    user_groove: int
    user_tone: int
    user_texture: int

# Legacy feedback model (kept for backward compatibility)
class Feedback(BaseModel):
    user_id: str
    track_id: str
    predicted_valence: float
    predicted_arousal: float
    user_valence: float
    user_arousal: float

# Load the Scikit-Learn Model
MODEL_PATH = os.path.join(os.path.dirname(__file__), "emotion_model.pkl")
model = None
if os.path.exists(MODEL_PATH):
    with open(MODEL_PATH, "rb") as f:
        model = pickle.load(f)

async def get_spotify_token():
    client_id = os.environ.get("SPOTIFY_CLIENT_ID")
    client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET")
    if not client_id or not client_secret or client_id == "dummy":
        return None
    auth_str = f"{client_id}:{client_secret}"
    b64_auth_str = base64.b64encode(auth_str.encode()).decode()
    
    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://accounts.spotify.com/api/token",
            headers={
                "Authorization": f"Basic {b64_auth_str}",
                "Content-Type": "application/x-www-form-urlencoded"
            },
            data={"grant_type": "client_credentials"}
        )
        if res.status_code == 200:
            return res.json().get("access_token")
    return None

async def get_track_preview(track_id: str, token: str):
    async with httpx.AsyncClient() as client:
        res = await client.get(
            f"https://api.spotify.com/v1/tracks/{track_id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        if res.status_code == 200:
            return res.json().get("preview_url")
    return None

@app.get("/analyze", response_model=EmotionPrediction)
async def analyze_track(track_id: str):
    """
    Fetches the 30-second preview audio, extracts features using librosa,
    and runs the prediction model.
    """
    if track_id == "mock":
        return EmotionPrediction(valence=random.uniform(0.0, 1.0), arousal=random.uniform(0.0, 1.0))
        
    token = await get_spotify_token()
    preview_url = await get_track_preview(track_id, token) if token else None
    
    if not preview_url:
        # Fallback if no preview is available
        return EmotionPrediction(valence=random.uniform(0.0, 1.0), arousal=random.uniform(0.0, 1.0))
        
    async with httpx.AsyncClient() as client:
        audio_data = await client.get(preview_url)
        
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as temp_audio:
        temp_audio.write(audio_data.content)
        temp_audio_path = temp_audio.name
        
    try:
        y, sr = librosa.load(temp_audio_path, sr=22050, duration=30)
        mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
        features = np.mean(mfcc.T, axis=0).reshape(1, -1)
        
        if model:
            pred = model.predict(features)[0]
            val = float(np.clip(pred[0], 0.0, 1.0))
            aro = float(np.clip(pred[1], 0.0, 1.0))
        else:
            val = random.uniform(0.0, 1.0)
            aro = random.uniform(0.0, 1.0)
            
    finally:
        os.remove(temp_audio_path)
        
    return EmotionPrediction(valence=val, arousal=aro)

@app.post("/api/sync")
async def sync_fingerprint(fingerprint: EmotionalFingerprint):
    """
    Receives 5-dimensional emotional fingerprint training data from the frontend.
    Saves to Supabase with no predicted_ values (null during training phase).
    """
    if not supabase:
        return {"status": "mock_success", "message": "Supabase keys missing, mocked insert.", "data": fingerprint.model_dump()}
    
    try:
        response = supabase.table("track_feedback").insert(fingerprint.model_dump()).execute()
        return {"status": "success", "data": response.data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# Legacy endpoint kept for backward compatibility
@app.post("/feedback")
async def submit_feedback(feedback: Feedback):
    """
    Saves human-in-the-loop corrections to Supabase for future retraining.
    """
    if not supabase:
        return {"status": "mock_success", "message": "Supabase keys missing, mocked insert."}
    
    try:
        response = supabase.table("track_feedback").insert(feedback.model_dump()).execute()
        return {"status": "success", "data": response.data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/lyrics")
async def get_lyrics(track_name: str, artist_name: str):
    """
    Fetches time-synced lyrics from LRCLIB using the forgiving Search endpoint 
    and strips out messy Spotify metadata tags.
    """
    # 1. Scrub Spotify's messy tags (Removes " - Remastered", "(feat. )", etc.)
    clean_track = re.sub(r' \(.*?\)| \- .*', '', track_name).strip()
    
    headers = {
        "User-Agent": "Nextjs-Spotify-Visualizer-App/1.0"
    }

    async with httpx.AsyncClient() as client:
        try:
            # 2. Use the flexible /search endpoint instead of the strict /get endpoint
            search_url = "https://lrclib.net/api/search"
            params = {
                "q": f"{clean_track} {artist_name}"
            }
            
            response = await client.get(search_url, params=params, headers=headers)
            
            if response.status_code == 200:
                results = response.json()
                
                # 3. Loop through the search results to find the first one that has synced lyrics
                for track in results:
                    if track.get("syncedLyrics"):
                        return {"synced": True, "lyrics": track["syncedLyrics"], "debug_name": track.get("trackName")}
                
                # 4. If we found the song but it only has static lyrics
                if len(results) > 0 and results[0].get("plainLyrics"):
                     return {"synced": False, "lyrics": results[0]["plainLyrics"], "error": "Found the song, but no synced timestamps exist yet."}
            
            return {"synced": False, "lyrics": None, "error": f"Lyrics completely missing for {clean_track}."}
            
        except Exception as e:
            return {"synced": False, "lyrics": None, "error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
