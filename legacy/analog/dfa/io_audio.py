"""Audio load/save. soundfile for WAV/FLAC/AIFF/OGG; ffmpeg decode for MP3/M4A/AAC."""
from __future__ import annotations

import os
import subprocess
import tempfile

import numpy as np
import soundfile as sf

FFMPEG = "/opt/homebrew/bin/ffmpeg"
COMPRESSED = {".mp3", ".m4a", ".aac", ".wma", ".opus"}


def load_audio(path: str):
    """Return (x float32 (n,) or (n,ch), sr). Compressed formats route through ffmpeg."""
    ext = os.path.splitext(path)[1].lower()
    if ext in COMPRESSED or not _sf_can_read(path):
        return _load_via_ffmpeg(path)
    x, sr = sf.read(path, dtype="float32", always_2d=False)
    return x, int(sr)


def _sf_can_read(path: str) -> bool:
    try:
        with sf.SoundFile(path):
            return True
    except Exception:
        return False


def _load_via_ffmpeg(path: str):
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmppath = tmp.name
    try:
        subprocess.run([FFMPEG, "-y", "-i", path, "-c:a", "pcm_f32le", tmppath],
                       check=True, capture_output=True)
        x, sr = sf.read(tmppath, dtype="float32", always_2d=False)
        return x, int(sr)
    finally:
        try:
            os.remove(tmppath)
        except OSError:
            pass


def save_wav(path: str, x: np.ndarray, sr: int, subtype: str = "PCM_24"):
    sf.write(path, x, sr, subtype=subtype)


def to_int16_stereo_bytes(x: np.ndarray, gain: float = 1.0) -> bytes:
    """Interleaved int16 stereo PCM bytes for QAudioSink playback."""
    y = x.astype(np.float32) * float(gain)
    if y.ndim == 1:
        y = np.stack([y, y], axis=1)
    elif y.shape[1] == 1:
        y = np.repeat(y, 2, axis=1)
    elif y.shape[1] > 2:
        y = y[:, :2]
    y = np.clip(y, -1.0, 1.0)
    return (y * 32767.0).astype("<i2").tobytes()
