import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { posix } from 'node:path';

function renderer(status, nativeEvents) {
  let nativeStatus = status;
  const requests = [];
  const commands = [];
  let workspace = null;
  let revision = 0;
  const window = {
    __TAURI__: {
      core: { invoke: async (command, args) => {
        commands.push(command);
        if (command === 'pty_start') return nativeEvents?.start(args.options);
        if (command === 'use_project') return workspace = { path: args.path, name: args.path.split('/').at(-1), revision: ++revision };
        if (command === 'get_workspace') return workspace;
        return nativeStatus;
      } },
      event: { listen: nativeEvents?.listen ?? (async () => () => {}) },
    },
    setTimeout,
    clearTimeout,
  };
  const context = createContext({
    window, URL, AbortController, AbortSignal, setTimeout, clearTimeout,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith('/projects/open')) {
        const { path } = JSON.parse(options.body);
        return new Response(JSON.stringify({ path, projectId: path, repoId: path }));
      }
      return new Response(JSON.stringify(options.method === 'POST' ? { id: 'test-session' } : []));
    },
  });
  const modules = new Map();
  function load(path) {
    if (modules.has(path)) return modules.get(path);
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    const evaluate = runInContext(`(function(exports, require, module) { ${compiled}\n })`, context);
    evaluate(module.exports, name => load(posix.normalize(posix.join(posix.dirname(path), `${name}.ts`))), module);
    modules.set(path, module.exports);
    return module.exports;
  }
  load('../src/tauri-bridge.ts').installTauriBridge();
  const apiModule = load('../shared/api.ts');
  return { window, requests, commands, request: load('../shared/apiRequest.ts').apiRequest, api: apiModule.api, projectApi: apiModule.projectApi, runtime: load('../shared/projectRuntime.ts').projectRuntime, setStatus: value => { nativeStatus = value; } };
}

test('renderer session reads and creation use the native ready address', async () => {
  const app = renderer({ state: 'ready', apiBase: 'http://127.0.0.1:42929' });
  await app.window.contextgit.refreshBackendStatus();
  await app.api.sessions();
  await app.api.createSession({ name: 'check', kind: 'terminal', agent: 'claude' });
  assert.deepEqual(app.requests.map(request => request.url), [
    'http://127.0.0.1:42929/api/v1/sessions',
    'http://127.0.0.1:42929/api/v1/sessions',
  ]);
  assert.equal(app.requests[1].options.method, 'POST');
  assert.equal(app.requests[1].options.headers.Authorization, 'Bearer tauri-local-token');
});

test('PTY launch waits for event registration and receives immediate output and exit', async () => {
  const handlers = new Map();
  let register;
  const registered = new Promise(resolve => { register = resolve; });
  let starts = 0;
  const app = renderer({ state: 'ready', apiBase: 'http://127.0.0.1:42929' }, {
    listen: async (name, handler) => {
      await registered;
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
    start: options => {
      starts++;
      handlers.get('pty-data')({ payload: { id: options.id, data: 'prompt' } });
      handlers.get('pty-exit')({ payload: { id: options.id, code: 0 } });
    },
  });
  const received = [];
  app.window.contextgit.onPtyData((id, data) => received.push([id, data]));
  app.window.contextgit.onPtyExit((id, code) => received.push([id, code]));
  const launch = app.window.contextgit.ptyStart({ id: 'pty-test', command: 'shell', cols: 80, rows: 24 });
  await Promise.resolve();
  assert.equal(starts, 0);
  register();
  await launch;
  assert.deepEqual(received, [['pty-test', 'prompt'], ['pty-test', 0]]);
});

test('unchanged health notifications do not discard pending session reads', async () => {
  const source = readFileSync(new URL('../src/shell/pollingTask.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  runInContext(`(function(exports) { ${compiled}\n })`, createContext({}))(module.exports);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let accepted = false;
  const poll = new module.exports.PollingTask(async current => {
    await pending;
    accepted = current();
  });
  poll.setAvailable(true);
  const read = poll.tick();
  await Promise.resolve();
  poll.setAvailable(true);
  release();
  await read;
  assert.equal(accepted, true);
});

test('project switches keep the backend address and bind background requests to their owner', async () => {
  const app = renderer({ state: 'ready', apiBase: 'http://127.0.0.1:42929' });
  await app.window.contextgit.refreshBackendStatus();
  await app.window.contextgit.useProject('/test/a');
  const background = app.projectApi('/test/a');
  await app.window.contextgit.useProject('/test/b');
  await app.api.createSession({ name: 'check', kind: 'terminal', agent: 'shell' });
  await background.appendTerminalTranscript('a-session', 'output');
  assert.equal(app.window.contextgit.apiBase, 'http://127.0.0.1:42929');
  assert.equal(app.commands.includes('restart_backend'), false);
  const create = app.requests.find(request => request.url.endsWith('/sessions'));
  assert.equal(create.options.headers['X-ContextGit-Project'], '/test/b');
  assert.equal(app.requests.at(-1).options.headers['X-ContextGit-Project'], '/test/a');
  for (let index = 0; index < 30; index++) {
    await app.window.contextgit.useProject(index % 2 ? '/test/a' : '/test/b');
  }
  assert.equal(app.commands.includes('restart_backend'), false);
});

test('failed agent creation is never automatically repeated', async () => {
  const app = renderer({ state: 'ready', apiBase: 'http://127.0.0.1:42929' });
  let attempts = 0;
  await assert.rejects(app.request('http://127.0.0.1:42929/api/v1/sessions', { method: 'POST' }, async () => {
    attempts++;
    throw new TypeError('network lost after send');
  }), /may have completed/);
  assert.equal(attempts, 1);
});
