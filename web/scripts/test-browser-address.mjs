import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../shared/browser.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, URL });
const { browserAddress } = exports;
test("public domains use HTTPS and loopback servers use HTTP", () => {
  assert.equal(browserAddress("example.com"), "https://example.com/");
  assert.equal(browserAddress("www.example.com/path"), "https://www.example.com/path");
  assert.equal(browserAddress("localhost:3000"), "http://localhost:3000/");
  assert.equal(browserAddress("127.0.0.1:5173/app"), "http://127.0.0.1:5173/app");
  assert.equal(browserAddress("[::1]:8080"), "http://[::1]:8080/");
  assert.equal(browserAddress("http://example.com/path?q=1"), "http://example.com/path?q=1");
});
test("searches are encoded without treating words as hostnames", () => {
  assert.equal(browserAddress("hello world"), "https://duckduckgo.com/?q=hello%20world");
  assert.equal(browserAddress("typescript"), "https://duckduckgo.com/?q=typescript");
});
test("non-web protocols are rejected", () => {
  for (const value of ["", "javascript:alert(1)", "javascript:123", "data:text/html,hello", "file:///etc/passwd", "chrome://localhost", "ftp://example.com"]) assert.throws(() => browserAddress(value));
});
