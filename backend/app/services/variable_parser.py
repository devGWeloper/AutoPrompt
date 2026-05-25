from __future__ import annotations

import re

# {{var}} placeholder pattern. The variable *catalog* table was removed; this
# pattern is still used by ``llm.base.render_template`` to substitute values
# (from dataset case JSON / request payload) at test time.
_VAR_PATTERN = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")
