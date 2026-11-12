"""Headless OpenCode + bundled Annotate TUI round trip; no model call or visible window."""
import json
import os
from pathlib import Path
from urllib.parse import unquote, urlparse
import shlex
import shutil
import socket as unix_socket
import struct
import subprocess
import tempfile
import time
import uuid


PLUGIN = Path(__file__).resolve().parent
ENTRYPOINT = Path(os.environ.get("ANNOTATE_TUI_ENTRY", str(PLUGIN / "tui.ts"))).resolve().as_uri()
BINARY_OPTIONS = {"binary": os.environ["ANNOTATE_TUI_BINARY"]} if os.environ.get("ANNOTATE_TUI_BINARY") else {}
BINARY_OPTIONS.update({"autoAnnotate": True, "autoAnnotateThreshold": 40, "inputSource": False})
INHERIT_THEME = os.environ.get("ANNOTATE_INHERIT_THEME") == "1"
THEME_MODE = os.environ.get("ANNOTATE_THEME_MODE", "dark")
if INHERIT_THEME:
    BINARY_OPTIONS["inheritTheme"] = True
SEND_KEY = os.environ.get("ANNOTATE_SEND_KEY", "1") == "1"
# q sends notes directly; Ctrl+C leaves them for OpenCode to ask.
ASK = "C-c" if SEND_KEY else "q"
EXPECTED_MARGIN = int(os.environ.get("ANNOTATE_EXPECT_MARGIN", "0"))
TMP = Path(os.environ.get("TMPDIR", tempfile.gettempdir())) / "opencode"
TMP.mkdir(exist_ok=True)
root = Path(tempfile.mkdtemp(prefix="annotate-smoke-", dir=TMP)).resolve()
socket = f"annotate-smoke-{os.getpid()}"
session = None
event_number = 0
# A short fixture home keeps Unix socket paths under macOS's 104-byte limit.
# Only the isolated TUI process overrides os.homedir; the managed API stays untouched.
fixture_home = Path(tempfile.mkdtemp(prefix="oa-", dir="/tmp"))
MESSAGE_SUFFIX = uuid.uuid4().hex


def message_id(name):
    return f"msg_smoke_{name}_{MESSAGE_SUFFIX}"


