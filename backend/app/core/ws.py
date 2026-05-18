from __future__ import annotations

from fastapi import WebSocket

# Channel key: int run_id for test/flow runs, or a str like "ragas:{id}" so
# RAGAS runs (separate id sequence) never collide with TestRun ids.
RunKey = int | str


class ConnectionManager:
    """In-memory pub/sub for run progress streaming.

    Messages are buffered per channel so a client that connects *after* the
    background task finished still receives the full history (runs complete
    quickly and the client connects right after the POST).
    """

    def __init__(self) -> None:
        self._connections: dict[RunKey, set[WebSocket]] = {}
        self._history: dict[RunKey, list[dict]] = {}

    async def connect(self, run_id: RunKey, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.setdefault(run_id, set()).add(ws)
        for message in self._history.get(run_id, []):
            await ws.send_json(message)

    def disconnect(self, run_id: RunKey, ws: WebSocket) -> None:
        conns = self._connections.get(run_id)
        if conns:
            conns.discard(ws)
            if not conns:
                self._connections.pop(run_id, None)

    async def broadcast(self, run_id: RunKey, message: dict) -> None:
        self._history.setdefault(run_id, []).append(message)
        for ws in list(self._connections.get(run_id, set())):
            try:
                await ws.send_json(message)
            except Exception:  # noqa: BLE001 - drop broken sockets
                self.disconnect(run_id, ws)

    def clear(self, run_id: RunKey) -> None:
        self._history.pop(run_id, None)
        self._connections.pop(run_id, None)


manager = ConnectionManager()
