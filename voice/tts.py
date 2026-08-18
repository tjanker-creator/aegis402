#!/usr/bin/env python3
"""Generates the narration with ElevenLabs (voice: Brian). Only regenerates a
segment whose text actually changed — the hash sits next to the mp3."""
import json, hashlib, pathlib, os, sys, urllib.request

here = pathlib.Path(__file__).parent
out = here / "segments"; out.mkdir(exist_ok=True)

env = {}
for line in (pathlib.Path.home() / ".config/jarvis/.env").read_text().splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")

KEY   = env["ELEVENLABS_API_KEY"]
VOICE = "nPczCjzI2devNBz1zQrb"          # Brian
MODEL = env.get("ELEVEN_MODEL", "eleven_multilingual_v2")

only = set(sys.argv[1:])
made = skipped = 0
for s in json.loads((here / "script.json").read_text()):
    if only and s["id"] not in only:
        continue
    mp3 = out / f"{s['id']}.mp3"
    sig = out / f"{s['id']}.sha"
    h = hashlib.sha256((MODEL + VOICE + s["text"]).encode()).hexdigest()
    if mp3.exists() and sig.exists() and sig.read_text() == h:
        skipped += 1; continue
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}",
        data=json.dumps({"text": s["text"], "model_id": MODEL,
                         "voice_settings": {"stability": 0.45, "similarity_boost": 0.8,
                                            "style": 0.30, "use_speaker_boost": True}}).encode(),
        headers={"xi-api-key": KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        mp3.write_bytes(r.read())
    sig.write_text(h)
    made += 1
    print(f"  {s['id']:14s} {mp3.stat().st_size/1024:6.0f} KB")
print(f"neu: {made} · unveraendert: {skipped}")
