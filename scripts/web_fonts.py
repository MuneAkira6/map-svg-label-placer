#!/usr/bin/env python3
"""Put the fonts Wikimedia Commons renders SVG with into web/public/fonts/, for the page to draw maps with.

The font files come from the same Debian trixie packages as scripts/font_metrics.py (see there):
  fonts-noto-core 20201225-2, fonts-liberation 1:2.1.5-3, fonts-dejavu-core 2.37-8
Unpack them (ar x, then tar xf data.tar.xz) and pass the directory that contains usr/.

Noto and DejaVu are cut down: Noto has no Reserved Font Name, and the DejaVu licence only bars the words
"Bitstream" and "Vera" from the names of modified fonts. Liberation's OFL reserves the name "Liberation", and a cut-down
font is a modified one, so the Liberation files are copied unchanged.

Usage: python3 -I scripts/web_fonts.py <unpacked-root>   (needs fontTools and brotli)
"""
import os
import shutil
import sys

from fontTools import subset

FILES = {
    "noto/NotoSans-Regular.ttf": "NotoSans-Regular",
    "noto/NotoSans-Bold.ttf": "NotoSans-Bold",
    "noto/NotoSans-Italic.ttf": "NotoSans-Italic",
    "noto/NotoSans-BoldItalic.ttf": "NotoSans-BoldItalic",
    "noto/NotoSerif-Regular.ttf": "NotoSerif-Regular",
    "noto/NotoSerif-Bold.ttf": "NotoSerif-Bold",
    "noto/NotoSerif-Italic.ttf": "NotoSerif-Italic",
    "noto/NotoSerif-BoldItalic.ttf": "NotoSerif-BoldItalic",
    "liberation/LiberationSans-Regular.ttf": "LiberationSans-Regular",
    "liberation/LiberationSans-Bold.ttf": "LiberationSans-Bold",
    "liberation/LiberationSans-Italic.ttf": "LiberationSans-Italic",
    "liberation/LiberationSans-BoldItalic.ttf": "LiberationSans-BoldItalic",
    "liberation/LiberationSerif-Regular.ttf": "LiberationSerif-Regular",
    "liberation/LiberationSerif-Bold.ttf": "LiberationSerif-Bold",
    "liberation/LiberationSerif-Italic.ttf": "LiberationSerif-Italic",
    "liberation/LiberationSerif-BoldItalic.ttf": "LiberationSerif-BoldItalic",
    "dejavu/DejaVuSans.ttf": "DejaVuSans",
    "dejavu/DejaVuSans-Bold.ttf": "DejaVuSans-Bold",
    "dejavu/DejaVuSerif.ttf": "DejaVuSerif",
    "dejavu/DejaVuSerif-Bold.ttf": "DejaVuSerif-Bold",
}
# Latin with its extensions and accents, Greek, Cyrillic, punctuation, currency, arrows, maths, circled numbers.
UNICODES = "U+0020-024F,U+0300-036F,U+0370-04FF,U+1E00-1EFF,U+2000-22FF,U+2460-24FF"
LICENCES = {
    "fonts-noto-core": "Noto.txt",
    "fonts-liberation": "Liberation.txt",
    "fonts-dejavu-core": "DejaVu.txt",
}


def main(root):
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "public", "fonts")
    os.makedirs(out, exist_ok=True)
    for rel, name in FILES.items():
        src = os.path.join(root, "usr/share/fonts/truetype", rel)
        if rel.startswith("liberation/"):
            shutil.copyfile(src, os.path.join(out, name + ".ttf"))
            continue
        dst = os.path.join(out, name + ".woff2")
        subset.main([src, f"--unicodes={UNICODES}", "--layout-features=kern,liga,ccmp,locl,mark,mkmk",
                     "--flavor=woff2", f"--output-file={dst}", "--no-hinting", "--desubroutinize"])
        print(f"{name}.woff2 {os.path.getsize(dst) // 1024} kB", file=sys.stderr)
    for pkg, name in LICENCES.items():
        shutil.copyfile(os.path.join(root, "usr/share/doc", pkg, "copyright"), os.path.join(out, name))


if __name__ == "__main__":
    main(sys.argv[1])