def api(method, route, data=None):
    args = ["opencode", "api", method, route]
    if data is not None:
        args += ["--data", json.dumps(data)]
    result = subprocess.run(args, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError(f"API {method} {route} failed ({result.returncode}); "
                           f"stderr: {result.stderr[:2000]}; stdout: {result.stdout[:2000]}")
    return json.loads(result.stdout) if result.stdout.strip() else None


def bridge_request(target, message):
    with unix_socket.socket(unix_socket.AF_UNIX, unix_socket.SOCK_STREAM) as connection:
        connection.settimeout(20)
        connection.connect(target["socket"])
        body = json.dumps({**message, "targetID": target["id"]}).encode()
        connection.sendall(struct.pack("<I", len(body)) + body)
        header = b""
        while len(header) < 4:
            chunk = connection.recv(4 - len(header))
            if not chunk:
                raise AssertionError("Bridge closed before returning a response header")
            header += chunk
        size = struct.unpack("<I", header)[0]
        data = b""
        while len(data) < size:
            chunk = connection.recv(size - len(data))
            if not chunk:
                raise AssertionError("Bridge returned an incomplete response")
            data += chunk
        return json.loads(data)


def wait_inbox(text, session_id):
    # A prior "Sent 1 annotation" toast can still be visible after the next review
    # closes. Wait for durable admission, not that reused success label.
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        inbox = api("get", f"/api/session/{session_id}/inbox")
        if text in json.dumps(inbox, ensure_ascii=False):
            return inbox
        time.sleep(0.1)
    raise AssertionError(f"Feedback {text!r} did not reach the inbox; evidence: {root}")


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


def wait_event(number):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        receipt = root / "event-done"
        if receipt.exists() and receipt.read_text() == str(number):
            return
        time.sleep(0.05)
    raise AssertionError(f"Fixture event {number} did not complete; evidence: {root}")


def event(kind, data, wait_done=True):
    global event_number
    event_number += 1
    payload = {"number": event_number, "event": {
        "id": f"evt_smoke_{event_number}", "created": time.time() * 1000,
        "type": kind, "data": {"sessionID": session, **data},
    }}
    pending = root / "event-pending"
    pending.write_text(json.dumps(payload))
    pending.replace(root / "event.json")
    if wait_done:
        wait_event(event_number)
    return event_number


def launches():
    counter = root / "review-launches"
    return len(counter.read_text().splitlines()) if counter.exists() else 0


def configure_auto(enabled):
    config = root / "opencode.jsonc"
    BINARY_OPTIONS["autoAnnotate"] = enabled
    config.write_text('// Auto-annotation hot reload.\n' + json.dumps({
        "plugins": [{"package": str(root / "fixture"), "options": BINARY_OPTIONS}],
    }))
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        loaded = root / "configuration-loaded.json"
        if loaded.exists() and json.loads(loaded.read_text()).get("autoAnnotate") is enabled:
            return
        time.sleep(0.05)
    raise AssertionError(f"autoAnnotate={enabled} was not reloaded; evidence: {root}")


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


def open_review(label, command="/annotate", filename="last-reply.md"):
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
    # The runtime intentionally strips PLANNOTATOR_TUI_* variables. Set the isolated
    # Unicode-only configuration at the executable boundary, never in user config.
    binary = subprocess.run([
        "node", "--input-type=module", "-e",
        f'import {{ resolveTuiBinary }} from {json.dumps((PLUGIN / "tui/binary.mjs").as_uri())}; '
        f'console.log(resolveTuiBinary({json.dumps(BINARY_OPTIONS.get("binary"))} ?? undefined))',
    ], capture_output=True, text=True, check=True, timeout=15).stdout.strip()
    (root / "tui.toml").write_text("")
    launcher = root / "annotate-tui"
    # Honor a fresh host-theme config supplied by prepareTheme after env filtering.
    launcher.write_text("#!/bin/sh\n" +
                        f'export PLANNOTATOR_TUI_CONFIG="${{PLANNOTATOR_TUI_CONFIG:-{root / "tui.toml"}}}"\n' +
                        "exec " + shlex.quote(binary) + ' "$@"\n')
    launcher.chmod(0o700)
    config_env = {key: value for key, value in os.environ.items() if key != "PLANNOTATOR_TUI_CONFIG"}
    effective = subprocess.run([str(launcher), "config"], env=config_env,
                               capture_output=True, text=True, check=True, timeout=15).stdout
    assert effective.startswith(f"# {root / 'tui.toml'}\n") and "toolbar_images" not in effective
    explicit_config = root / "explicit-tui.toml"
    explicit_config.write_text("[ui]\ndoc_width = 91\n")
    effective = subprocess.run([str(launcher), "config"],
                               env={**config_env, "PLANNOTATOR_TUI_CONFIG": str(explicit_config)},
                               capture_output=True, text=True, check=True, timeout=15).stdout
    assert effective.startswith(f"# {explicit_config}\n") and "doc_width = 91" in effective
    BINARY_OPTIONS["binary"] = str(launcher)
    # Keep selection deterministic; exercise the real plugin, renderer, binary, confirmation,
    # client SDK and API. resume:false is the only submission change, to avoid an LLM run.
    fixture = root / "fixture"
    fixture.mkdir()
    # Exercise URL routing while keeping Chrome closed and the real profile untouched.
    bin_dir = root / "bin"
    bin_dir.mkdir()
    opener = bin_dir / "open"
    opener.write_text('#!/usr/bin/env python3\nimport json, sys\nfrom pathlib import Path\n'
                      f'with Path({str(root / "opened.jsonl")!r}).open("a") as output:\n'
                      '    output.write(json.dumps(sys.argv[1:]) + "\\n")\n')
    opener.chmod(0o700)
    (fixture / "package.json").write_text(json.dumps({
        "name": "annotate-smoke", "type": "module", "exports": {".": "./server.ts", "./tui": "./tui.ts"},
    }))
    (fixture / "server.ts").write_text(f'''import {{ registerConfiguration }} from {json.dumps((Path(unquote(urlparse(ENTRYPOINT).path)).parent / "configuration.mjs").as_uri())}
export default {{ id: "test.annotate", async setup(ctx) {{ await registerConfiguration(ctx) }} }}
''')
    (root / "opencode.jsonc").write_text('// Auto-annotation options load through real JSONC configuration.\n' + json.dumps({
        "plugins": [{"package": str(fixture), "options": BINARY_OPTIONS}],
    }))
    ready = root / "plugin-ready"
    (fixture / "tui.ts").write_text(f'''import plugin from {json.dumps(ENTRYPOINT)}
import {{ appendFileSync, readFileSync, watchFile, unwatchFile, writeFileSync }} from "node:fs"
import os from "node:os"
os.homedir = () => {json.dumps(str(fixture_home))}
export default {{
  ...plugin,
  id: "test.annotate",
  async setup(ctx) {{
    const handlers = new Map()
    const eventFile = {json.dumps(str(root / "event.json"))}
    let processed = 0
    // Deliver schema-shaped completion events without starting a model turn. Message
    // lookup, plugin options, renderer, reviewer and feedback delivery remain real.
    watchFile(eventFile, {{ interval: 50 }}, async () => {{
      let payload
      try {{ payload = JSON.parse(readFileSync(eventFile, "utf8")) }} catch {{ return }}
      if (payload.number <= processed) return
      processed = payload.number
      appendFileSync({json.dumps(str(root / "events.jsonl"))}, JSON.stringify({{
        number: payload.number, type: payload.event.type, handlers: handlers.get(payload.event.type)?.size ?? 0,
        route: ctx.ui.router.current(), status: ctx.data.session.status(payload.event.data.sessionID), options: ctx.options,
      }}) + "\\n")
      for (const handler of handlers.get(payload.event.type) ?? []) await handler(payload.event)
      writeFileSync({json.dumps(str(root / "event-done"))}, String(payload.number))
    }})
    const rgb = color => [color.r, color.g, color.b].map(value => Math.round(value * 255))
    writeFileSync({json.dumps(str(root / "host-colors.json"))}, JSON.stringify({{
      background: rgb(ctx.theme.background.base), foreground: rgb(ctx.theme.text.base),
      heading: rgb(ctx.theme.markdown.heading), strong: rgb(ctx.theme.markdown.strong),
      listItem: rgb(ctx.theme.markdown.listItem), linkText: rgb(ctx.theme.markdown.linkText),
      selection: rgb(ctx.theme.background.action.primary.focused),
      selectionForeground: rgb(ctx.themeMode === "light" ? ctx.theme.text.base : ctx.theme.text.action.primary.focused),
    }}))
    const dispose = await plugin.setup({{
      ...ctx,
      ui: {{ ...ctx.ui,
        router: {{ ...ctx.ui.router, navigate(route) {{
          ctx.ui.router.navigate(route)
          writeFileSync({json.dumps(str(root / "navigated.json"))}, JSON.stringify(ctx.ui.router.current()))
        }} }},
        toast: {{ show(notice) {{
        appendFileSync({json.dumps(str(root / "notices.jsonl"))}, JSON.stringify(notice) + "\\n")
        ctx.ui.toast.show(notice)
      }} }} }},
      data: {{ ...ctx.data, on(type, handler) {{
        if (!handlers.has(type)) handlers.set(type, new Set())
        handlers.get(type).add(handler)
        const stop = ctx.data.on(type, handler)
        return () => {{ handlers.get(type).delete(handler); stop() }}
      }} }},
      renderer: new Proxy(ctx.renderer, {{ get(target, key) {{
        if (key === "suspend") return async () => {{
          appendFileSync({json.dumps(str(root / "review-launches"))}, "launch\\n")
          return target.suspend()
        }}
        const value = Reflect.get(target, key)
        return typeof value === "function" ? value.bind(target) : value
      }} }}),
      keymap: {{ ...ctx.keymap, layer(factory) {{
        return ctx.keymap.layer(() => {{
          const layer = factory()
          writeFileSync({json.dumps(str(root / "registered-commands.json"))}, JSON.stringify(layer.commands.map(command => ({{ id: command.id, slash: command.slash?.name }}))))
          writeFileSync({json.dumps(str(ready))}, "ready")
          return {{ ...layer, commands: [...layer.commands, {{
            id: "test.annotate-home", slash: {{ name: "smoke-home", arguments: true }},
            run() {{
              ctx.ui.router.navigate({{ type: "home" }})
              ctx.ui.toast.show({{ message: "Blank home ready", duration: 10000 }})
            }},
          }}] }}
        }})
      }} }},
      client: {{ ...ctx.client,
        rpc(definition) {{
          const rpc = ctx.client.rpc(definition)
          return {{ ...rpc, async get(...args) {{
            const result = await rpc.get(...args)
            writeFileSync({json.dumps(str(root / "configuration-loaded.json"))}, JSON.stringify(result))
            return result
          }} }}
        }},
        message: {{ ...ctx.client.message, async list() {{ return {{ data: [{{
          id: {json.dumps(message_id("fixture"))}, type: "assistant", agent: "build",
          model: {{ providerID: "fixture", id: "fixture" }},
          time: {{ created: 2, completed: 3 }}, finish: "stop",
          content: [{{ type: "text", text: "# Terminal review fixture\\n\\nAlpha paragraph with **bold label**.\\n\\n- bullet item\\n\\n1. numbered [item](https://example.com)\\n" }}],
        }}, {{
          id: {json.dumps(message_id("progress"))}, type: "assistant", agent: "build",
          model: {{ providerID: "fixture", id: "fixture" }},
          time: {{ created: 1, completed: 2 }}, finish: "tool-calls",
          content: [{{ type: "text", text: "# Progress update fixture\\n\\nAlpha paragraph.\\n" }}],
        }}, {{
          id: {json.dumps(message_id("older"))}, type: "assistant", agent: "build",
          model: {{ providerID: "fixture", id: "fixture" }},
          time: {{ created: 0, completed: 1 }}, finish: "stop",
          content: [{{ type: "text", text: "# Previous reply fixture\\n\\nAlpha paragraph.\\n" }}],
        }}], cursor: {{}} }} }} }},
        session: {{ ...ctx.client.session,
        async create(...args) {{
          writeFileSync({json.dumps(str(root / "blank-create-input.json"))}, JSON.stringify({{
            input: args[0], selected: ctx.ui.model.current(),
          }}))
          const session = await ctx.client.session.create(...args)
          writeFileSync({json.dumps(str(root / "blank-session.json"))}, JSON.stringify(session))
          return session
        }},
        prompt(input) {{
          appendFileSync({json.dumps(str(root / "prompt-inputs.jsonl"))}, JSON.stringify(input) + "\\n")
          return ctx.client.session.prompt({{ ...input, resume: false }})
        }},
      }} }},
    }})
    return () => {{ unwatchFile(eventFile); dispose() }}
  }},
}}
''')
    info = api("post", "/api/session", {
        "title": "Annotate isolated smoke test", "location": {"directory": str(root)},
    })["data"]
    session = info["id"]
    api("delete", f"/api/session/{session}")
    auto_text = "# Automatic exact reply fixture\n\nAlpha paragraph for automatic review.\n"
    messages = [
        {"id": message_id, "type": "assistant", "agent": "build",
         "model": {"providerID": "fixture", "id": "fixture"}, "finish": finish,
         "time": {"created": index, "completed": index + 1}, "content": [{"type": "text", "text": text}]}
        for index, (message_id, text, finish) in enumerate([
            (message_id("auto"), auto_text, "stop"),
            (message_id("short"), "Short reply.", "stop"),
            (message_id("auto_progress"), "Long progress update that must never open the automatic reviewer.", "tool-calls"),
            (message_id("auto_disabled"), auto_text, "stop"),
            (message_id("auto_empty"), auto_text, "stop"),
        ])
    ]
    api("post", "/api/experimental/session/import", {
        "info": info, "location": {"directory": str(root)}, "messages": messages,
    })
    inline = json.dumps({
        "plugins": ["-opencode-annotate"], "animations": False,
        "theme": {"name": "dracula", "mode": THEME_MODE},
        "debug": {"devtools": False}, "tabs": {"mode": "off"},
    })
    command = shlex.join(["env", f"OPENCODE_CLI_CONFIG_CONTENT={inline}", f"PATH={bin_dir}:{os.environ['PATH']}",
                          "opencode", "--session", session, str(root)])
    tmux("new-session", "-d", "-s", "check", "-x", "140", "-y", "42", "-c", str(root), command)
    wait("Annotate isolated smoke test", "host-ready", 60)
    # The session title can render before the plugin's mounted keymap exists.
    deadline = time.monotonic() + 60
    while not ready.exists():
        if time.monotonic() >= deadline:
            (root / "plugin-ready-failed.txt").write_text(screen())
            raise AssertionError("The isolated plugin keymap did not mount")
        time.sleep(0.05)

    commands = json.loads((root / "registered-commands.json").read_text())
    assert any(command.get("slash") == "annotate" for command in commands), commands
    assert all(command.get("slash") not in ("annotate-last", "annotate-web")
               and command["id"] not in ("opencode-annotate.annotate-last", "opencode-annotate.annotate-web")
               for command in commands), commands

    # Imported history alone must not open a review. Short replies and progress updates
    # stay closed; a successful new completion opens the exact reply via the real API.
    assert launches() == 0
    for reply_id, finish in [(message_id("short"), "stop"), (message_id("auto_progress"), "tool-calls")]:
        event("session.step.ended", {"assistantMessageID": reply_id, "finish": finish})
        event("session.execution.succeeded", {})
        assert launches() == 0
    event("session.step.ended", {"assistantMessageID": message_id("auto"), "finish": "stop"})
    assert launches() == 0, "A completed text block is not yet a completed turn"
    completion = event("session.execution.succeeded", {}, wait_done=False)
    wait("last-reply.md · 0 annotations", "auto-open")
    wait("Automatic exact reply fixture", "auto-exact-content")
    annotate("SMOKE automatic feedback", "auto-note")
    keys("q")
    wait("Sent 1 annotation", "auto-sent")
    wait_event(completion)
    automatic_inbox = json.dumps(wait_inbox("SMOKE automatic feedback", session))
    assert "SMOKE automatic feedback" in automatic_inbox and message_id("auto") in automatic_inbox
    event("session.step.ended", {"assistantMessageID": message_id("auto"), "finish": "stop"})
    event("session.execution.succeeded", {})
    assert launches() == 1, "A completed reply must open only once"
    assert len(api("get", f"/api/session/{session}/message")["data"]) == len(messages), "No model turn should run"

    configure_auto(False)
    event("session.step.ended", {"assistantMessageID": message_id("auto_disabled"), "finish": "stop"})
    event("session.execution.succeeded", {})
    assert launches() == 1, "Saving autoAnnotate:false must disable automatic reviews"
    configure_auto(True)
    event("session.step.ended", {"assistantMessageID": message_id("auto"), "finish": "stop"})
    event("session.execution.succeeded", {})
    assert launches() == 1, "Config reload must preserve deduplication"
    before_empty = api("get", f"/api/session/{session}/inbox")
    event("session.step.ended", {"assistantMessageID": message_id("auto_empty"), "finish": "stop"})
    completion = event("session.execution.succeeded", {}, wait_done=False)
    wait("last-reply.md · 0 annotations", "auto-reenabled")
    keys("q")
    wait_event(completion)
    assert launches() == 2
    assert api("get", f"/api/session/{session}/inbox") == before_empty

    open_review("review-open")
    if INHERIT_THEME:
        keys("v", "Right", "Enter")
        wait("selected", "selection")
        check_colors("selection", [("selection", "48"), ("selectionForeground", "38")])
        keys("Escape")
        wait("block 1/4", "selection-cleared")
    annotate("SMOKE exact-session feedback", "note-created")
    keys(ASK)
    wait("Send annotations?", "confirmation")
    keys("Enter")
    wait("Sent 1 annotation", "sent")
    inbox = wait_inbox("SMOKE exact-session feedback", session)
    (root / "inbox.json").write_text(json.dumps(inbox, ensure_ascii=False, indent=2))
    encoded = json.dumps(inbox, ensure_ascii=False)
    assert "SMOKE exact-session feedback" in encoded, encoded
    assert message_id("fixture") in encoded, encoded

    if SEND_KEY:
        # Ctrl+S mid-comment saves it and sends without OpenCode's confirmation.
        open_review("send-key-open")
        keys("c")
        wait("ctrl+s sends", "send-key-compose")
        literal("SMOKE one-key feedback")
        keys("C-s")
        output = wait("Sent 1 annotation", "send-key-sent")
        assert "Send annotations?" not in output, output
        inbox = wait_inbox("SMOKE one-key feedback", session)
        assert "SMOKE one-key feedback" in json.dumps(inbox, ensure_ascii=False)

        # q with notes returns and sends without OpenCode's confirmation.
        open_review("q-send-open")
        annotate("SMOKE q feedback", "q-send-note")
        keys("q")
        output = wait("Sent 1 annotation", "q-send-sent")
        assert "Send annotations?" not in output, output
        inbox = wait_inbox("SMOKE q feedback", session)
        assert "SMOKE q feedback" in json.dumps(inbox, ensure_ascii=False)

    open_review("empty-open", "/annotate")
    keys("q")
    wait("No annotations", "empty-return")
    after_empty = api("get", f"/api/session/{session}/inbox")
    assert after_empty == inbox, "Empty review changed the inbox"

    open_review("cancel-open")
    annotate("SMOKE must not be sent", "cancel-note")
    keys(ASK)
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
    keys(ASK)
    wait("Document:", "document-confirmation")
    keys("Enter")
    wait("Sent 1 annotation", "document-sent")
    document_inbox = wait_inbox("SMOKE document feedback", session)
    encoded = json.dumps(document_inbox, ensure_ascii=False)
    assert "SMOKE document feedback" in encoded, encoded
    assert str(document) in encoded, encoded
    assert document.read_text() == content, "Review modified the original document"

    # Mid-turn progress updates are reachable through the picker.
    submit("/annotate-pick", "pick")
    wait("Progress update fixture", "pick-dialog")
    keys("Down")
    keys("Enter")
    wait("progress-update.md · 0 annotations", "pick-open")
    wait("Progress update fixture", "pick-content")
    annotate("SMOKE progress feedback", "pick-note")
    keys(ASK)
    wait("Send annotations?", "pick-confirmation")
    keys("Enter")
    wait("Sent 1 annotation", "pick-sent")
    pick_inbox = wait_inbox("SMOKE progress feedback", session)
    encoded = json.dumps(pick_inbox)
    assert message_id("progress") in encoded and "SMOKE progress feedback" in encoded, encoded

    # /annotate routes explicit browser targets; opening neither sends nor runs a model.
    submit("/annotate https://example.test/review", "web-url")
    wait("Page opened", "web-url-opened")
    html_file = root / "中文 page.html"
    html_file.write_text("<h1>Browser fixture</h1>")
    submit('/annotate "中文 page.html"', "web-html")
    deadline = time.monotonic() + 30
    while len((root / "opened.jsonl").read_text().splitlines()) < 2:
        if time.monotonic() > deadline:
            raise AssertionError("The HTML target did not reach the browser opener")
        time.sleep(0.05)
    opened = [json.loads(line) for line in (root / "opened.jsonl").read_text().splitlines()]
    assert opened == [["-a", "Google Chrome", "https://example.test/review"], ["-a", "Google Chrome", html_file.as_uri()]], opened

    # Automatic registration provides a receiver without a separate command.
    registry = fixture_home / ".local/share/opencode-annotate/targets"
    target = next(json.loads(p.read_text()) for p in registry.glob("*.json")
                  if json.loads(p.read_text()).get("sessionID") == session)
    batch = {"action": "send", "targetID": target["id"], "batchID": "12345678-1234-1234-1234-123456789012",
             "review": {"version": 2,
                        "annotations": [{"page": {"url": "https://example.test/review", "title": "Smoke page"}, "id": "smoke-note", "revision": 1, "kind": "comment",
                                         "comment": "SMOKE browser exact-session feedback", "createdAt": "2026-10-19T00:00:00Z",
                                         "anchor": {"type": "text", "quote": "Alpha", "selector": "#alpha"}}]}}
    def send_batch():
        return bridge_request(target, batch)
    receipt = send_batch()
    assert receipt["state"] == "admitted", receipt
    assert send_batch() == receipt
    web_inbox = json.dumps(api("get", f"/api/session/{session}/inbox"))
    assert "SMOKE browser exact-session feedback" in web_inbox
    assert receipt["messageID"] in web_inbox
    assert len(api("get", f"/api/session/{session}/message")["data"]) == len(messages), "No model turn should run"

    # A real blank home route has no session ID. Pairing must create one through the
    # connected SDK, navigate to it and accept the first feedback without a seed prompt.
    submit("/smoke-home", "blank-home")
    wait("Blank home ready", "blank-home-ready")
    workspace = next(json.loads(p.read_text()) for p in registry.glob("*.json")
                     if json.loads(p.read_text()).get("kind") == "workspace"
                     and json.loads(p.read_text()).get("pid") == target["pid"])
    workspace_info = bridge_request(workspace, {"action": "info"})
    assert Path(workspace_info["target"]["directory"]).resolve() == root
    creation = {"action": "create-session", "requestID": "22345678-1234-1234-1234-123456789012"}
    created = bridge_request(workspace, creation)
    assert created["ok"], created
    assert bridge_request(workspace, creation) == created, "Creation retry must reuse the session"
    blank = json.loads((root / "blank-session.json").read_text())
    blank_session = blank["id"]
    assert created["target"]["sessionID"] == blank_session
    assert blank_session != session
    assert Path(blank["location"]["directory"]).resolve() == root
    selected = json.loads((root / "blank-create-input.json").read_text())["selected"]
    assert blank["model"]["id"] == selected["modelID"]
    assert blank["model"]["providerID"] == selected["providerID"]
    assert blank["model"].get("variant") == selected.get("variant")
    assert json.loads((root / "navigated.json").read_text()) == {"type": "session", "sessionID": blank_session}
    assert api("get", f"/api/session/{blank_session}/message")["data"] == []
    assert api("get", f"/api/session/{blank_session}/inbox")["data"] == []
    target = next(json.loads(p.read_text()) for p in registry.glob("*.json")
                  if json.loads(p.read_text()).get("sessionID") == blank_session)
    batch["targetID"] = target["id"]
    batch["review"]["annotations"][0]["comment"] = "SMOKE blank-session feedback"
    receipt = send_batch()
    (root / "blank-target.json").write_text(json.dumps(target))
    (root / "blank-receipt.json").write_text(json.dumps(receipt))
    assert receipt["state"] == "admitted", receipt
    blank_inbox = json.dumps(wait_inbox("SMOKE blank-session feedback", blank_session))
    assert receipt["messageID"] in blank_inbox
    blank_prompts = [json.loads(line) for line in (root / "prompt-inputs.jsonl").read_text().splitlines()
                     if json.loads(line)["sessionID"] == blank_session]
    assert len(blank_prompts) == 1
    assert blank_prompts[0]["delivery"] == "steer", blank_prompts
    assert blank_prompts[0]["resume"] is True, blank_prompts
    assert api("get", f"/api/session/{blank_session}/message")["data"] == [], "No model turn should run"
    assert "SMOKE blank-session feedback" not in json.dumps(api("get", f"/api/session/{session}/inbox"))
    disconnected = bridge_request(target, {"action": "disconnect"})
    assert disconnected["ok"] and disconnected["target"]["connected"] is False
    assert send_batch()["ok"] is False, "Disconnected sessions must reject feedback"
    assert bridge_request(target, {"action": "connect"})["target"]["connected"] is True
    assert send_batch() == receipt, "Reconnect must preserve delivery deduplication"

    prompts = [json.loads(line) for line in (root / "prompt-inputs.jsonl").read_text().splitlines()]
    assert all(prompt["delivery"] == "steer" and prompt["resume"] is True for prompt in prompts), prompts

    print(json.dumps({"passed": ["JSONC auto-annotation options", "automatic exact-reply lookup",
                                  "short/progress suppression", "automatic trigger deduplication", "JSONC toggle hot reload",
                                  "real TUI launch", "create annotation", "terminal restore",
                                   "confirmed API delivery", "steer/resume intent", "empty review", "cancelled review",
                                  "document path arguments", "document API delivery", "retired commands removed",
                                   "picker with progress updates", "URL and HTML routing", "automatic browser connection", "browser API delivery", "retry deduplication",
                                   "extension blank-home session creation", "blank-session browser delivery", "disconnect and reconnect"],
                      "theme": THEME_MODE, "inheritedColors": INHERIT_THEME, "sendKey": SEND_KEY,
                      "evidence": str(root)}, ensure_ascii=False))
finally:
    tmux("kill-server", check=False)
    shutil.rmtree(fixture_home)
    if session:
        api("delete", f"/api/session/{session}")
    blank_file = root / "blank-session.json"
    if blank_file.exists():
        api("delete", f'/api/session/{json.loads(blank_file.read_text())["id"]}')
