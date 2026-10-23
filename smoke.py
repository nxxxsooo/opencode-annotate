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
INHERIT_THEME = os.environ.get("ANNOTATE_INHERIT_THEME") == "1"
THEME_MODE = os.environ.get("ANNOTATE_THEME_MODE", "dark")
if INHERIT_THEME:
    BINARY_OPTIONS["inheritTheme"] = True
SEND_KEY = os.environ.get("ANNOTATE_SEND_KEY") == "1"
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


def check_colors(label, roles):
    ansi = tmux("capture-pane", "-p", "-e", "-t", "check:0.0")
    (root / f"{label}.ansi").write_text(ansi)
    colors = json.loads((root / "host-colors.json").read_text())
    for role, prefix in roles:
        expected = prefix + ";2;" + ";".join(str(value) for value in colors[role])
        assert expected in ansi, f"Missing host {role} {expected}: {root / (label + '.ansi')}"


def submit(command, label):
    # The trailing space leaves slash completion and submits the optional argument slot.
    # After a review returns, the prompt can drop keys until it is focused again.
    for _ in range(3):
        literal(command + " ")
        try:
            wait("┃  " + command, f"{label}-typed", 3)
            break
        except AssertionError:
            keys("C-u")
    keys("Enter")


def open_review(label, command="/annotate-last", filename="last-reply.md"):
    submit(command, label)
    output = wait(filename + " · 0 annotations", label)
    if INHERIT_THEME:
        roles = [("background", "48"), ("foreground", "38"), ("heading", "38")]
        if filename == "last-reply.md" and "bold label" in output:
            roles += [("strong", "38"), ("listItem", "38"), ("linkText", "38")]
        check_colors(label, roles)
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
    ready = root / "plugin-ready"
    (fixture / "tui.ts").write_text(f'''import plugin from {json.dumps(ENTRYPOINT)}
import {{ writeFileSync }} from "node:fs"
export default {{
  ...plugin,
  id: "test.annotate-last",
  setup(ctx) {{
    const rgb = color => [color.r, color.g, color.b].map(value => Math.round(value * 255))
    writeFileSync({json.dumps(str(root / "host-colors.json"))}, JSON.stringify({{
      background: rgb(ctx.theme.background.base), foreground: rgb(ctx.theme.text.base),
      heading: rgb(ctx.theme.markdown.heading), strong: rgb(ctx.theme.markdown.strong),
      listItem: rgb(ctx.theme.markdown.listItem), linkText: rgb(ctx.theme.markdown.linkText),
      selection: rgb(ctx.theme.background.action.primary.focused),
      selectionForeground: rgb(ctx.themeMode === "light" ? ctx.theme.text.base : ctx.theme.text.action.primary.focused),
    }}))
    return plugin.setup({{
      ...ctx,
      keymap: {{ ...ctx.keymap, layer(factory) {{
        return ctx.keymap.layer(() => {{
          const layer = factory()
          writeFileSync({json.dumps(str(ready))}, "ready")
          return layer
        }})
      }} }},
      client: {{ ...ctx.client,
        message: {{ async list() {{ return {{ data: [{{
          id: "msg_smoke_fixture", type: "assistant", agent: "build",
          model: {{ providerID: "fixture", id: "fixture" }},
          time: {{ created: 2, completed: 3 }}, finish: "stop",
          content: [{{ type: "text", text: "# Terminal review fixture\\n\\nAlpha paragraph with **bold label**.\\n\\n- bullet item\\n\\n1. numbered [item](https://example.com)\\n" }}],
        }}, {{
          id: "msg_smoke_progress", type: "assistant", agent: "build",
          model: {{ providerID: "fixture", id: "fixture" }},
          time: {{ created: 1, completed: 2 }}, finish: "tool-calls",
          content: [{{ type: "text", text: "# Progress update fixture\\n\\nAlpha paragraph.\\n" }}],
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
        "theme": {"name": "dracula", "mode": THEME_MODE},
        "debug": {"devtools": False}, "tabs": {"mode": "off"},
    })
    command = shlex.join(["env", f"OPENCODE_CLI_CONFIG_CONTENT={inline}",
                          "opencode", "--session", session, str(root)])
    tmux("new-session", "-d", "-s", "check", "-x", "140", "-y", "42", "-c", str(root), command)
    wait("Annotate-last isolated smoke test", "host-ready", 60)
    # The session title can render before the plugin's mounted keymap exists.
    deadline = time.monotonic() + 60
    while not ready.exists():
        if time.monotonic() >= deadline:
            (root / "plugin-ready-failed.txt").write_text(screen())
            raise AssertionError("The isolated plugin keymap did not mount")
        time.sleep(0.05)

    open_review("review-open")
    if INHERIT_THEME:
        keys("v", "Right", "Enter")
        wait("selected", "selection")
        check_colors("selection", [("selection", "48"), ("selectionForeground", "38")])
        keys("Escape")
        wait("block 1/4", "selection-cleared")
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

    if SEND_KEY:
        # Ctrl+S mid-comment saves it and sends without OpenCode's confirmation.
        open_review("send-key-open")
        keys("c")
        wait("ctrl+s sends", "send-key-compose")
        literal("SMOKE one-key feedback")
        keys("C-s")
        output = wait("Sent 1 annotation", "send-key-sent")
        assert "Send annotations?" not in output, output
        inbox = api("get", f"/api/session/{session}/inbox")
        assert "SMOKE one-key feedback" in json.dumps(inbox, ensure_ascii=False)

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

    # Mid-turn progress updates are reachable through the picker.
    submit("/annotate-pick", "pick")
    wait("Progress update fixture", "pick-dialog")
    keys("Down")
    keys("Enter")
    wait("progress-update.md · 0 annotations", "pick-open")
    wait("Progress update fixture", "pick-content")
    annotate("SMOKE progress feedback", "pick-note")
    keys("q")
    wait("Send annotations?", "pick-confirmation")
    keys("Enter")
    wait("Sent 1 annotation", "pick-sent")
    pick_inbox = api("get", f"/api/session/{session}/inbox")
    encoded = json.dumps(pick_inbox)
    assert "msg_smoke_progress" in encoded and "SMOKE progress feedback" in encoded, encoded

    # Browser review opens a local receiver without a model call or visible browser.
    submit("/annotate-web", "web")
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
                                   "picker with progress updates", "browser pairing", "browser API delivery", "retry deduplication"],
                      "theme": THEME_MODE, "inheritedColors": INHERIT_THEME, "sendKey": SEND_KEY,
                      "evidence": str(root)}, ensure_ascii=False))
finally:
    tmux("kill-server", check=False)
    if session:
        api("delete", f"/api/session/{session}")
