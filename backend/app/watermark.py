"""Invisible watermark for generated images.

Uses the C core (c/watermark.c, compiled to app/libwatermark.so)
when it is available. A pure-Python implementation of the exact
same frame format is kept as a fallback so the service behaves
identically on hosts where the shared library was not built.
"""
from __future__ import annotations

import ctypes
import os

_MAGIC = b"XYRO"
_HEADER_BYTES = 6

_lib: ctypes.CDLL | None = None
_lib_path = os.path.join(os.path.dirname(__file__), "libwatermark.so")
if os.path.exists(_lib_path):
    try:
        _lib = ctypes.CDLL(_lib_path)
        _lib.wm_embed.argtypes = [
            ctypes.POINTER(ctypes.c_ubyte), ctypes.c_size_t,
            ctypes.POINTER(ctypes.c_ubyte), ctypes.c_size_t,
        ]
        _lib.wm_embed.restype = ctypes.c_int
        _lib.wm_extract.argtypes = [
            ctypes.POINTER(ctypes.c_ubyte), ctypes.c_size_t,
            ctypes.POINTER(ctypes.c_ubyte), ctypes.c_size_t,
            ctypes.POINTER(ctypes.c_size_t),
        ]
        _lib.wm_extract.restype = ctypes.c_int
    except OSError:
        _lib = None


def using_c_core() -> bool:
    return _lib is not None


def _embed_python(buf: bytearray, payload: bytes) -> None:
    frame = _MAGIC + len(payload).to_bytes(2, "big") + payload
    needed = len(frame) * 8
    if len(buf) < needed:
        raise ValueError("buffer too small for watermark payload")
    pos = 0
    for byte in frame:
        for bit in range(7, -1, -1):
            buf[pos] = (buf[pos] & 0xFE) | ((byte >> bit) & 1)
            pos += 1


def _extract_python(buf: bytes) -> bytes:
    if len(buf) < _HEADER_BYTES * 8:
        raise ValueError("no watermark present")

    def read_byte(offset: int) -> int:
        value = 0
        for i in range(8):
            value = (value << 1) | (buf[offset + i] & 1)
        return value

    header = bytes(read_byte(i * 8) for i in range(_HEADER_BYTES))
    if header[:4] != _MAGIC:
        raise ValueError("no watermark present")
    length = int.from_bytes(header[4:6], "big")
    if len(buf) < (_HEADER_BYTES + length) * 8:
        raise ValueError("corrupt watermark")
    return bytes(
        read_byte((_HEADER_BYTES + i) * 8) for i in range(length)
    )


def extract_provenance(rgba: bytes, width: int, height: int) -> str | None:
    """Extract a TruthAI provenance payload written by the MAIN
    app's watermark (lib/server/watermark.ts). That frame format
    differs from this module's legacy frame: magic "XYRO" +
    version byte (1) + uint16BE length + payload + CRC-32(IEEE)
    of the payload, one bit per RGB channel (alpha skipped,
    MSB first), TILED at every 256x256 pixel origin. Scans the
    tile origins in the same order and returns the payload
    (e.g. "truthai:<generationId>:<uidHash>"), or None when no
    intact copy verifies. Pure function of the RGBA bytes so it
    is unit-testable without an image decoder."""
    import binascii

    tile = 256
    header_bytes = 7  # magic(4) + version(1) + length(2)
    crc_bytes = 4
    max_payload = 512
    capacity_bits = width * height * 3

    def read_bytes(start_bit: int, count: int) -> bytes | None:
        if start_bit + count * 8 > capacity_bits:
            return None
        out = bytearray(count)
        for i in range(count * 8):
            absolute = start_bit + i
            pixel = absolute // 3
            channel = absolute % 3
            bit = rgba[pixel * 4 + channel] & 1
            out[i >> 3] = (out[i >> 3] << 1) | bit
        return bytes(out)

    starts: list[int] = []
    ty = 0
    while ty < height:
        tx = 0
        while tx < width:
            starts.append((ty * width + tx) * 3)
            tx += tile
        ty += tile

    for start in starts:
        header = read_bytes(start, header_bytes)
        if header is None or header[:4] != b"XYRO" or header[4] != 1:
            continue
        length = int.from_bytes(header[5:7], "big")
        if length == 0 or length > max_payload:
            continue
        rest = read_bytes(start + header_bytes * 8, length + crc_bytes)
        if rest is None:
            continue
        payload = rest[:length]
        stored_crc = int.from_bytes(rest[length:], "big")
        if (binascii.crc32(payload) & 0xFFFFFFFF) != stored_crc:
            continue
        try:
            return payload.decode("utf-8")
        except UnicodeDecodeError:
            continue
    return None


def embed(pixel_bytes: bytes | bytearray, payload: bytes) -> bytearray:
    """Return a copy of pixel_bytes with payload embedded in LSBs."""
    buf = bytearray(pixel_bytes)
    if _lib is not None:
        data = (ctypes.c_ubyte * len(buf)).from_buffer(buf)
        src = (ctypes.c_ubyte * len(payload)).from_buffer_copy(payload)
        rc = _lib.wm_embed(data, len(buf), src, len(payload))
        if rc != 0:
            raise ValueError("buffer too small for watermark payload")
        return buf
    _embed_python(buf, payload)
    return buf


def extract(pixel_bytes: bytes | bytearray) -> bytes:
    """Return the embedded payload, or raise ValueError if absent."""
    if _lib is not None:
        buf = bytes(pixel_bytes)
        data = (ctypes.c_ubyte * len(buf)).from_buffer_copy(buf)
        out = (ctypes.c_ubyte * 65536)()
        out_len = ctypes.c_size_t(0)
        rc = _lib.wm_extract(data, len(buf), out, 65536, ctypes.byref(out_len))
        if rc != 0:
            raise ValueError("no watermark present")
        return bytes(out[: out_len.value])
    return _extract_python(bytes(pixel_bytes))
