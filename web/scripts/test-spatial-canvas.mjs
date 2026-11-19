import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const html = `<html><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client';
import SpatialShell from '/src/shell/spatial/SpatialShell.tsx'; import '/src/shell.css';
const project='/test/project-one'; const sessions=[];
window.teams=[0,1].map(i=>({team:{id:'team-'+i,name:i?'Team Beta':'Team Alpha',state:'running',goal:'Build the project',project_path:project,orchestrator_agent:'shell'},layout:{team_id:'team-'+i,x:i*1060+80,y:80,width:960,height:620,collapsed:false,z_index:0},plan:null,skills:[],tasks:Array.from({length:12},(_,j)=>{const id='worker-'+i+'-'+j; sessions.push({id,name:id,agent:'shell',project_path:project,status:'running',role:'worker',scope:[],skills:[]});return {id:'task-'+i+'-'+j,session_id:id,title:'Worker '+j,agent:'shell',role:'worker',status:'working',scope:[],brief:'Implement feature'};})}));
window.starts=[];window.kills=[];window.layouts=[];window.messages=[];
window.contextgit={harnessCheck:async()=>({installed:true}),ptyStart:async o=>window.starts.push(o),ptyKill:id=>window.kills.push(id),ptyWrite:(id,text)=>window.messages.push({id,text}),ptyResize:()=>{},onPtyData:cb=>{window.emitOutput=cb;return()=>{};},onPtyExit:()=>()=>{},voiceModelStatus:async()=>({modelReady:true,sidecarReady:true,modelBytes:147951465,version:'test'}),onVoiceProgress:()=>()=>{},voiceCancel:async()=>{},filesList:async()=>[{name:'README.md',path:'README.md',kind:'file'}],filePreview:async(_p,path)=>({path,kind:'markdown',size:20,version:'1',content:'# Preview title\\nRead only file preview'})};
window.shared={sessions,projects:[{path:project,name:'Project One'},{path:'/test/project-two',name:'Project Two'}],openSession:()=>{},refresh:async()=>{},setKickoff:()=>{},choose:async()=>{}};
window.apiStub={teams:async path=>path===project?window.teams:[],canvasViewport:async()=>({x:0,y:0,zoom:.55}),saveCanvasViewport:async()=>({}),importCanvasSessions:async()=>[],updateSession:async()=>{},appendTerminalTranscript:async()=>{},staging:async()=>[],updateTeamLayout:async(id,layout)=>{window.layouts.push({id,layout});window.teams.find(t=>t.team.id===id).layout=layout;return layout;},pauseSpatialTeam:async id=>{window.teams.find(t=>t.team.id===id).team.state='paused';},resumeSpatialTeam:async id=>{window.teams.find(t=>t.team.id===id).team.state='running';},librarySkills:async()=>[],attachTeamSkill:async(id,skill)=>{const value={...skill,id:'skill-link'};window.teams.find(t=>t.team.id===id).skills.push(value);return value;},detachTeamSkill:async(id)=>{window.teams.find(t=>t.team.id===id).skills=[];},projectMemory:async()=>({text:'Project memory'})};
Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{throw new DOMException('Denied','NotAllowedError');}},configurable:true});
// Real HTTP responses have fresh object identities, including after layout writes.
window.apiStub.teams=async path=>path===project?structuredClone(window.teams):[];
createRoot(document.getElementById('root')).render(React.createElement(SpatialShell));
</script></body></html>`;
const server = await createServer({
  root,
  // Include lazy terminal dependencies so their first click cannot trigger a
  // dependency-optimizer page reload in the middle of a pointer assertion.
  optimizeDeps: {
    include: [
      "react-icons/bs",
      "react-icons/si",
      "@xterm/xterm",
      "@xterm/addon-fit",
    ],
  },
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  plugins: [
    {
      name: "spatial-test",
      enforce: "pre",
      load(id) {
        if (id.endsWith("/shared/api.ts"))
          return "export const projectApi=()=>window.apiStub;";
        if (id.endsWith("/shell/useWorkbenchState.ts"))
          return `import {useState} from 'react';export function useWorkbenchState(){const[path,setPath]=useState('/test/project-one');return {...window.shared,workspace:{path,name:path.endsWith('one')?'Project One':'Project Two'},activePath:path,useProject:async p=>setPath(p)};}`;
      },
      configureServer(server) {
        server.middlewares.use("/__spatial-test", async (_req, res) => {
          res.setHeader("Content-Type", "text/html");
          res.end(await server.transformIndexHtml("/__spatial-test", html));
        });
      },
    },
  ],
});
let browser;
try {
  await server.listen();
  const cached =
    "/home/abdullah/.cache/ms-playwright/chromium-1140/chrome-linux/chrome";
  browser = await chromium.launch({
    headless: true,
    executablePath: existsSync(cached) ? cached : undefined,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("Browser error:", error.message);
  });
  await page.goto(
    `http://127.0.0.1:${server.httpServer.address().port}/__spatial-test`,
  );
  await page.waitForFunction(() => window.starts?.length === 24);
  assert.equal(await page.locator(".sp-team").count(), 2);
  assert.equal(await page.locator(".sp-worker").count(), 24);
  assert.equal(
    await page.locator(".xterm").count(),
    0,
    "No full terminals should mount for cards",
  );
  await page.locator(".react-flow__controls-fitview").click();
  const elapsed = await page.evaluate(async () => {
    const start = performance.now();
    for (let i = 0; i < 240; i++) {
      const run = window.starts[i % 24];
      window.emitOutput(run.id, "agent streaming output " + i + "\r\n");
    }
    await new Promise(requestAnimationFrame);
    return performance.now() - start;
  });
  assert(elapsed < 2000, `Streaming update blocked renderer: ${elapsed}ms`);
  await page.locator(".sp-worker").first().click();
  await page.waitForSelector(".xterm", { timeout: 10000 });
  assert.equal(await page.locator(".xterm").count(), 1);
  await page
    .getByRole("button", { name: "Close terminal preview", exact: true })
    .click();
  assert.equal(await page.locator(".xterm").count(), 0);
  await page
    .getByRole("button", { name: "Collapse team", exact: true })
    .first()
    .click();
  await page.waitForFunction(() =>
    window.layouts.some((entry) => entry.layout.collapsed),
  );
  assert.equal(await page.evaluate(() => window.kills.length), 0);
  await page
    .locator(".sp-project-panel select")
    .selectOption("/test/project-two");
  await page.waitForFunction(
    () => document.querySelectorAll(".sp-team").length === 0,
  );
  await page
    .locator(".sp-project-panel select")
    .selectOption("/test/project-one");
  await page.waitForSelector(".sp-team");
  await page.locator(".react-flow__controls-fitview").click();
  await page.locator(".sp-team-head").first().click();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page.getByRole("button", { name: "built-in", exact: true }).click();
  await page.locator(".sp-skill").first().click();
  await page.waitForFunction(() => window.teams[0].skills.length === 1);
  await page.getByRole("button", { name: "Close skills", exact: true }).click();
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page.getByRole("button", { name: "README.md", exact: false }).click();
  await page.waitForSelector(".sp-file-preview h1");
  assert.equal(await page.locator(".sp-file-preview textarea").count(), 0);
  await page
    .getByRole("button", { name: "Close README.md", exact: true })
    .click();
  await page.getByRole("button", { name: "Close files", exact: true }).click();
  await page.getByRole("button", { name: "Voice input", exact: true }).click();
  await page.waitForSelector(".sp-hold-record:not(:disabled)");
  const holdBox = await page.locator(".sp-hold-record").boundingBox();
  await page.mouse.move(holdBox.x + 20, holdBox.y + 15);
  await page.mouse.down();
  await page
    .getByText("Microphone access was denied.", { exact: false })
    .waitFor();
  await page.mouse.up();
  assert.equal(await page.evaluate(() => window.starts.length), 24);
  assert.equal(await page.evaluate(() => window.kills.length), 0);
  assert.deepEqual(errors, []);
  await page
    .getByRole("button", { name: "Close voice input", exact: true })
    .click();
  await page.getByRole("button", { name: "Expand team", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll(".sp-worker").length === 24,
  );
  await page.locator(".react-flow__controls-fitview").click();
  await page.screenshot({
    path: "/tmp/contextgit-spatial-canvas.png",
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      passed: true,
      teams: 2,
      workers: 24,
      streamingFrameMs: Math.round(elapsed),
      xtermMountedOnlyOnDemand: true,
      screenshot: "/tmp/contextgit-spatial-canvas.png",
    }),
  );
} finally {
  await browser?.close();
  await server.close();
}
