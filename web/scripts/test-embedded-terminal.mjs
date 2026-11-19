import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const { chromium } = createRequire(import.meta.url)("playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const html = `<html><body style="margin:0;background:#0c0b0c">
<div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';
import {Terminal} from '@xterm/xterm';
import {ReactFlow} from '@xyflow/react';import '@xyflow/react/dist/style.css';
import EmbeddedTerminal from '/src/shell/terminal/EmbeddedTerminal.tsx';
import '/src/shell.css';import '/src/shell/spatial/spatial.css';
const original=Terminal.prototype.open;
Terminal.prototype.open=function(...args){window.terminal=this;return original.apply(this,args);};
window.resets=0;const reset=Terminal.prototype.reset;
Terminal.prototype.reset=function(...args){window.resets++;return reset.apply(this,args);};
const Worker=()=>React.createElement('section',{className:'sp-worker sp-agent-node',
style:{width:900,height:600}},
React.createElement('header',{className:'sp-worker-head'},'OpenCode · Render check'),
React.createElement(EmbeddedTerminal,{sessionId:'render-test'}));
const nodeTypes={worker:Worker};
window.canvasKeys=[];
createRoot(document.getElementById('root')).render(React.createElement('div',{
className:'sp-shell',onKeyDown:event=>window.canvasKeys.push(event.key)},React.createElement(ReactFlow,{
nodes:[{id:'terminal',type:'worker',position:{x:30,y:30},data:{}}],nodeTypes,
onInit:flow=>window.flow=flow})));
</script></body></html>`;
const server = await createServer({
  root,
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  plugins: [{
    name: "embedded-terminal-fixture", enforce: "pre",
    load(id) {
      if (id.endsWith("/terminal/runtime.ts")) return `
const listeners=new Set(),outputListeners=new Set();let snapshot={output:'',tail:'',state:'running'};
window.resizes=[];window.writes=[];
window.emitOutput=text=>{snapshot={...snapshot,output:(snapshot.output+text).slice(-180000)};outputListeners.forEach(cb=>cb(text));listeners.forEach(cb=>cb());};
export const terminalRuntime={snapshot:()=>snapshot,
subscribe:(_id,cb)=>{listeners.add(cb);return()=>listeners.delete(cb);},
subscribeOutput:(_id,cb)=>{outputListeners.add(cb);if(snapshot.output)cb(snapshot.output);return()=>outputListeners.delete(cb);},
send:async(_id,text)=>window.writes.push(text),
resize:(_id,cols,rows)=>window.resizes.push({cols,rows})};`;
    },
    configureServer(server) {
      server.middlewares.use("/__terminal-render", async (_req, res) => {
        res.setHeader("Content-Type", "text/html");
        res.end(await server.transformIndexHtml("/__terminal-render", html));
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__terminal-render`);
  await page.waitForFunction(() => window.resizes?.length > 0);
  const viewport = await page.evaluate(() => window.flow.getViewport());
  await page.evaluate(() => window.emitOutput('\x1b[2J\x1b[H████████\r\n████████\r\nLiteral: \\u001b[31m\r\n\x1b[6n'));
  await page.waitForFunction(() => window.terminal.buffer.active.getLine(2)?.translateToString(true).includes('Literal: \\u001b[31m'));
  await page.waitForFunction(() => window.writes.some(text => /\x1b\[\d+;\d+R/.test(text)));
  const geometry = await page.evaluate(() => {
    const screen=document.querySelector('.xterm-screen');
    return {width:screen.getBoundingClientRect().width,measured:parseFloat(screen.style.width),
      first:window.terminal.buffer.active.getLine(0).translateToString(true),
      second:window.terminal.buffer.active.getLine(1).translateToString(true),
      ...window.resizes.at(-1)};
  });
  assert.equal(geometry.first, '████████');
  assert.equal(geometry.second, '████████');
  assert(Math.abs(geometry.width - geometry.measured) <= 1, 'CSS must not stretch the measured xterm screen');
  await page.locator('.sp-agent-node').evaluate(el => {el.style.width='540px';el.style.height='420px';});
  await page.waitForFunction(({cols,rows}) => window.resizes.at(-1).cols < cols && window.resizes.at(-1).rows < rows, geometry);
  await page.locator('.sp-embedded-terminal').click();
  await page.keyboard.type('hello');
  await page.waitForFunction(() => window.writes.join('').includes('hello'));
  // Exercise real wheel events: capture-phase interception used to keep them
  // from reaching xterm even though ordinary typing still worked.
  await page.evaluate(() => window.emitOutput('\x1b[?1049l\x1b[2J\x1b[H' + Array.from({length:150},(_,i)=>`History ${i}\r\n`).join('')));
  await page.waitForFunction(() => window.terminal.buffer.active.baseY > 50);
  await page.locator('.xterm-screen').hover();
  await page.mouse.wheel(0, -360);
  await page.waitForFunction(() => window.terminal.buffer.active.viewportY < window.terminal.buffer.active.baseY);
  await page.mouse.wheel(0, 720);
  await page.waitForFunction(() => window.terminal.buffer.active.viewportY === window.terminal.buffer.active.baseY);
  await page.evaluate(() => {window.writes=[];window.emitOutput('\x1b[?1049h\x1b[?1000h\x1b[?1006h');});
  await page.waitForFunction(() => window.terminal.buffer.active.type === 'alternate');
  await page.mouse.wheel(0, -120);
  await page.waitForFunction(() => window.writes.some(text => /\x1b\[<64;\d+;\d+M/.test(text)));
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => window.writes.some(text => /\x1b\[<65;\d+;\d+M/.test(text)));
  await page.locator('.xterm-screen').click({position:{x:80,y:40}});
  await page.waitForFunction(() => window.writes.some(text => /\x1b\[<0;\d+;\d+M/.test(text)));
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Control+c');
  await page.waitForFunction(() => window.writes.includes('\x1b[A') && window.writes.includes('\x03'));
  assert.deepEqual(await page.evaluate(() => window.canvasKeys), [], 'Terminal keys must not trigger canvas shortcuts');
  assert.deepEqual(await page.evaluate(() => window.flow.getViewport()), viewport, 'Terminal scrolling must not pan or zoom the canvas');
  await page.evaluate(() => window.emitOutput('\x1b[?1000l\x1b[?1006l\x1b[?1049l'));
  await page.evaluate(() => {
    window.emitOutput('\x1b[?1049h\x1b[2J\x1b[HPERSISTENT HEADER');
    // Background TUI traffic must not erase the live screen when replay rolls over.
    for(let i=0;i<240;i++) window.emitOutput('\x1b]0;'+String(i).padEnd(1000,'x')+'\x07');
    window.emitOutput('\x1b[3;1HIncremental update complete');
  });
  await page.waitForFunction(() => window.terminal.buffer.active.getLine(2)?.translateToString(true).includes('Incremental update complete'));
  assert.equal(await page.evaluate(() => window.terminal.buffer.active.type), 'alternate');
  assert.equal(await page.evaluate(() => window.terminal.buffer.active.getLine(0).translateToString(true)), 'PERSISTENT HEADER');
  assert.equal(await page.evaluate(() => window.resets), 0, 'Rolling history must never reset a live emulator');
  if (process.env.CONTEXTGIT_TERMINAL_SCREENSHOT) await page.screenshot({path:process.env.CONTEXTGIT_TERMINAL_SCREENSHOT});
  assert.deepEqual(errors, []);
  console.log('PASS: scrollback, TUI wheel/click input, keyboard isolation inside ReactFlow, resizing, ANSI replies, and alternate-screen state after 240KB of output.');
} finally {
  await browser?.close();
  await server.close();
}
