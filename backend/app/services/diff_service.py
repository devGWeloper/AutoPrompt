from __future__ import annotations

import difflib

from app.schemas.prompt import PromptDiffLine, PromptDiffSection


def diff_text(a: str | None, b: str | None) -> PromptDiffSection:
    a_lines = (a or "").splitlines()
    b_lines = (b or "").splitlines()

    unified = "\n".join(
        difflib.unified_diff(a_lines, b_lines, fromfile="v1", tofile="v2", lineterm="")
    )

    lines: list[PromptDiffLine] = []
    added = 0
    removed = 0
    matcher = difflib.SequenceMatcher(a=a_lines, b=b_lines)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                lines.append(PromptDiffLine(tag="equal", a_line=a_lines[i1 + k], b_line=b_lines[j1 + k]))
        elif tag == "insert":
            for k in range(j2 - j1):
                lines.append(PromptDiffLine(tag="insert", b_line=b_lines[j1 + k]))
                added += 1
        elif tag == "delete":
            for k in range(i2 - i1):
                lines.append(PromptDiffLine(tag="delete", a_line=a_lines[i1 + k]))
                removed += 1
        elif tag == "replace":
            for k in range(i2 - i1):
                lines.append(PromptDiffLine(tag="delete", a_line=a_lines[i1 + k]))
                removed += 1
            for k in range(j2 - j1):
                lines.append(PromptDiffLine(tag="insert", b_line=b_lines[j1 + k]))
                added += 1

    return PromptDiffSection(added=added, removed=removed, unified=unified, lines=lines)
