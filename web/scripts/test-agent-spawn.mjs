import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const { chromium } = createRequire(import.meta.url)("playwright");
const html = `<html><body><div id="root"></div><script type="module">
import React from 'react';import {createRoot} from 'react-dom/client';
import SpatialShell from '/src/shell/spatial/SpatialShell.tsx';import '/src/shell.css';
window.requests=[];window.started=[];window.imports=[];window.failAt=0;
const workspace={path:'/test/project',name:'Test Project'};
window.shared={workspace,projects:[workspace],sessions:[{id:'saved-claude',name:'Saved Claude',agent:'claude',project_path:workspace.path,status:'running',skills:[],scope:[]}],activeId:null,refresh:async()=>{},
addSession:session=>window.shared.sessions.push(session),openSession:()=>{},setActiveId:()=>{},setKickoff:()=>{},choose:async()=>{}};
window.apiStub={teams:async()=>window.shared.sessions.length?[{team:{id:'ungrouped',name:'Ungrouped runs',project_path:workspace.path,state:'running'},layout:{x:40,y:60,width:1400,height:800,z_index:0,collapsed:false},skills:[],plan:null,tasks:window.shared.sessions.map(session=>({id:'task-'+session.id,session_id:session.id,title:session.name,role:'worker',status:'working',scope:[]}))}]:[],canvasViewport:async()=>({x:0,y:0,zoom:1}),saveCanvasViewport:async()=>{},
importCanvasSessions:async path=>{window.imports.push(path);return[];},
createSession:async input=>{window.requests.push(input);if(window.failAt===window.requests.length)throw Error('Creation failed');return {...input,id:'s'+window.requests.length,status:'running',skills:[],scope:[]};}};
createRoot(document.getElementById('root')).render(React.createElement(SpatialShell));
</script></body></html>`;
const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  plugins: [{ name: "agent-spawn-fixture", enforce: "pre",
    load(id) {
      if (id.endsWith('/shared/api.ts')) return 'export const projectApi=()=>window.apiStub;';
      if (id.endsWith('/shell/useWorkbenchState.ts')) return 'export const useWorkbenchState=()=>window.shared;';
      if (id.endsWith('/terminal/runtime.ts')) return `const snapshot={state:'running',tail:''};export const terminalRuntime={ensure:async session=>{if(!window.started.some(s=>s.id===session.id))window.started.push(session);},snapshot:()=>snapshot,session:()=>undefined,resize:()=>{},subscribe:()=>()=>{},subscribeOutput:()=>()=>{},send:async()=>{}};`;
    },
    configureServer(server) {
      server.middlewares.use('/__spawn-test', async (_req,res)=>{
        res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__spawn-test',html));
      });
    },
  }],
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,args:['--no-sandbox','--disable-gpu']});
  const page = await browser.newPage({viewport:{width:1100,height:850}});
  page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__spawn-test`);
  await page.locator('.sp-agent-node').waitFor();
  assert.equal(await page.evaluate(()=>window.started.length),0,'Loading a saved running Claude must not launch it');
  await page.getByRole('button',{name:'New agent',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Run configuration'});
  assert.equal(await dialog.locator('textarea').count(),0,'Spawn dialog must not contain the removed command bar');
  await page.getByLabel('Number of agents').fill('99');
  assert.equal(await page.getByLabel('Number of agents').inputValue(),'12');
  assert(await page.getByRole('button',{name:'More agents'}).isDisabled());
  await page.getByLabel('Number of agents').fill('0');
  assert.equal(await page.getByLabel('Number of agents').inputValue(),'1');
  assert(await page.getByRole('button',{name:'Fewer agents'}).isDisabled());
  await page.getByLabel('Number of agents').fill('3');
  await page.getByRole('button',{name:'New worktree',exact:true}).click();
  await page.screenshot({path:'/tmp/contextgit-multi-agent-dialog.png'});
  await page.setViewportSize({width:390,height:780});
  assert(await dialog.evaluate(el=>el.getBoundingClientRect().right<=window.innerWidth));
  await page.setViewportSize({width:1100,height:850});
  await page.getByRole('button',{name:'Start 3 agents',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  const requests=await page.evaluate(()=>window.requests);
  assert.equal(requests.length,3);
  assert.equal(new Set(requests.map(r=>r.name)).size,3);
  assert(requests.every(r=>r.worktree && r.baseRef==='HEAD' && !('task' in r)));
  assert(requests.every(r=>r.agent==='codex'),'Default CLI must be Codex and all batch requests must match it');
  assert.equal(await page.evaluate(()=>window.started.length),3);
  await page.locator('.sp-batch').waitFor();
  assert.equal(await page.locator('.sp-batch-head').innerText(),'Batch 01\n3 agents');
  assert.equal(await page.locator('.sp-batch .xterm').count(),3);
  await page.locator('.sp-tabs button').filter({hasText:'Codex · 1'}).click();
  assert.equal(await page.locator('.sp-runtime-host').count(),0,'Selecting an inline session must not mount a competing PTY view');
  assert.equal(await page.locator('.sp-batch .sp-orchestrator').count(),0);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('contextgit:canvas-batches:v1'))[0].sessionIds.length),3);
  await page.screenshot({path:'/tmp/contextgit-batch-terminals.png'});
  // A failed later request must reveal earlier sessions without relaunching them.
  await page.evaluate(()=>{window.failAt=5;});
  await page.getByRole('button',{name:'New agent',exact:true}).click();
  await page.getByRole('button',{name:'Project root',exact:true}).click();
  await page.getByRole('button',{name:'Start 3 agents',exact:true}).click();
  await page.waitForFunction(()=>window.requests.length===5);
  await page.getByRole('alert').filter({hasText:'1 of 3 agents created. Creation failed'}).waitFor();
  assert.equal(await page.evaluate(()=>window.started.length),4);
  assert.equal(await page.evaluate(()=>window.requests.at(-1).worktree),false);
  await page.evaluate(()=>{window.failAt=0;});
  await page.getByLabel('Number of agents').fill('1');
  await page.getByRole('button',{name:'Start agent',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.locator('.sp-agent-node').last().waitFor();
  assert.equal(await page.locator('.sp-agent-node .sp-worker-meta, .sp-agent-node .sp-agent-footer').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: spawn count, prompt-free launches, separate worktree requests, and partial batch failure recovery.');
} finally {await browser?.close();await server.close();}
