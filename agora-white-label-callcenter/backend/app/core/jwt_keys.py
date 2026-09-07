"""JWT HMAC signing key.

Equivalent to Java jjwt:
    SecretKey key = Keys.secretKeyFor(SignatureAlgorithm.HS256);

The 256-bit key is generated with the OS CSPRNG on first boot and persisted
to a local file (not .env) so tokens remain valid across restarts.
"""
from __future__ import annotations

import logging
import secrets
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

# HS256 minimum key length is 256 bits — same as Keys.secretKeyFor(HS256)
_HS256_KEY_BYTES = 32
_KEY_FILE = Path(__file__).resolve().parents[2] / 'data' / 'jwt_hmac.key'


def generate_hs256_key() -> bytes:
    return secrets.token_bytes(_HS256_KEY_BYTES)


def _persist_key(path: Path, key: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(key)
    try:
        path.chmod(0o600)
    except OSError:
        logger.warning('could not chmod 600 on JWT key file %s', path)


def _load_or_create_key(path: Path) -> bytes:
    if path.is_file():
        data = path.read_bytes().strip()
        if len(data) >= _HS256_KEY_BYTES:
            return data
        logger.warning('JWT key file is too short (%s bytes), regenerating', len(data))

    key = generate_hs256_key()
    _persist_key(path, key)
    logger.info('generated JWT HS256 signing key at %s', path)
    return key


@lru_cache(maxsize=1)
def get_jwt_secret() -> bytes:
    return _load_or_create_key(_KEY_FILE)
