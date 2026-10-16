"""Pre-render ECHO's voice with Coqui TTS.

Collects every sentence ECHO can say (by loading each page with ?echo-lines in
headless Chrome), synthesises each one with a Coqui TTS model, and writes small
MP3 clips plus a manifest to audio/echo/. Re-run it whenever page text or
ECHO's lines in voice.js change; unchanged sentences are skipped.

    pip install -r tools/voice/requirements.txt
    python tools/voice/generate.py
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "audio" / "echo"
PAGES = ["index.html", "worlds.html"]
MODEL = os.environ.get("ECHO_MODEL", "tts_models/en/ljspeech/vits")
SPEAKER = os.environ.get("ECHO_SPEAKER")  # only for multi-speaker models, e.g. p230 for vctk/vits
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")

# Spoken forms for things a TTS model would otherwise misread
SPOKEN = [
    (r"\s*—\s*", ", "),
    (r"1/120 s step", "step of one one-hundred-twentieth of a second"),
    (r"\bdt\b", "d t"),
    (r"\b3D\b", "three D"),
    (r"\bSPH\b", "S P H"),
]


def collect_lines():
    lines = []
    for page in PAGES:
        url = (ROOT / page).as_uri() + "?echo-lines"
        dom = subprocess.run(
            [CHROME, "--headless=new", "--disable-gpu", "--virtual-time-budget=4000", "--dump-dom", url],
            capture_output=True, text=True, check=True,
        ).stdout
        m = re.search(r'<script type="application/json" id="echo-lines">(.*?)</script>', dom, re.S)
        if not m:
            sys.exit(f"Could not read ECHO's lines from {page}")
        lines += json.loads(m.group(1))
    return list(dict.fromkeys(lines))


def spoken(sentence):
    for pattern, repl in SPOKEN:
        sentence = re.sub(pattern, repl, sentence)
    return sentence


def clip_name(sentence):
    key = f"{MODEL}|{SPEAKER}|{spoken(sentence)}"
    return hashlib.sha1(key.encode()).hexdigest()[:12] + ".mp3"


def main():
    lines = collect_lines()
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {s: clip_name(s) for s in lines}
    todo = [s for s in lines if not (OUT / manifest[s]).exists()]
    print(f"{len(lines)} sentences, {len(todo)} to render with {MODEL}")

    if todo:
        from TTS.api import TTS

        tts = TTS(MODEL)
        with tempfile.TemporaryDirectory() as tmp:
            for i, sentence in enumerate(todo, 1):
                wav = Path(tmp) / "clip.wav"
                tts.tts_to_file(text=spoken(sentence), file_path=str(wav), **({"speaker": SPEAKER} if SPEAKER else {}))
                # Trim leading/trailing silence, even out loudness, encode a small mono MP3
                subprocess.run(
                    ["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-af",
                     "silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
                     "silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
                     "loudnorm=I=-18:TP=-1.5",
                     "-ac", "1", "-ar", "22050", "-b:a", "48k", str(OUT / manifest[sentence])],
                    check=True,
                )
                print(f"[{i}/{len(todo)}] {sentence}")

    # Drop clips for sentences ECHO no longer says
    keep = set(manifest.values())
    for f in OUT.glob("*.mp3"):
        if f.name not in keep:
            f.unlink()

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    print(f"Wrote {OUT / 'manifest.json'}")


if __name__ == "__main__":
    main()
