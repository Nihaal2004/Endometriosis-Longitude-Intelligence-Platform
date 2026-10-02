"""Local persistence; authentication is supplied by the calling backend."""

from .database import Database, ConsentRequired, Conflict
from .crypto import Vault, load_os_key

__all__ = ['Database', 'ConsentRequired', 'Conflict', 'Vault', 'load_os_key']
