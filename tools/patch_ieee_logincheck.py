#!/usr/bin/env python3
"""Install IEEE direct REST full-text rules from the canonical source patch."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# The canonical JSON records the exact versioned rule.  This command is kept
# only as a documented migration entrypoint; do not reintroduce WebView here.
subprocess.run(["python3", str(ROOT / "tools" / "migrate_translation_sources.py")], check=True)
