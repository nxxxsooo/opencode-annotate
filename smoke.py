"""Headless real OpenCode + plannotator-tui round trip; no model call or visible window."""
import json
import os
from pathlib import Path
import shlex
import socket as unix_socket
import struct
import subprocess
import tempfile
import time


PLUGIN = Path(__file__).resolve().parent
ENTRYPOINT = Path(os.environ.get("ANNOTATE_TUI_ENTRY", str(PLUGIN / "tui.ts"))).resolve().as_uri()
BINARY_OPTIONS = {"binary": os.environ["ANNOTATE_TUI_BINARY"]} if os.environ.get("ANNOTATE_TUI_BINARY") else {}
EXPECTED_MARGIN = int(os.environ.get("ANNOTATE_EXPECT_MARGIN", "0"))
TMP = Path(os.environ.get("TMPDIR", tempfile.gettempdir())) / "opencode"
TMP.mkdir(exist_ok=True)
root = Path(tempfile.mkdtemp(prefix="annotate-last-smoke-", dir=TMP)).resolve()
socket = f"annotate-last-smoke-{os.getpid()}"
session = None


def api(method, route, data=None):
    args = ["opencode", "api", method, route]
    if data is not None:
        args += ["--data", json.dumps(data)]
    result = subprocess.run(args, capture_output=True, text=True, check=True, timeout=30)
    return json.loads(result.stdout) if result.stdout.strip() else None


def tmux(*args, check=True):
    return subprocess.run(["tmux", "-L", socket, "-f", "/dev/null", *args],
                          capture_output=True, text=True, check=check, timeout=15).stdout


def screen():
    return tmux("capture-pane", "-p", "-t", "check:0.0")


def wait(text, label, seconds=30):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        output = screen()
        if text in output:
            (root / f"{label}.txt").write_text(output)
            return output
        time.sleep(0.1)
    (root / f"{label}-failed.txt").write_text(output)
    raise AssertionError(f"Did not see {text!r}; capture: {root / (label + '-failed.txt')}")


def literal(text):
    tmux("send-keys", "-t", "check:0.0", "-l", text)


def keys(*items):
    tmux("send-keys", "-t", "check:0.0", *items)


def open_review(label, command="/annotate-last", filename="last-reply.md"):
    # The trailing space leaves slash completion and submits the optional argument slot.
    literal(command + " ")
    keys("Enter")
    output = wait(filename + " · 0 annotations", label)
    if EXPECTED_MARGIN:
        for row in output.splitlines():
            cells = row.ljust(140)
            assert not cells[:EXPECTED_MARGIN].strip(), f"Left margin: {row!r}"
            assert not cells[-EXPECTED_MARGIN:].strip(), f"Right margin: {row!r}"


def annotate(note, label):
    keys("c")
    wait("comment", f"{label}-compose")
    literal(note)
    keys("Enter")
    wait(note, label)


