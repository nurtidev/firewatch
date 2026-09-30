"""Озвучка одной реплики через edge-tts: python3 tts.py <голос> <текст> <out.mp3> [темп, напр. +12%].

За корпоративным прокси с собственным CA задать EXTRA_CA_BUNDLE=/путь/к/ca.crt —
aiohttp внутри edge-tts не читает системные переменные SSL_CERT_FILE.
"""
import asyncio
import os
import ssl
import sys

EXTRA_CA = os.environ.get("EXTRA_CA_BUNDLE")
if EXTRA_CA:
    _orig = ssl.create_default_context

    def _ctx(*a, **k):
        c = _orig(*a, **k)
        c.load_verify_locations(EXTRA_CA)
        return c

    ssl.create_default_context = _ctx

import edge_tts  # noqa: E402  (после подмены SSL-контекста)


async def main(voice: str, text: str, out: str, rate: str = "+0%") -> None:
    await edge_tts.Communicate(text, voice, rate=rate).save(out)


asyncio.run(main(*sys.argv[1:]))
