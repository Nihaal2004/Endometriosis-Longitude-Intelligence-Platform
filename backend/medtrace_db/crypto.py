"""Authenticated payload encryption. Keys never enter the SQLite file."""
import base64
import json
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def load_os_key(name: str, *, create: bool = False) -> bytes:
    """Load an installation-specific key from Windows Credential Manager.

    Creating a key is explicit: never silently replace a lost key.
    """
    import keyring
    from keyring.backends.Windows import WinVaultKeyring

    backend = keyring.get_keyring()
    if not isinstance(backend, WinVaultKeyring):
        raise RuntimeError('Windows Credential Manager is required; no plaintext fallback')
    encoded = backend.get_password('MedTrace.SQLite', name)
    if encoded is None:
        if not create:
            raise RuntimeError('Database key is missing')
        encoded = base64.b64encode(AESGCM.generate_key(bit_length=256)).decode('ascii')
        backend.set_password('MedTrace.SQLite', name, encoded)
    key = base64.b64decode(encoded, validate=True)
    if len(key) != 32:
        raise ValueError('Invalid database key')
    return key


class Vault:
    def __init__(self, keys: dict[int, bytes], active_version: int):
        if active_version not in keys or any(len(k) != 32 for k in keys.values()):
            raise ValueError('A 256-bit active key and valid key versions are required')
        self.keys = dict(keys)
        self.active_version = active_version

    def seal(self, value: dict, context: str) -> bytes:
        nonce = secrets.token_bytes(12)
        header = self.active_version.to_bytes(4, 'big')
        plaintext = json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
        ciphertext = AESGCM(self.keys[self.active_version]).encrypt(
            nonce, plaintext, context.encode() + header)
        return header + nonce + ciphertext

    def open(self, envelope: bytes, context: str) -> dict:
        version = int.from_bytes(envelope[:4], 'big')
        plaintext = AESGCM(self.keys[version]).decrypt(
            envelope[4:16], envelope[16:], context.encode() + envelope[:4])
        return json.loads(plaintext)
