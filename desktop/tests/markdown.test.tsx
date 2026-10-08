import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import Markdown from "../src/shell/chat/Markdown";

const render = (text: string, tail?: Parameters<typeof Markdown>[0]["tail"]) =>
  renderToStaticMarkup(<Markdown text={text} tail={tail} />);

test("headings, emphasis and paragraphs render instead of showing syntax", () => {
  const html = render("# Creating a PDF\n\nThe **OpenCode AI harness** is **flexible**.\nUse *care*.");
  assert.match(html, /<h1>Creating a PDF<\/h1>/);
  assert.match(html, /<strong>OpenCode AI harness<\/strong>/);
  assert.match(html, /<em>care<\/em>/);
  assert.ok(!html.includes("# Creating"));
  assert.ok(!html.includes("**"));
});

test("`#word` without a space is prose, not a heading", () => {
  const html = render("#Heading stays text");
  assert.ok(!html.includes("<h1"));
  assert.match(html, /#Heading stays text/);
});

test("soft line breaks are kept", () => {
  const html = render("first line\nsecond line");
  assert.match(html, /first line<br\/>second line/);
});

test("code fences become blocks and lose their backticks", () => {
  const html = render("Run:\n\n```bash\npip install reportlab\n```");
  assert.match(html, /<pre><code class="language-bash">pip install reportlab<\/code><\/pre>/);
  assert.ok(!html.includes("```"));
});

test("an unterminated fence mid-stream still renders as code", () => {
  const html = render("```js\nconst a = 1;");
  assert.match(html, /<pre><code class="language-js">const a = 1;<\/code><\/pre>/);
});

test("inline code is not parsed as emphasis", () => {
  const html = render("Use `a_b_c` and `*x*` here");
  assert.match(html, /<code>a_b_c<\/code>/);
  assert.match(html, /<code>\*x\*<\/code>/);
  assert.ok(!html.includes("<em>"));
});

test("lists render as real lists", () => {
  const html = render("- one\n- two\n\n1. first\n2. second");
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.ok(!html.includes("\n- "));
});

test("pipe tables render with a head and rows", () => {
  const html = render("| Item | Price |\n| --- | --- |\n| Widget | $5 |");
  assert.match(html, /<table>/);
  assert.match(html, /<th>Item<\/th><th>Price<\/th>/);
  assert.match(html, /<td>Widget<\/td><td>\$5<\/td>/);
});

test("links open safely; non-http schemes stay inert text", () => {
  const good = render("See [docs](https://example.com/x).");
  assert.match(good, /<a href="https:\/\/example.com\/x" target="_blank" rel="noreferrer noopener">docs<\/a>/);
  assert.ok(!good.includes('href="https://example.com/x)."'));

  const bad = render("[click](javascript:alert(1))");
  assert.ok(!bad.includes('href="javascript'));
  assert.match(bad, /<span>click<\/span>/);
});

test("model output cannot inject markup", () => {
  const html = render('<script>alert(1)</script> and <img src=x onerror=alert(1)>');
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("the streaming caret rides on the last block", () => {
  const caret = <span className="cg-caret" />;
  const html = render("Hello **wor", caret);
  assert.match(html, /Hello \*\*wor<span class="cg-caret"><\/span><\/p>/);
});
