from __future__ import annotations

import re

_VAR_PATTERN = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")


def extract_variables(*texts: str | None) -> list[str]:
    """Return unique variable names found across all given texts, in first-seen order."""
    seen: dict[str, None] = {}
    for text in texts:
        if not text:
            continue
        for name in _VAR_PATTERN.findall(text):
            seen.setdefault(name, None)
    return list(seen.keys())
