"""
tools/make_voices.py — turns every narrator line into a voice file with Kokoro (free, runs on CPU).

The game plays assets/voice/<id>.wav for any line listed in assets/voice/manifest.json,
and falls back to the browser's own speech for the rest. So you can (re)generate any time.

One-time setup (in a terminal):
    pip install kokoro soundfile
    (Kokoro's docs also recommend installing espeak-ng; on Windows use the .msi from its GitHub releases.)

Each time the lines change:
    node tools/export-lines.mjs        # writes assets/voice/lines.json
    python tools/make_voices.py        # writes the .wav files and manifest.json

Options:
    python tools/make_voices.py --voice af_heart --speed 0.95
    python tools/make_voices.py --only want_frog_pond     # redo one line

NOTE (Claude): written to Kokoro's documented Python API, but not run here, because model downloads
are blocked in Claude's workspace. If something fails on first run, paste the error to Claude.
"""

import argparse
import json
import os

import numpy as np  # number arrays; Kokoro returns audio as one
import soundfile as sf  # writes .wav files
from kokoro import KPipeline  # the text-to-speech model

HERE = os.path.dirname(os.path.abspath(__file__))
VOICE_DIR = os.path.join(HERE, "..", "assets", "voice")
SAMPLE_RATE = 24000  # Kokoro's output rate (samples per second)

parser = argparse.ArgumentParser()
# DECISION (Claude): 'af_heart', a warm American English voice, slightly slow for a five-year-old.
parser.add_argument("--voice", default="af_heart", help="Kokoro voice name (see Kokoro's VOICES list)")
parser.add_argument("--speed", type=float, default=0.95)
parser.add_argument("--only", default=None, help="generate just this one line id")
args = parser.parse_args()

with open(os.path.join(VOICE_DIR, "lines.json"), encoding="utf-8") as f:
    lines = json.load(f)

# lang_code 'a' = American English ('b' would be British English).
pipeline = KPipeline(lang_code="a")

done = []
for line_id, text in lines.items():
    out_path = os.path.join(VOICE_DIR, f"{line_id}.wav")
    if args.only and line_id != args.only:
        if os.path.exists(out_path):
            done.append(line_id)
        continue
    # The pipeline yields the text in chunks (sentence-ish pieces); glue their audio together.
    chunks = [audio for _, _, audio in pipeline(text, voice=args.voice, speed=args.speed)]
    audio = np.concatenate([np.asarray(c) for c in chunks])
    sf.write(out_path, audio, SAMPLE_RATE)
    done.append(line_id)
    print(f"  {line_id}: {text}")

with open(os.path.join(VOICE_DIR, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(sorted(done), f, indent=1)
print(f"\n{len(done)} voice files ready in assets/voice. Refresh the game to hear them.")
