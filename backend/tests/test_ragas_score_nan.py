"""Regression: non-finite metric scores must become NULL, never reach Oracle.

ragas returns NaN when a metric can't be computed; Oracle NUMBER rejects NaN/inf
(DPY-4004). _to_score() is the persistence-boundary guard.
"""
from __future__ import annotations

from decimal import Decimal

from app.services.ragas_service import _to_score


def test_nan_becomes_none():
    assert _to_score(float("nan")) is None


def test_inf_becomes_none():
    assert _to_score(float("inf")) is None
    assert _to_score(float("-inf")) is None


def test_none_stays_none():
    assert _to_score(None) is None


def test_finite_value_rounds_to_decimal():
    assert _to_score(0.123456) == Decimal("0.1235")
    assert _to_score(1) == Decimal("1")


def test_non_numeric_becomes_none():
    assert _to_score("not-a-number") is None  # type: ignore[arg-type]
