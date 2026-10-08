"""An installation key protected by Windows DPAPI; never a public demo key."""
import ctypes
from ctypes import wintypes
import os
from pathlib import Path


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def protect(value, decrypt=False):
    if os.name != 'nt':
        raise RuntimeError('Configure MEDTRACE_LOCAL_KEY on this OS, or use Windows DPAPI')
    buffer = ctypes.create_string_buffer(value)
    incoming = Blob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = Blob()
    crypt32 = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    if decrypt:
        function = crypt32.CryptUnprotectData
        function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    else:
        function = crypt32.CryptProtectData
        function.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    description = None if decrypt else 'MedTrace local installation'
    if not function(ctypes.byref(incoming), description, None, None, None, 1, ctypes.byref(outgoing)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(outgoing.data, outgoing.size)
    finally:
        kernel32.LocalFree(outgoing.data)


def installation_key(directory: Path):
    import base64
    encoded = os.environ.get('MEDTRACE_LOCAL_KEY')
    if encoded:
        key = base64.b64decode(encoded, validate=True)
        if len(key) != 32:
            raise ValueError('MEDTRACE_LOCAL_KEY must be a base64-encoded 32-byte secret')
        return key
    path = directory / 'installation.key'
    if path.exists():
        key = protect(path.read_bytes(), decrypt=True)
        if len(key) != 32:
            raise RuntimeError('The installation key is invalid. Restore your original key file.')
        return key
    if (directory / 'medtrace.sqlite3').exists():
        raise RuntimeError('Installation key is missing. Restore it; do not replace an existing database key.')
    key = os.urandom(32)
    envelope = protect(key)
    with path.open('xb') as destination:
        destination.write(envelope)
    return key
