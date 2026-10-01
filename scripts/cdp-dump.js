/* Dump every vscode-webview iframe target: overlay class + a snippet of
 * the page + the localStorage/state, to debug the cheat e2e. */
const http = 'http://127.0.0.1:9333/json/list';

async function evalIn(t, expr) {
  return new Promise((resolve) => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch {} resolve('TIMEOUT'); }, 6000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate',
        params: { expression: expr, returnByValue: true } }));
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.id === 1) {
          clearTimeout(timer);
          resolve(m.result && m.result.result && m.result.result.value);
          try { ws.close(); } catch {}
        }
      } catch { resolve('PARSE'); }
    };
    ws.onerror = () => { clearTimeout(timer); resolve('WSERR'); };
  });
}

async function main() {
  const list = await (await fetch(http)).json();
  const ts = list.filter((t) => t.type === 'iframe' && /vscode-webview/.test(t.url || ''));
  console.log('webview targets:', ts.length);
  for (const t of ts) {
    const state = await evalIn(t, `(() => {
      const o = document.querySelector('#cheat-overlay');
      return JSON.stringify({
        overlay: o ? o.className : 'NOEL',
        title: document.title || '(none)',
        envPill: (document.getElementById('env-pill')||{}).className || 'none',
        cheatFnCount: document.querySelectorAll('.cheat-fn').length,
        readyState: document.readyState,
        bodyLen: document.body ? document.body.innerHTML.length : -1,
        bodyHead: document.body ? document.body.innerHTML.slice(0, 240) : 'no-body'
      });;
    })()`);
    console.log('---', t.url.slice(0, 60), '\n   ', state);
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
