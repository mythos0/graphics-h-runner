/* quick CDP probe: evaluate in the vscode-webview iframe target */
const http = 'http://127.0.0.1:9333/json/list';

async function main() {
  const list = await (await fetch(http)).json();
  const t = list.find((x) => x.type === 'iframe' && /vscode-webview:\/\//.test(x.url || ''));
  if (!t) { console.log('no webview iframe target'); process.exit(1); }
  console.log('target url:', t.url.slice(0, 80));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  ws.onopen = () => {
    ws.send(JSON.stringify({
      id: 1, method: 'Runtime.evaluate',
      params: { expression: `(() => {
        const o = document.querySelector('#cheat-overlay');
        return JSON.stringify({
          hasOverlay: !!o,
          overlayDisplay: o ? getComputedStyle(o).display : null,
          title: document.title,
          bodyLen: document.body ? document.body.innerHTML.length : -1
        });
      })()`, returnByValue: true }
    }));
  };
  ws.onmessage = (ev) => { console.log(String(ev.data).slice(0, 800)); ws.close(); process.exit(0); };
  setTimeout(() => { console.log('probe timeout'); process.exit(1); }, 15000);
}
main();
