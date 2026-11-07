#!/usr/bin/env python3
"""Task-scoped WS transport. JSON stdin/stdout only; no credential or file access."""
import json
import struct
import sys
import threading
import time
from urllib.parse import urlparse

import websocket


def debug(request):
    target = urlparse(request['url'])
    assert target.scheme == 'ws' and target.port == 1123
    assert target.path == '/bookSourceDebug' and not target.username and not target.password
    assert request['protocols'][0] == 'legado'
    started = time.monotonic()
    timeout = request['timeoutMs'] / 1000
    result = dict(transport='websocket', implementation='python-websocket-client',
                  opened=False, timedOut=False, connectionError=False, closeCode=1006,
                  closeReason='', messages=[], messageTimingsMs=[], pingCount=0)
    connection = websocket.WebSocket(enable_multithread=True)
    stop_heartbeat = threading.Event()
    result['clientHeartbeats'] = 0

    def keepalive():
        while not stop_heartbeat.wait(10):
            try:
                connection.ping('usehtml-validation')
                result['clientHeartbeats'] += 1
            except Exception:
                return
    try:
        connection.connect(request['url'], subprotocols=request['protocols'],
                           timeout=min(timeout, 10), http_proxy_host=None)
        result['opened'] = True
        connection.send(json.dumps(request['message'], ensure_ascii=False))
        threading.Thread(target=keepalive, daemon=True).start()
        while True:
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                raise websocket.WebSocketTimeoutException('isolated validation timeout')
            connection.settimeout(remaining)
            opcode, frame = connection.recv_data_frame(control_frame=True)
            if opcode == websocket.ABNF.OPCODE_TEXT:
                data = frame.data.decode('utf-8') if isinstance(frame.data, bytes) else frame.data
                if data != 'ping':
                    result['messages'].append(data)
                    result['messageTimingsMs'].append(round((time.monotonic() - started) * 1000))
            elif opcode == websocket.ABNF.OPCODE_PING:
                # recv_data_frame has already answered with a pong.
                result['pingCount'] += 1
            elif opcode == websocket.ABNF.OPCODE_CLOSE:
                payload = frame.data
                result['closeCode'] = struct.unpack('!H', payload[:2])[0] if len(payload) >= 2 else 1005
                result['closeReason'] = payload[2:].decode('utf-8', 'replace')
                break
    except websocket.WebSocketTimeoutException:
        result['timedOut'] = True
        result['closeReason'] = 'client timeout'
    except Exception as error:
        result['connectionError'] = True
        result['connectionFailure'] = dict(name=type(error).__name__, message=str(error))
    finally:
        stop_heartbeat.set()
        # A validation timeout must not wait for another server close handshake.
        connection.shutdown()
        result['elapsedMs'] = round((time.monotonic() - started) * 1000)
    return result


if __name__ == '__main__':
    print(json.dumps(debug(json.load(sys.stdin)), ensure_ascii=False))
