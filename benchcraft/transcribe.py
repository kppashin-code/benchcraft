import importlib.util
import os
import shutil
import subprocess
from pathlib import Path

MODEL_REPO = os.environ.get("BENCHCRAFT_WHISPER", "mlx-community/whisper-large-v3-turbo")


class Unavailable(RuntimeError):
    pass


def _has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def _has_mlx() -> bool:
    try:
        return importlib.util.find_spec("mlx_whisper") is not None
    except Exception:
        return False


def status() -> dict:
    ffmpeg, mlx = _has_ffmpeg(), _has_mlx()
    if ffmpeg and mlx:
        return {"ready": True, "engine": f"mlx-whisper ({MODEL_REPO})", "missing": []}
    missing = []
    if not ffmpeg:
        missing.append("ffmpeg (brew install ffmpeg)")
    if not mlx:
        missing.append("mlx-whisper (./.venv/bin/pip install -r requirements-voice.txt)")
    return {"ready": False, "engine": None, "missing": missing}


def duration_seconds(path: Path) -> float | None:
    if not shutil.which("ffprobe"):
        return None
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        return round(float(out.stdout.strip()), 1)
    except Exception:
        return None


def transcribe(path: Path) -> tuple[str, str]:
    st = status()
    if not st["ready"]:
        raise Unavailable("; ".join(st["missing"]))
    import mlx_whisper

    result = mlx_whisper.transcribe(str(path), path_or_hf_repo=MODEL_REPO)
    text = (result.get("text") or "").strip()
    if not text:
        raise Unavailable("No speech found in the file.")
    return text, st["engine"]
