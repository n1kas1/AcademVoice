"""
Генерация LiveKit access-токенов на двух участников комнаты.
Доки: https://docs.livekit.io/home/server/generating-tokens/
"""

from datetime import timedelta
from livekit import api
from .config import LIVEKIT_API_KEY, LIVEKIT_API_SECRET


def make_token(identity: str, room_name: str, name: str) -> str:
    grants = api.VideoGrants(
        room=room_name,
        room_join=True,
        can_publish=True,
        can_subscribe=True,
        can_publish_data=True,
    )
    token = (
        api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .with_identity(identity)
        .with_name(name)
        .with_grants(grants)
        .with_ttl(timedelta(hours=1))
    )
    return token.to_jwt()