try:
    # Keep selection deterministic; exercise the real plugin, renderer, binary, confirmation,
    # client SDK and API. resume:false is the only submission change, to avoid an LLM run.
    fixture = root / "fixture"
    fixture.mkdir()
    (fixture / "package.json").write_text(json.dumps({
        "name": "annotate-last-smoke", "type": "module", "exports": {"./tui": "./tui.ts"},
    }))
    (fixture / "tui.ts").write_text(f'''import plugin from {json.dumps(ENTRYPOINT)}
export default {{
  ...plugin,
  id: "test.annotate-last",
  setup(ctx) {{
    return plugin.setup({{
      ...ctx,
      client: {{ ...ctx.client,
        message: {{ async list() {{ return {{ data: [{{
          id: "msg_smoke_fixture", type: "assistant", agent: "build",
          model: {{ providerID: "fixture", id: "fixture" }},
          time: {{ created: 1, completed: 2 }}, finish: "stop",
          content: [{{ type: "text", text: "# Terminal review fixture\\n\\nAlpha paragraph.\\n" }}],
        }}, {{
          id: "msg_smoke_older", type: "assistant", agent: "build",
          model: {{ providerID: "fixture", id: "fixture" }},
          time: {{ created: 0, completed: 1 }}, finish: "stop",
          content: [{{ type: "text", text: "# Previous reply fixture\\n\\nAlpha paragraph.\\n" }}],
        }}], cursor: {{}} }} }} }},
        session: {{ ...ctx.client.session,
        prompt: (input) => ctx.client.session.prompt({{ ...input, resume: false }}),
      }} }},
    }})
  }},
}}
''')
    session = api("post", "/api/session", {
        "title": "Annotate-last isolated smoke test", "location": {"directory": str(root)},
    })["data"]["id"]
    inline = json.dumps({
        "plugins": [{"package": str(fixture), "options": BINARY_OPTIONS}], "animations": False,
        "theme": {"name": "dracula", "mode": "dark"},
        "debug": {"devtools": False}, "tabs": {"mode": "off"},
    })
    command = shlex.join(["env", f"OPENCODE_CLI_CONFIG_CONTENT={inline}",
                          "opencode", "--session", session, str(root)])
    tmux("new-session", "-d", "-s", "check", "-x", "140", "-y", "42", "-c", str(root), command)
    wait("Annotate-last isolated smoke test", "host-ready", 60)

    open_review("review-open")
    annotate("SMOKE exact-session feedback", "note-created")
    keys("q")
    wait("Send annotations?", "confirmation")
    keys("Enter")
    wait("Sent 1 annotation", "sent")
    inbox = api("get", f"/api/session/{session}/inbox")
    (root / "inbox.json").write_text(json.dumps(inbox, ensure_ascii=False, indent=2))
    encoded = json.dumps(inbox, ensure_ascii=False)
    assert "SMOKE exact-session feedback" in encoded, encoded
    assert "msg_smoke_fixture" in encoded, encoded

    open_review("empty-open", "/annotate")
    keys("q")
    wait("No annotations", "empty-return")
    after_empty = api("get", f"/api/session/{session}/inbox")
    assert after_empty == inbox, "Empty review changed the inbox"

    open_review("cancel-open")
    annotate("SMOKE must not be sent", "cancel-note")
    keys("q")
    wait("Send annotations?", "cancel-confirmation")
    keys("Escape")
    wait("Sending cancelled", "cancel-return")
    after_cancel = api("get", f"/api/session/{session}/inbox")
    assert after_cancel == inbox, "Cancelled review changed the inbox"

    document = root / "文档 sample.md"
    content = "# Document review fixture\n\nAlpha paragraph.\n"
    document.write_text(content)
    open_review("document-open", '/annotate "文档 sample.md"', document.name)
    annotate("SMOKE document feedback", "document-note")
    keys("q")
    wait("Document:", "document-confirmation")
    keys("Enter")
    wait("Sent 1 annotation", "document-sent")
    document_inbox = api("get", f"/api/session/{session}/inbox")
    encoded = json.dumps(document_inbox, ensure_ascii=False)
    assert "SMOKE document feedback" in encoded, encoded
    assert str(document) in encoded, encoded
    assert document.read_text() == content, "Review modified the original document"

    open_review("last-fixed", '/annotate-last 2')
    wait("Terminal review fixture", "last-fixed-content")
    keys("q")
    wait("No annotations", "last-fixed-return")
    assert api("get", f"/api/session/{session}/inbox") == document_inbox

    open_review("previous-open", "/annotate 2")
    wait("Previous reply fixture", "previous-content")
    annotate("SMOKE previous reply feedback", "previous-note")
    keys("q")
    wait("Send annotations?", "previous-confirmation")
    keys("Enter")
    wait("Sent 1 annotation", "previous-sent")
    previous_inbox = json.dumps(api("get", f"/api/session/{session}/inbox"))
    assert "msg_smoke_older" in previous_inbox
    assert "SMOKE previous reply feedback" in previous_inbox

    # Browser review opens a local receiver without a model call or visible browser.
    literal("/annotate web ")
    keys("Enter")
    wait("Ready for browser pairing", "web-pairing")
    registry = Path.home() / ".local/share/opencode-annotate/targets"
    target = next(json.loads(p.read_text()) for p in registry.glob("*.json")
                  if json.loads(p.read_text()).get("sessionID") == session)
    batch = {"action": "send", "targetID": target["id"], "batchID": "12345678-1234-1234-1234-123456789012",
             "review": {"version": 1, "page": {"url": "https://example.test/review", "title": "Smoke page"},
                        "annotations": [{"id": "smoke-note", "revision": 1, "kind": "comment",
                                         "comment": "SMOKE browser exact-session feedback", "createdAt": "2026-10-19T00:00:00Z",
                                         "anchor": {"type": "text", "quote": "Alpha", "selector": "#alpha"}}]}}
    def send_batch():
        with unix_socket.socket(unix_socket.AF_UNIX, unix_socket.SOCK_STREAM) as connection:
            connection.settimeout(20)
            connection.connect(target["socket"])
            body = json.dumps(batch).encode()
            connection.sendall(struct.pack("<I", len(body)) + body)
            header = connection.recv(4)
            size = struct.unpack("<I", header)[0]
            data = b""
            while len(data) < size:
                data += connection.recv(size - len(data))
            return json.loads(data)
    receipt = send_batch()
    assert receipt["state"] == "admitted", receipt
    assert send_batch() == receipt
    web_inbox = json.dumps(api("get", f"/api/session/{session}/inbox"))
    assert "SMOKE browser exact-session feedback" in web_inbox
    assert receipt["messageID"] in web_inbox

    print(json.dumps({"passed": ["real TUI launch", "create annotation", "terminal restore",
                                  "confirmed API delivery", "empty review", "cancelled review",
                                  "document path arguments", "document API delivery", "last fixed to latest",
                                   "numbered reply API delivery", "browser pairing", "browser API delivery", "retry deduplication"],
                      "evidence": str(root)}, ensure_ascii=False))
finally:
    tmux("kill-server", check=False)
    if session:
        api("delete", f"/api/session/{session}")
