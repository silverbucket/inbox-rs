#!/usr/bin/env python3
"""
Start one or more servers, wait for them to be ready, run a command, then
clean up.

Vendored and adapted from the Anthropic webapp-testing skill (Apache-2.0).
We added structured stderr forwarding on failure so a port-bind error from a
stray Docker container or another dev's `vite dev` is immediately visible.

Usage:
    # Single server
    python scripts/with_servers.py --server "npm run preview" --port 4173 -- pytest

    # Multiple servers (ours: armadietto + vite preview)
    python scripts/with_servers.py \
      --server "docker compose up" --port 8000 \
      --server "npm run preview -w packages/web" --port 4173 \
      -- pytest tests/e2e
"""

from __future__ import annotations

import argparse
import shlex
import socket
import subprocess
import sys
import time


def _wait_for_port(port: int, timeout: float) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("localhost", port), timeout=1):
                return True
        except (socket.error, ConnectionRefusedError):
            time.sleep(0.5)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a command with one or more servers")
    parser.add_argument("--server", action="append", dest="servers", required=True,
                        help="Server command (repeatable)")
    parser.add_argument("--port", action="append", dest="ports", type=int, required=True,
                        help="Port for each --server, in order")
    parser.add_argument("--timeout", type=int, default=60,
                        help="Seconds to wait per server (default: 60)")
    parser.add_argument("command", nargs=argparse.REMAINDER,
                        help="Command to run after all servers are ready")
    args = parser.parse_args()

    if args.command and args.command[0] == "--":
        args.command = args.command[1:]
    if not args.command:
        parser.error("no command specified after --")
    if len(args.servers) != len(args.ports):
        parser.error("--server and --port counts must match")

    procs: list[tuple[str, subprocess.Popen[bytes]]] = []
    try:
        for cmd, port in zip(args.servers, args.ports):
            print(f"[with_servers] starting on :{port} → {cmd}", flush=True)
            # shell=True so commands like `cd foo && npm start` work, matching
            # the upstream skill helper's contract.
            proc = subprocess.Popen(
                cmd, shell=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
            procs.append((cmd, proc))
            if not _wait_for_port(port, args.timeout):
                # Surface stderr so the caller can see *why* the port never
                # opened (port collision, container build failure, missing
                # dependency, etc.) instead of staring at a bare timeout.
                _, err = proc.communicate(timeout=2)
                sys.stderr.write(err.decode("utf-8", "replace"))
                raise SystemExit(f"[with_servers] server on :{port} failed to bind in {args.timeout}s")
            print(f"[with_servers] ready on :{port}", flush=True)

        print(f"[with_servers] running: {' '.join(shlex.quote(c) for c in args.command)}", flush=True)
        result = subprocess.run(args.command)
        return result.returncode
    finally:
        for cmd, proc in procs:
            print(f"[with_servers] stopping: {cmd}", flush=True)
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()


if __name__ == "__main__":
    sys.exit(main())
