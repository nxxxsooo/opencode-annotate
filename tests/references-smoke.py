"""Exercise both plugin entrypoints in isolated sessions, without any model turn."""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile
import time


PLUGIN = Path(os.environ.get("ANNOTATE_PACKAGE_ROOT", Path(__file__).resolve().parent.parent)).resolve()
TMP = Path(os.environ.get("TMPDIR", tempfile.gettempdir())) / "opencode"
TMP.mkdir(exist_ok=True)
root = Path(tempfile.mkdtemp(prefix="annotate-ref-smoke-", dir=TMP)).resolve()
socket = f"annotate-ref-smoke-{os.getpid()}"
sessions = []
passed = False


def api(method, route, data=None):
    args = ["opencode", "api", method, route, "--header", "Accept-Encoding:identity"]
    if data is not None:
        args += ["--data", json.dumps(data)]
    result = subprocess.run(args, capture_output=True, text=True, check=True, timeout=60)
    return json.loads(result.stdout) if result.stdout.strip() else None


def tmux(*args, check=True):
    return subprocess.run(["tmux", "-L", socket, "-f", "/dev/null", *args],
                          capture_output=True, text=True, check=check, timeout=15).stdout


def wait(text, label):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        output = tmux("capture-pane", "-p", "-t", "check:0.0")
        if text in output:
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
    # A pending prompt with resume:false is not transcript history. Import a synthetic
    # fixture conversation so the read goes through the real message API.
    api("delete", f"/api/session/{source['id']}")
    api("post", "/api/experimental/session/import", {
        "info": source, "location": {"directory": str(root)},
        "messages": [
            {"id": "msg_refsmokeuser", "type": "user", "time": {"created": 1}, "text": "SMOKE pre-compaction decision\n" + "a" * 180000},
            {"id": "msg_refsmokelarge", "type": "user", "time": {"created": 1.5}, "text": "SMOKE large response\n" + "b" * 180000},
            {"id": "msg_refsmokecheckpoint", "type": "compaction", "time": {"created": 2},
             "status": "completed", "reason": "manual", "summary": "SMOKE summary"},
            *[{"id": f"msg_refsmokefiller{n:03d}", "type": "user", "time": {"created": n + 3},
               "text": f"SMOKE following exchange {n}"} for n in range(55)],
            {"id": "msg_refsmokeanswer", "type": "assistant", "time": {"created": 60, "completed": 61},
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
    const tool = {{ sessionID: {json.dumps(target["id"])}, messageID: "msg_refsmokecall", id: "ref-smoke",
      agent: "build", signal: new AbortController().signal, progress: async () => {{}} }}
    const found = await search.execute({{ query: {json.dumps(root.name)} }}, tool)
    const reference = await read.execute({{ sessionID: {json.dumps(source["id"])} }}, tool)
    const older = await read.execute({{ sessionID: {json.dumps(source["id"])}, cursor: JSON.parse(reference.content).nextCursor }}, tool)
    const message = await read.execute({{ sessionID: {json.dumps(source["id"])}, messageID: "msg_refsmokeanswer", offset: 6 }}, tool)
    writeFileSync({json.dumps(str(result_path))}, JSON.stringify({{ found, reference, older, message }}))
  }} catch (error) {{
    writeFileSync({json.dumps(str(result_path))}, JSON.stringify({{ error: String(error), stack: error.stack,
      contextKeys: Object.keys(ctx), sessionKeys: Object.keys(ctx.session), permissionKeys: Object.keys(ctx.permission), experimentalKeys: Object.keys(ctx.experimental) }}))
  }}
}} }}
''')
    ready = root / "tui-ready"
    (fixture / "tui.ts").write_text(f'''import plugin from {json.dumps((PLUGIN / "tui.ts").as_uri())}
import {{ writeFileSync }} from "node:fs"
export default {{ ...plugin, id: "test.annotate-ref", setup(ctx) {{
  return plugin.setup({{ ...ctx, options: {{ ...ctx.options, inputSource: false }},
    keymap: {{ ...ctx.keymap, layer(factory) {{ return ctx.keymap.layer(() => {{
      const layer = factory()
      writeFileSync({json.dumps(str(ready))}, "ready")
      return layer
    }}) }} }}
  }})
}} }}
''')
    # Loading this test location activates its server + TUI package together.
    inline = json.dumps({"animations": False, "tabs": {"mode": "off"}, "debug": {"devtools": False}})
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

    tmux("send-keys", "-t", "check:0.0", "-l", f"/ref {source['id']} ")
    wait(f"/ref {source['id']}", "command-typed")
    tmux("send-keys", "-t", "check:0.0", "Enter")
    wait("Attach conversation reference?", "confirm")
    tmux("send-keys", "-t", "check:0.0", "Enter")
    wait(f"Reference: {source['title']}", "attached")
    inbox = api("get", f"/api/session/{target['id']}/inbox")["data"]
    references = [item for item in inbox if item["type"] == "synthetic"]
    assert len(references) == 1, inbox
    assert "SMOKE agreed implementation" in references[0]["payload"]["text"], inbox
    assert "SMOKE private reasoning" not in references[0]["payload"]["text"], inbox
    assert source["id"] in references[0]["payload"]["text"], inbox
    assert references[0]["sessionID"] == target["id"], inbox
    assert api("get", f"/api/session/{target['id']}/message")["data"] == [], "Attaching must not run a model turn"

    tmux("send-keys", "-t", "check:0.0", "-l", f"/ref {root.name} ")
    wait(f"/ref {root.name}", "picker-command")
    tmux("send-keys", "-t", "check:0.0", "Enter")
    wait("Reference a conversation", "picker")
    tmux("send-keys", "-t", "check:0.0", "Escape")
    assert api("get", f"/api/session/{target['id']}/inbox")["data"] == inbox
    passed = True
    print("Passed: real server tools, pre-compaction history, >256 KiB response, pagination, message continuation, TUI /ref selection and attachment, cancellation, no model turn.")
finally:
    tmux("kill-server", check=False)
    for session_id in reversed(sessions):
        try:
            api("delete", f"/api/session/{session_id}")
        except subprocess.CalledProcessError:
            pass
    if passed:
        shutil.rmtree(root)
    else:
        print(f"Failed-run evidence: {root}")
