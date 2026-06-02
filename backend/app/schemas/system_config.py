from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class SystemConfigOut(BaseModel):
    enabled_yn: Literal["Y", "N"]


class SystemConfigUpdate(BaseModel):
    enabled_yn: Literal["Y", "N"]
