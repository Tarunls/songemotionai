import numpy as np
import pickle
from sklearn.ensemble import RandomForestRegressor
import os

print("Generating dummy training data (100 samples, 13 MFCC features)...")
X = np.random.rand(100, 13)
# Y is (valence, arousal) between 0 and 1
Y = np.random.rand(100, 2)

print("Training RandomForestRegressor...")
model = RandomForestRegressor(n_estimators=10)
model.fit(X, Y)

model_path = os.path.join(os.path.dirname(__file__), "emotion_model.pkl")
with open(model_path, "wb") as f:
    pickle.dump(model, f)

print(f"Dummy model saved to {model_path}")
