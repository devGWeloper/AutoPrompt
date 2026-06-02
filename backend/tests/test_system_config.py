"""PM_SYSTEM_CONFIG single-row toggle (default off; PUT roundtrips)."""
from __future__ import annotations


def test_system_config_default_off(client):
    r = client.get("/api/v1/system-config")
    assert r.status_code == 200
    assert r.json() == {"enabled_yn": "N"}


def test_system_config_toggle_roundtrip(client):
    r = client.put("/api/v1/system-config", json={"enabled_yn": "Y"})
    assert r.status_code == 200
    assert r.json() == {"enabled_yn": "Y"}

    # GET reflects the new value.
    assert client.get("/api/v1/system-config").json() == {"enabled_yn": "Y"}

    # Flip back.
    r = client.put("/api/v1/system-config", json={"enabled_yn": "N"})
    assert r.json() == {"enabled_yn": "N"}
    assert client.get("/api/v1/system-config").json() == {"enabled_yn": "N"}


def test_system_config_rejects_bad_value(client):
    r = client.put("/api/v1/system-config", json={"enabled_yn": "X"})
    assert r.status_code == 422
