"""
Валидация Telegram WebApp initData по схеме из официальной доки:
https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

Алгоритм:
1) Разбираем initData как querystring.
2) Извлекаем поле `hash`, остальное сортируем по ключу и склеиваем как
   "key=value\nkey=value...".
3) secret_key = HMAC_SHA256("WebAppData", bot_token).
4) computed = HMAC_SHA256(secret_key, data_check_string).hex().
5) Сравниваем computed == hash.
6) Дополнительно — проверяем что auth_date не слишком старый (24 часа).
"""

import hmac
import hashlib
import json
import time
from urllib.parse import parse_qsl
from typing import Optional

from .config import TELEGRAM_BOT_TOKEN

MAX_AGE_SECONDS = 24 * 60 * 60


class TgUser:
    def __init__(self, data: dict):
        self.id: int = int(data["id"])
        self.username: Optional[str] = data.get("username")
        self.first_name: str = data.get("first_name", "Пользователь")
        self.is_premium: bool = bool(data.get("is_premium", False))


def parse_init_data(init_data: str) -> TgUser:
    if not init_data:
        raise ValueError("empty initData")

    pairs = dict(parse_qsl(init_data, strict_parsing=False))
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise ValueError("hash missing")

    # data_check_string
    check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))

    secret = hmac.new(
        b"WebAppData", TELEGRAM_BOT_TOKEN.encode(), hashlib.sha256
    ).digest()
    computed = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(computed, received_hash):
        raise ValueError("bad signature")

    auth_date = int(pairs.get("auth_date", "0"))
    if auth_date and time.time() - auth_date > MAX_AGE_SECONDS:
        raise ValueError("initData expired")

    user_raw = pairs.get("user")
    if not user_raw:
        raise ValueError("user missing")
    return TgUser(json.loads(user_raw))


def extract_user_from_header(authorization: str) -> TgUser:
    """Authorization: tma <initData>"""
    if not authorization or not authorization.lower().startswith("tma "):
        raise ValueError("bad auth header")
    init_data = authorization.split(" ", 1)[1]
    return parse_init_data(init_data)
