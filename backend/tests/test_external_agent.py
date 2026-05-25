"""External-agent gating logic (no network).

Only verifies the config gate (external_enabled / _base_url). The HTTP wire
contract is exercised by the connect-prompt-mgmt skill's callback_probe.py.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

import app.services.external_agent as ea


def _settings(*, run_mode="internal", base_url=""):
    return SimpleNamespace(run_mode=run_mode, external_agent_base_url=base_url)


def test_external_disabled_by_default(monkeypatch):
    monkeypatch.setattr(ea, "get_settings", lambda: _settings())
    assert ea.external_enabled() is False


def test_external_enabled_when_mode_and_url_set(monkeypatch):
    monkeypatch.setattr(ea, "get_settings", lambda: _settings(run_mode="external", base_url="http://svc:9000"))
    assert ea.external_enabled() is True


def test_external_mode_without_url_stays_disabled(monkeypatch):
    monkeypatch.setattr(ea, "get_settings", lambda: _settings(run_mode="external", base_url=""))
    assert ea.external_enabled() is False


def test_base_url_raises_when_unset(monkeypatch):
    monkeypatch.setattr(ea, "get_settings", lambda: _settings(base_url=""))
    with pytest.raises(ea.ExternalAgentError):
        ea._base_url()


def test_base_url_strips_trailing_slash(monkeypatch):
    monkeypatch.setattr(ea, "get_settings", lambda: _settings(base_url="http://svc:9000/"))
    assert ea._base_url() == "http://svc:9000"
