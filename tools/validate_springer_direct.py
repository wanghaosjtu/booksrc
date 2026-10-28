#!/usr/bin/env python3
"""Structural contract for the browserless Springer article downloader."""

import json
from pathlib import Path


root = Path(__file__).resolve().parents[1]
sources = json.loads((root / "booksource" / "legado-book-sources-current.json").read_text(encoding="utf-8"))
springer = next(source for source in sources if source.get("bookSourceName") == "Springer")

content = springer["ruleContent"]["content"]
assert "webView" not in springer["ruleToc"]["chapterUrl"]
assert "webView" not in content
assert "webView" not in springer["ruleContent"].get("payAction", "")
assert "startBrowserAwait" not in springer["loginCheckJs"]
assert "Springer 需要手动认证" in springer["loginCheckJs"]
assert "TH(String(springerMain.html())" in content
assert "image_base_url:'https://link.springer.com'" in content

print("Springer direct-download contract passed")
