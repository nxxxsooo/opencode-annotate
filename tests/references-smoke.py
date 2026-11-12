"""Exercise both plugin entrypoints in isolated sessions, without any model turn."""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import time
import uuid


PLUGIN = Path(os.environ.get("ANNOTATE_PACKAGE_ROOT", Path(__file__).resolve().parent.parent)).resolve()
TMP = Path(os.environ.get("TMPDIR", tempfile.gettempdir())) / "opencode"
TMP.mkdir(exist_ok=True)
root = Path(tempfile.mkdtemp(prefix="annotate-ref-smoke-", dir=TMP)).resolve()
foreign_root = Path(tempfile.mkdtemp(prefix="annotate-ref-foreign-", dir=TMP)).resolve()
# Unix socket paths require a short fixture home on macOS.
fixture_home = Path(tempfile.mkdtemp(prefix="oa-", dir="/tmp"))
socket = f"annotate-ref-smoke-{os.getpid()}"
sessions = []
passed = False
MESSAGE_SUFFIX = uuid.uuid4().hex


def message_id(name):
    return f"msg_refsmoke{name}_{MESSAGE_SUFFIX}"


def api(method, route, data=None):
    args = ["opencode", "api", method, route, "--header", "Accept-Encoding:identity"]
    if data is not None:
        args += ["--data", json.dumps(data)]
    result = subprocess.run(args, capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError(f"API {method} {route} failed ({result.returncode}); "
                           f"stderr: {result.stderr[:2000]}; stdout: {result.stdout[:2000]}")
    return json.loads(result.stdout) if result.stdout.strip() else None


def tmux(*args, check=True):
    return subprocess.run(["tmux", "-L", socket, "-f", "/dev/null", *args],
                          capture_output=True, text=True, check=check, timeout=15).stdout


def wait(text, label, pane="check:0.0"):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        output = tmux("capture-pane", "-p", "-t", pane)
        if text in output:
            (root / f"{label}.txt").write_text(output)
            return output
        time.sleep(0.1)
    (root / f"{label}.txt").write_text(output)
    raise AssertionError(f"Did not see {text!r}; capture: {root / (label + '.txt')}")


try:
    target = api("post", "/api/session", {
        "title": "Reference isolated destination", "location": {"directory": str(root)},
    })["data"]
    sessions.append(target["id"])
    source = api("post", "/api/session", {
        "title": f"Reference source {root.name}", "location": {"directory": str(root)},
    })["data"]
    sessions.append(source["id"])
    foreign = api("post", "/api/session", {
        "title": f"Foreign scope {root.name}", "location": {"directory": str(foreign_root)},
    })["data"]
    sessions.append(foreign["id"])
    # The destination has spoken already, so an attachment continues it.
    api("delete", f"/api/session/{target['id']}")
    api("post", "/api/experimental/session/import", {
        "info": target, "location": {"directory": str(root)},
        "messages": [{"id": message_id("target"), "type": "user", "time": {"created": 1}, "text": "SMOKE destination question"}],
    })
    # A pending prompt with resume:false is not transcript history. Import a synthetic
    # fixture conversation so the read goes through the real message API.
    api("delete", f"/api/session/{source['id']}")
    api("post", "/api/experimental/session/import", {
        "info": source, "location": {"directory": str(root)},
        "messages": [
            {"id": message_id("user"), "type": "user", "time": {"created": 1}, "text": "SMOKE pre-compaction decision\n" + "a" * 180000},
            {"id": message_id("large"), "type": "user", "time": {"created": 1.5}, "text": "SMOKE large response\n" + "b" * 180000},
            {"id": message_id("checkpoint"), "type": "compaction", "time": {"created": 2},
             "status": "completed", "reason": "manual", "summary": "SMOKE summary"},
            *[{"id": message_id(f"filler{n:03d}"), "type": "user", "time": {"created": n + 3},
               "text": f"SMOKE following exchange {n}"} for n in range(55)],
            {"id": message_id("answer"), "type": "assistant", "time": {"created": 60, "completed": 61},
             "agent": "build", "model": {"providerID": "fixture", "id": "fixture"}, "finish": "stop",
             "content": [{"type": "text", "text": "SMOKE agreed implementation"},
                         {"type": "reasoning", "text": "SMOKE private reasoning"}]},
        ],
    })
    # Prove the selected transport can reach something that session.context cannot.
    source_context = api("get", f"/api/session/{source['id']}/context")["data"]
    assert "SMOKE pre-compaction decision" not in json.dumps(source_context), source_context
    fixture = root / ".opencode" / "plugins" / "reference-smoke"
    fixture.mkdir(parents=True)
    (fixture / "package.json").write_text(json.dumps({
        "name": "annotate-reference-smoke", "type": "module", "exports": {".": "./server.ts", "./tui": "./tui.ts"},
    }))
    result_path = root / "server-result.json"
    (fixture / "server.ts").write_text(f'''import plugin from {json.dumps((PLUGIN / "server.ts").as_uri())}
import {{ writeFileSync }} from "node:fs"
export default {{ ...plugin, id: "test.annotate-ref", async setup(ctx) {{
  try {{
    await plugin.setup(ctx)
    const tools = await ctx.tool.list()
    const search = tools.find(t => t.id === "annotate_session_search")
    const read = tools.find(t => t.id === "annotate_session_read")
    if (!search || !read) throw new Error("Reference tools were not registered")
    const tool = {{ sessionID: {json.dumps(target["id"])}, messageID: {json.dumps(message_id("call"))}, id: "ref-smoke",
      agent: "build", signal: new AbortController().signal, progress: async () => {{}} }}
    const found = await search.execute({{ query: {json.dumps(root.name)} }}, tool)
    const reference = await read.execute({{ sessionID: {json.dumps(source["id"])} }}, tool)
    const older = await read.execute({{ sessionID: {json.dumps(source["id"])}, cursor: JSON.parse(reference.content).nextCursor }}, tool)
    const message = await read.execute({{ sessionID: {json.dumps(source["id"])}, messageID: {json.dumps(message_id("answer"))}, offset: 6 }}, tool)
    writeFileSync({json.dumps(str(result_path))}, JSON.stringify({{ found, reference, older, message }}))
  }} catch (error) {{
    writeFileSync({json.dumps(str(result_path))}, JSON.stringify({{ error: String(error), stack: error.stack,
      contextKeys: Object.keys(ctx), sessionKeys: Object.keys(ctx.session), permissionKeys: Object.keys(ctx.permission), experimentalKeys: Object.keys(ctx.experimental) }}))
  }}
}} }}
''')
    ready = root / "tui-ready"
    submission_path = root / "reference-input.json"
    (fixture / "tui.ts").write_text(f'''import plugin from {json.dumps((PLUGIN / "tui.ts").as_uri())}
import {{ createReferenceCommand }} from {json.dumps((PLUGIN / "reference-command.mjs").as_uri())}
import {{ promptReferenceComment }} from {json.dumps((PLUGIN / "reference-comment.tsx").as_uri())}
import {{ writeFileSync }} from "node:fs"
import os from "node:os"
// Isolate automatic native-host setup and receiver registration from the user's home.
os.homedir = () => {json.dumps(str(fixture_home))}
export default {{ ...plugin, id: "test.annotate-ref", setup(ctx) {{
  const client = {{ ...ctx.client, session: {{ ...ctx.client.session, prompt(input, options) {{
    writeFileSync({json.dumps(str(submission_path))}, JSON.stringify(input))
    return ctx.client.session.prompt({{ ...input, resume: false }}, options)
  }} }} }}
  const reference = createReferenceCommand({{ ...ctx, client }}, {{
    promptComment: (options, signal) => promptReferenceComment(ctx, options, signal),
  }})
  return plugin.setup({{ ...ctx, client, options: {{ ...ctx.options, inputSource: false }},
    keymap: {{ ...ctx.keymap, layer(factory) {{ return ctx.keymap.layer(() => {{
      const layer = factory()
      writeFileSync({json.dumps(str(ready))}, "ready")
      return {{ ...layer, commands: [...layer.commands, {{
        id: "test.annotate-ref.ref", title: "Reference isolated source", palette: true,
        slash: {{ name: "ref-dev", arguments: true }}, run: reference.run,
      }}] }}
    }}) }} }}
  }})
}} }}
''')
    # The unique alias cannot be intercepted by the maintainer's installed /ref command.
    # Loading this test location activates its server + TUI package together.
    inline = json.dumps({"plugins": ["-opencode-annotate"], "animations": False,
                         "tabs": {"mode": "off"}, "debug": {"devtools": False}})
    command = shlex.join(["env", f"OPENCODE_CLI_CONFIG_CONTENT={inline}", "opencode", "--session", target["id"], str(root)])
    tmux("new-session", "-d", "-s", "check", "-x", "160", "-y", "42", "-c", str(root), command)
    wait("Reference isolated destination", "host-ready")
    deadline = time.monotonic() + 60
    while not ready.exists() or not result_path.exists():
        if time.monotonic() > deadline:
            raise AssertionError(f"Plugin did not finish setup: {root}")
        time.sleep(0.1)
    result = json.loads(result_path.read_text())
    assert "error" not in result, result
    assert source["id"] in result["found"]["content"], result
    assert "SMOKE agreed implementation" in result["reference"]["content"], result
    assert "SMOKE private reasoning" not in result["reference"]["content"], result
    assert "SMOKE pre-compaction decision" in result["older"]["content"], result
    assert "SMOKE large response" in result["older"]["content"], result
    assert sum(len(m["text"]) for m in json.loads(result["older"]["content"])["messages"]) <= 24000
    assert '"text":"agreed implementation"' in result["message"]["content"], result

    tmux("send-keys", "-t", "check:0.0", "-l", f"/ref-dev {source['id']} ")
    wait(f"┃  /ref-dev {source['id']}", "command-typed")
    tmux("send-keys", "-t", "check:0.0", "Enter")
    empty = wait("shift+enter newline", "comment-empty")
    footer_row = lambda output: next(n for n, line in enumerate(output.splitlines()) if "enter continue" in line)
    empty_footer = footer_row(empty)
    multiline = "\n".join(f"SMOKE multiline {n} 中文留言" for n in range(7))
    tmux("set-buffer", "-b", "ref-comment", multiline)
    tmux("paste-buffer", "-p", "-b", "ref-comment", "-t", "check:0.0")
    grown = wait("SMOKE multiline 6", "comment-grown")
    assert footer_row(grown) > empty_footer, grown
    assert all(f"SMOKE multiline {n}" in grown for n in range(7)), grown
    tmux("send-keys", "-t", "check:0.0", "S-Home", "BSpace")
    deadline = time.monotonic() + 10
    while footer_row(tmux("capture-pane", "-p", "-t", "check:0.0")) != empty_footer:
        if time.monotonic() > deadline:
            raise AssertionError("Reference comment did not shrink after clearing")
        time.sleep(0.1)
    tmux("send-keys", "-t", "check:0.0", "-l", "SMOKE reference comment")
    tmux("send-keys", "-t", "check:0.0", "-l", "\x1b[13;2u")
    tmux("send-keys", "-t", "check:0.0", "-l", "SMOKE second comment line")
    wait("SMOKE second comment line", "comment-newline")
    tmux("send-keys", "-t", "check:0.0", "Enter")
    wait("Attach conversation reference?", "confirm")
    tmux("send-keys", "-t", "check:0.0", "Enter")
    wait("Continuing the conversation.", "attached")
    submission = json.loads(submission_path.read_text())
    assert submission["resume"] is True, submission
    assert submission["delivery"] == "steer", submission
    assert submission["sessionID"] == target["id"], submission
    inbox = api("get", f"/api/session/{target['id']}/inbox")["data"]
    references = [item for item in inbox if item["type"] == "user"]
    assert len(references) == 1, inbox
    assert "SMOKE agreed implementation" in references[0]["payload"]["text"], inbox
    assert "SMOKE reference comment\nSMOKE second comment line" in references[0]["payload"]["text"], inbox
    assert "SMOKE private reasoning" not in references[0]["payload"]["text"], inbox
    assert source["id"] in references[0]["payload"]["text"], inbox
    assert references[0]["sessionID"] == target["id"], inbox
    assert references[0]["delivery"] == "steer", inbox
    assert not any(item["type"] == "synthetic" for item in inbox), "no synthetic items should remain in inbox"
    assert "description" not in submission, "session.prompt must not receive a description field"
    assert submission["text"] == references[0]["payload"]["text"], "submitted text must match inbox payload.text"
    assert [m["id"] for m in api("get", f"/api/session/{target['id']}/message")["data"]] == [message_id("target")], "The smoke fixture must suppress model execution"

    tmux("send-keys", "-t", "check:0.0", "-l", f"/ref-dev {source['id']} ")
    wait(f"┃  /ref-dev {source['id']}", "long-comment-command")
    tmux("send-keys", "-t", "check:0.0", "Enter")
    wait("shift+enter newline", "long-comment-open")
    long_comment = "\n".join(f"LONG {n:02d} " + "中文长留言自动换行。" * 8 for n in range(40)) + "\nDRAFT END"
    tmux("set-buffer", "-b", "ref-comment", long_comment)
    tmux("paste-buffer", "-p", "-b", "ref-comment", "-t", "check:0.0")
    capped = wait("DRAFT END", "comment-capped")
    assert "LONG 00" not in capped and "enter continue" in capped, capped
    assert footer_row(capped) - empty_footer <= 15, capped
    tmux("resize-window", "-t", "check:0", "-x", "60", "-y", "20")
    narrow = wait("esc cancel", "comment-narrow")
    assert "enter continue" in narrow and "DRAFT END" in narrow, narrow
    tmux("send-keys", "-t", "check:0.0", "Escape")
    wait("ctrl+p", "comment-cancelled")
    assert api("get", f"/api/session/{target['id']}/inbox")["data"] == inbox
    tmux("resize-window", "-t", "check:0", "-x", "160", "-y", "42")

    tmux("send-keys", "-t", "check:0.0", "-l", f"/ref-dev {source['id']} ")
    wait(f"┃  /ref-dev {source['id']}", "interrupt-command")
    tmux("send-keys", "-t", "check:0.0", "Enter")
    wait("shift+enter newline", "interrupt-comment")
    tmux("send-keys", "-t", "check:0.0", "C-c")
    deadline = time.monotonic() + 10
    while "enter continue" in tmux("capture-pane", "-p", "-t", "check:0.0"):
        if time.monotonic() > deadline:
            raise AssertionError("Ctrl+C did not cancel the reference comment")
        time.sleep(0.1)
    assert api("get", f"/api/session/{target['id']}/inbox")["data"] == inbox

    tmux("send-keys", "-t", "check:0.0", "-l", f"/ref-dev {root.name} ")
    wait(f"┃  /ref-dev {root.name}", "picker-command")
    tmux("send-keys", "-t", "check:0.0", "Enter")
    project_picker = wait("Reference a conversation · This project", "picker")
    assert "Foreign scope" not in project_picker
    tmux("send-keys", "-t", "check:0.0", "C-a")
    all_picker = wait("Reference a conversation · All projects", "all-projects")
    assert "Foreign scope" in all_picker
    tmux("send-keys", "-t", "check:0.0", "C-a")
    project_picker = wait("Reference a conversation · This project", "project-again")
    assert "Foreign scope" not in project_picker
    tmux("send-keys", "-t", "check:0.0", "Escape")
    assert api("get", f"/api/session/{target['id']}/inbox")["data"] == inbox
    # OpenCode home has no session yet: /ref creates one, attaches without continuing,
    # opens it, and a second /ref there adds another reference before the first message.
    home = "check:1.0"
    tmux("new-window", "-t", "check", "-c", str(root),
         shlex.join(["env", f"OPENCODE_CLI_CONFIG_CONTENT={inline}", "opencode", str(root)]))
    wait("ctrl+p", "home-ready", home)
    for attempt in range(2):
        tmux("send-keys", "-t", home, "-l", f"/ref-dev {source['id']} ")
        wait(f"┃  /ref-dev {source['id']}", f"home-command-{attempt}", home)
        tmux("send-keys", "-t", home, "Enter")
        wait("Comment on reference (optional)", f"home-comment-{attempt}", home)
        tmux("send-keys", "-t", home, "Enter")
        confirm = wait("Attach conversation reference?", f"home-confirm-{attempt}", home)
        assert "first message" in confirm, confirm
        tmux("send-keys", "-t", home, "Enter")
        deadline = time.monotonic() + 30
        while json.loads(submission_path.read_text())["sessionID"] == target["id"] or attempt and len(
                [i for i in api("get", f"/api/session/{created}/inbox")["data"] if i["type"] == "user"]) < 2:
            if time.monotonic() > deadline:
                raise AssertionError(f"Home reference was not attached: {root}")
            time.sleep(0.2)
        submission = json.loads(submission_path.read_text())
        assert submission["resume"] is False, submission
        if attempt == 0:
            created = submission["sessionID"]
            sessions.append(created)
            assert api("get", f"/api/session/{created}")["data"]["location"]["directory"] == str(root)
        assert submission["sessionID"] == created, "the second /ref targets the opened new session"
    assert api("get", f"/api/session/{created}/message")["data"] == []
    passed = True
    print("Passed: real server tools, pre-compaction history, >256 KiB response, pagination, message continuation, TUI /ref comment growth/shrink, multiline CJK paste, bounded scrolling, narrow/short resize, cancellation, selection and attachment, steer/resume intent, project/all scope toggle, /ref from home, repeated references before the first message, no model turn.")
finally:
    tmux("kill-server", check=False)
    shutil.rmtree(fixture_home)
    for session_id in reversed(sessions):
        try:
            api("delete", f"/api/session/{session_id}")
        except RuntimeError:
            pass
    if passed:
        shutil.rmtree(root)
        shutil.rmtree(foreign_root)
    else:
        print(f"Failed-run evidence: {root}, {foreign_root}")
