#!/usr/bin/env python3
"""Inline src/ into self-contained pages, so each one opens by double-click and needs no other file."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
SITE_NAME = "Generative AV Labs"
REPO_URL = "https://github.com/patrickiben/generative-av-labs"


def fill(text):
    return text.replace("__SITE_NAME__", SITE_NAME).replace("__REPO_URL__", REPO_URL)


HEAD = """<!doctype html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="{theme}">
<title>{title}</title>
<meta name="description" content="{description}">
<link rel="icon" href="data:image/svg+xml,{icon}">
<style>
{css}
</style>
</head>
"""
ICON = "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23101525'/%3E%3Ccircle cx='16' cy='16' r='7' fill='none' stroke='%23b8b7ff' stroke-width='2'/%3E%3Ccircle cx='16' cy='16' r='2' fill='%23b8b7ff'/%3E%3C/svg%3E"


def script(*names):
    return "\n".join(f"<script>\n{(SRC / n).read_text()}\n</script>" for n in names)


def page(out, title, description, scripts, theme="#101525", extra_css="", base=("kit.js", "shell.js", "gl.js")):
    css = (SRC / "shell.css").read_text() + extra_css
    html = HEAD.format(title=title, description=description, theme=theme, icon=ICON, css=css)
    html += '<body>\n<main class="scene" id="scene" aria-label="' + title + '">\n'
    html += '<canvas id="stage" role="img" aria-label="' + description + '"></canvas>\n</main>\n'
    html += script(*base, *scripts) + "\n</body>\n</html>\n"
    (ROOT / out).write_text(fill(html))
    print(f"{out}: {len(html) // 1024} KB")


def static(out, src, title, description):
    css = (SRC / "shell.css").read_text() + (SRC / "site.css").read_text()
    html = HEAD.format(title=title, description=description, theme="#101525", icon=ICON, css=css)
    html += (SRC / src).read_text()
    (ROOT / out).write_text(fill(html))
    print(f"{out}: {len(html) // 1024} KB")


if __name__ == "__main__":
    if (SRC / "nebula.js").exists():
        page("nebula.html", "Nebula", "A particle nebula made from the last twelve seconds of live drums: time winds outward from the core and frequency sets the color.", ["nebula.js"])
    if (SRC / "biofeedback-nebula.js").exists():
        page("biofeedback-nebula.html", "Biofeedback Nebula", "A 3D particle nebula driven by your heart rate, HRV, paced breathing, Muse S EEG brainwave balance, or live drum kit. Not a medical device.", ["vendor/autonomic/research-math.js", "vendor/autonomic/multivariate-engine.js", "bio.js", "eeg-drive.js", "biofeedback-nebula.js"], extra_css=(SRC / "biofeedback-nebula.css").read_text())
    if (SRC / "enter.js").exists():
        page("enter.html", "Enter", "Walk into a picture and fly through a sound: a first-person depth relief, a synesthetic sound field and a printable sculpture of the sound.", ["enter-workers.js", "enter-chrome.js", "enter.js"], extra_css=(SRC / "enter.css").read_text(), base=("gl.js",))
    if (SRC / "chimera.js").exists():
        page("chimera.html", "Chimera Synth", "A synth you breed by ear: animal voices, a playable genome and a phase-checked sub, synthesized live in your browser.", ["eeg-drive.js", "chimera-ui.js", "chimera-engine.js", "chimera.js"], base=("gl.js",), extra_css=(SRC / "chimera.css").read_text())
    if (SRC / "analog.js").exists():
        page("analog.html", "Detail Forge Analog", "Forge a new layer of fine audio texture while preserving the source: guarded synthesis, an added-detail audition and a loudness-matched comparison, entirely in your browser.", ["analog-dsp.js", "analog-ui.js", "analog.js"], base=(), extra_css=(SRC / "chimera.css").read_text() + (SRC / "analog.css").read_text())
    if (SRC / "displacer.js").exists():
        page("displacer.html", "Displacer", "Blend two sounds by optimal transport: the energy moves along frequency instead of two recordings playing at once.", ["eeg-drive.js", "displacer-engine.js", "displacer.js"], extra_css=(SRC / "displacer.css").read_text())
    if (SRC / "index.src.html").exists():
        static("index.html", "index.src.html", "Generative AV Labs", "Nebula, Enter, Chimera Synth, Detail Forge Analog and Displacer: browser instruments for light and sound, each with its own input.")
    if (SRC / "field-guide.src.html").exists():
        static("field-guide.html", "field-guide.src.html", "Field Guide", "How to connect each page, what each status means, and what each input does.")
