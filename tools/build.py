"""Build the single-file site: inline CSS, JS and the logo from src/index.src.html into index.html.

Run from the repository root:  python tools/build.py
The result works from GitHub Pages and when opened by double-click (file://), with no network access.
"""
import base64
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "index.src.html"
OUT = ROOT / "index.html"


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def main() -> int:
    html = SRC.read_text(encoding="utf-8")
    logo = "data:image/svg+xml;base64," + base64.b64encode((ROOT / "tools" / "logo.svg").read_bytes()).decode()
    html = html.replace("{{LOGO}}", logo)

    def css(m: re.Match) -> str:
        return "<style>\n" + read(m.group(1).replace("../", "")) + "</style>"

    def js(m: re.Match) -> str:
        code = read(m.group(1).replace("../", "")).replace("</script", "<\\/script")
        return "<script>\n" + code + "</script>"

    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css, html)
    html = re.sub(r'<script src="([^"]+)"></script>', js, html)

    # nothing local or remote may remain
    left = [m.group(0) for m in re.finditer(r'(?:src|href)="(?!data:|#)[^"]*"', html)]
    if left or 'type="module"' in html or re.search(r"^\s*import\s", html, re.M):
        print("build failed, external references left:", left, file=sys.stderr)
        return 1
    OUT.write_text(html, encoding="utf-8", newline="\n")
    print(f"wrote {OUT.name}: {len(html) / 1024:.0f} kB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
