/* Find the panel content frame: connect to the webview wrapper target,
 * Runtime.enable to collect every frame execution context, evaluate the
 * overlay probe in each child-frame context. */
const http = "http://127.0.0.1:9333/json/list";

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let seq = 0;
    const pending = new Map();
    const ctxs = [];
    const send = (method, params) => new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
    ws.onopen = () => {
      send("Runtime.enable").then(() => setTimeout(() => resolve({
        ctxs,
        evalIn: (expr, contextId) => send("Runtime.evaluate", { expression: expr, returnByValue: true, contextId }),
        close: () => { try { ws.close(); } catch {} }
      }), 2000)).catch(reject);
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.method === "Runtime.executionContextCreated") {
          const c = msg.params.context;
          ctxs.push({ id: c.id, name: c.name, origin: c.origin,
            frameId: c.auxData ? c.auxData.frameId : null });
        }
        if (msg.id && pending.has(msg.id)) {
          const p = pending.get(msg.id); pending.delete(msg.id);
          msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
        }
      } catch {}
    };
    ws.onerror = () => reject(new Error("ws error"));
  });
}

const EXPR = `(() => {
  const o = document.querySelector("#cheat-overlay");
  return JSON.stringify({
    overlay: o ? o.className : "NOEL",
    bodyLen: document.body ? document.body.innerHTML.length : -1,
    head: document.body ? document.body.innerHTML.slice(0, 100) : "-"
  });
})()`;

async function main() {
  const list = await (await fetch(http + "/json/list")).json();
  const wrappers = list.filter((t) => t.type === "iframe" && /vscode-webview/.test(t.url || ""));
  console.log("wrappers:", wrappers.length);
  for (const t of wrappers) {
    const c = await connect(t.webSocketDebuggerUrl);
    console.log("contexts:", c.ctxs.map((x) => x.id + ":" + (x.origin || "").slice(0, 40) + ":" + x.name).join(" | "));
    for (const x of c.ctxs) {
      if (x.name === "__top__" || x.name === "main") { continue; }
      try {
        const r = await c.evalIn(EXPR, x.id);
        console.log("ctx", x.id, x.origin.slice(0, 50), "->", r.result && r.result.value);
      } catch (e) { console.log("ctx", x.id, "fail:", e.message); }
    }
    c.close();
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
