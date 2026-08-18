#!/usr/bin/env python3
"""Builds a single self-contained HTML film: Brian narrates, the terminal replays
real captured runs, real TEAL scrolls behind the forensics scene.
No server, no external assets, no ffmpeg."""
import json, base64, re, subprocess, pathlib

here = pathlib.Path(__file__).parent
segs = json.loads((here / "script.json").read_text())

def dur(p):
    o = subprocess.run(["/usr/bin/afinfo", str(p)], capture_output=True, text=True).stdout
    m = re.search(r"estimated duration: ([0-9.]+)", o)
    return float(m.group(1)) if m else 5.0

def strip_ansi(s):
    return re.sub(r"\x1b\[[0-9;]*m", "", s)

def cap(name):
    t = strip_ansi((here / "captures" / f"{name}.txt").read_text())
    return [l.rstrip() for l in t.splitlines()]

data = []
for s in segs:
    p = here / "segments" / f"{s['id']}.mp3"
    data.append({
        "id": s["id"], "scene": s["scene"], "text": s["text"],
        "dur": dur(p),
        "audio": base64.b64encode(p.read_bytes()).decode(),
    })

captures = {"agent": cap("agent"), "fee": cap("fee"), "onchain": cap("onchain"), "attested": cap("attested"), "multiply": cap("multiply"), "attested3": cap("attested3")}

# real vault LogicSig source, comments stripped of the box-drawing noise
teal = (here.parent / "contracts" / "vault.teal.tmpl").read_text().splitlines()
teal = [l for l in teal if not l.startswith("// ===")]
teal = [l.rstrip() for l in teal][:78]

tpl = (here / "player.html").read_text()
out = (tpl.replace("/*__DATA__*/", json.dumps(data))
          .replace("/*__CAPTURES__*/", json.dumps(captures))
          .replace("/*__TEAL__*/", json.dumps(teal)))
target = here.parent / "AEGIS402-film.html"
target.write_text(out)
t = sum(d["dur"] for d in data)
print(f"gebaut: {target}  ({target.stat().st_size/1e6:.1f} MB)")
print(f"Laufzeit: {int(t//60)}:{int(t%60):02d}  ({len(data)} Segmente)")
