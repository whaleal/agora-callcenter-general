"""
WebSocket endpoint: /ws/campaigns/{survey_id}
Frontend subscribes here to receive real-time campaign events.
Auth: ?token=<JWT>
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.security import decode_access_token
from app.services.ws_hub import hub

router = APIRouter(tags=['websocket'])


@router.websocket('/ws/campaigns/{survey_id}')
async def campaign_ws(survey_id: str, websocket: WebSocket, token: str | None = None):
    if not token:
        await websocket.close(code=1008, reason='Not authenticated')
        return
    try:
        decode_access_token(token)
    except Exception:
        await websocket.close(code=1008, reason='Invalid token')
        return

    await websocket.accept()
    hub.connect(survey_id, websocket)
    try:
        while True:
            # Keep connection alive; client may send control messages in future
            data = await websocket.receive_text()
            # Currently no client→server messages defined; discard
            _ = data
    except WebSocketDisconnect:
        hub.disconnect(survey_id, websocket)
