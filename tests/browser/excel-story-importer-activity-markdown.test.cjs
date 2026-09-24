const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM,ResourceLoader} = require("jsdom");
const jquery = require("jquery");
const marked = require("../../vendor/marked-16.4.2.umd.js");

function setup() {
  const requests = [];
  class NoNetwork extends ResourceLoader {
    fetch(url) { requests.push(url); return null; }
  }
  const dom = new JSDOM("<!doctype html><body></body>", {runScripts:"outside-only", resources:new NoNetwork(), url:"https://app.example.test"});
  const $ = jquery(dom.window), modules = {jquery:$,_ujgESI_marked:marked};
  dom.window.define = (name, deps, factory) => { modules[name] = factory(...deps.map(dep => modules[dep])); };
  dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules/activity-markdown.js"),"utf8"));
  return {dom,$,requests,render:(value,options={}) => modules._ujgESI_activityMarkdown.render(value,options)};
}

test("headings, lists, tables, emphasis and code fences render as readable DOM", t => {
  const x = setup(); t.after(() => x.dom.window.close());
  const root = x.render("# Report\n\n**Ready** and *reviewed*\n\n- first\n- second\n\n| Key | Count |\n| --- | --- |\n| P-1 | 2 |\n\n```mermaid\ngraph TD; P-2-->P-3\n```");
  assert.equal(root.find("h1").text(),"Report");
  assert.equal(root.find("strong").text(),"Ready");
  assert.equal(root.find("em").text(),"reviewed");
  assert.deepEqual(root.find("li").map((_,el) => x.$(el).text()).get(),["first","second"]);
  assert.deepEqual(root.find("tbody td").map((_,el) => x.$(el).text()).get(),["P-1","2"]);
  assert.match(root.find("pre code").text(),/graph TD; P-2-->P-3/);
  assert.equal(root.find("svg,canvas").length,0);
});

test("model HTML and image Markdown remain inert, including remote image URLs", t => {
  const x = setup(); t.after(() => x.dom.window.close());
  const root = x.render('<img src="https://evil.test/a" onerror="alert(1)"> ![proof](https://evil.test/b) <script>alert(2)</script>');
  assert.equal(root.find("img,script,iframe,object,video,source").length,0);
  assert.match(root.text(),/<img src=/);
  assert.match(root.text(),/proof/);
  assert.doesNotMatch(root.text(),/https:\/\/evil\.test\/b/);
  const escaped = x.render("<svg onload=alert(1)> & \"quote\" 'single' <iframe src=//evil.test></iframe>");
  assert.equal(escaped.find("svg,iframe").length,0);
  assert.equal(escaped.text().trimEnd(),"<svg onload=alert(1)> & \"quote\" 'single' <iframe src=//evil.test></iframe>");
});

test("issue keys use only trusted base URL and never decorate code or links", t => {
  const x = setup(); t.after(() => x.dom.window.close());
  const root = x.render("P-12 `P-13` [P-14](https://docs.example.test/p)\n\n```\nP-15\n```", {baseUrl:"https://jira.example.test/jira/?x=1#frag"});
  assert.equal(root.find("a").length,2);
  assert.equal(root.find("a").first().attr("href"),"https://jira.example.test/jira/browse/P-12");
  assert.equal(root.find("a").last().attr("href"),"https://docs.example.test/p");
  assert.equal(root.find("code a, pre a, a a").length,0);
  const unsafe = x.render("P-12", {baseUrl:"https://user:password@jira.example.test"});
  assert.equal(unsafe.find("a").length,0);
  for (const baseUrl of ["javascript:alert(1)","data:text/html,x","//jira.example.test","https://user@jira.example.test"]) {
    assert.equal(x.render("P-12",{baseUrl}).find("a").length,0);
  }
});

test("preview mock issue renders under the report root with the exact Jira link", t => {
  const x = setup(); t.after(() => x.dom.window.close());
  const root = x.render("[QA] EVOSCADA-30041", {baseUrl:"https://jira.example.test"});
  assert.equal(root.hasClass("ujg-esi-activity-markdown"),true);
  assert.equal(root.find('a[href="https://jira.example.test/browse/EVOSCADA-30041"]').length,1);
});

test("unsafe Markdown destinations become text and no resource attributes are created", t => {
  const x = setup(); t.after(() => x.dom.window.close());
  const root = x.render("[js](javascript:alert) [data](data:text/html) [credentials](https://user:pass@evil.test/x) [relative](//evil.test/x) [ok](https://safe.example.test/x)");
  assert.equal(root.find("a").length,1);
  assert.equal(root.find("a").attr("href"),"https://safe.example.test/x");
  assert.equal(root.find("[src],[srcset]").length,0);
  assert.match(root.text(),/js data credentials relative ok/);
});

test("role tags use existing classes and only validated team colors", t => {
  const x = setup(); t.after(() => x.dom.window.close());
  const root = x.render("[BE] [QA] ` [FE] ` [DE](https://safe.example.test) [BF]", {teams:[
    {roles:["BE"],color:"#3973B9"}, {roles:["QA"],color:"url(https://evil.test/x)"}
  ]});
  assert.equal(root.find(".ujg-esi-management-role").length,3);
  assert.equal(root.find(".role-be").css("border-color"),"rgb(57, 115, 185)");
  assert.equal(root.find(".role-qa").attr("style"),undefined);
  assert.equal(root.find("code .ujg-esi-management-role, a .ujg-esi-management-role").length,0);
});

test("GFM escaped pipes inside table code preserve the whole cell and following columns", t => {
  const x = setup(); t.after(() => x.dom.window.close());
  const root = x.render("| Expression | Result |\n| --- | --- |\n| `a\\|b` remainder | retained |");
  assert.equal(root.find("tbody code").text(),"a|b");
  assert.deepEqual(root.find("tbody td").map((_,el) => x.$(el).text()).get(),["a|b remainder","retained"]);
  assert.equal(root.find(".ujg-esi-activity-markdown-table-wrap > table").length,1);
});

test("a fence marker with trailing text cannot close an active code fence", t => {
  const x = setup(); t.after(() => x.dom.window.close());
  const root = x.render("```mermaid\ngraph TD\n``` stray text\nP-12 [BE] <img src=https://evil.test/x>\n```\n\nAfter",{baseUrl:"https://jira.example.test"});
  assert.match(root.find("pre code").text(),/``` stray text\nP-12 \[BE\] <img src=https:\/\/evil.test\/x>/);
  assert.equal(root.find("pre").length,1);
  assert.equal(root.find("p").last().text(),"After");
  assert.equal(root.find("a,img,.ujg-esi-management-role").length,0);
});

test("balanced parentheses in a link destination retain the entire URL", t => {
  const x = setup(); t.after(() => x.dom.window.close());
  const root = x.render("[ok](https://safe.test/a_(b))");
  assert.equal(root.find("a").attr("href"),"https://safe.test/a_(b)");
  assert.equal(root.find("p").text(),"ok");
});

test("escaped emphasis delimiters stay literal while actual emphasis is rendered", t => {
  const x = setup(); t.after(() => x.dom.window.close());
  const root = x.render("\\*literal\\* \\_also literal\\_ \\*\\*literal bold\\*\\* **real bold**");
  assert.equal(root.find("em").length,0);
  assert.equal(root.find("strong").length,1);
  assert.equal(root.find("p").text(),"*literal* _also literal_ **literal bold** real bold");
});

test("Marked HTML, reference images and nested link labels cannot create resource elements", t => {
  const x = setup(); t.after(() => x.dom.window.close());
  const source = [
    '[**P-21** [BE] <img src="https://evil.test/label">](https://safe.test/a_(b)?x=1&y=2)',
    '',
    '![proof][image] ![<img src="https://evil.test/alt">](data:image/png,ignored)',
    '',
    '[image]: https://evil.test/proof.png',
    '',
    '<iframe src="https://evil.test/frame"></iframe>',
    '',
    '<style>@import "https://evil.test/style";</style>',
    '',
    '<script src="https://evil.test/script">alert(1)</script>',
    '',
    '<svg><image href="https://evil.test/svg"/></svg>',
    '',
    '<link rel="stylesheet" href="https://evil.test/css">'
  ].join("\n");
  const root = x.render(source,{baseUrl:"https://jira.example.test"}).appendTo(x.$("body"));
  assert.equal(root.find("img,image,script,style,iframe,object,embed,link,svg,video,audio,source").length,0);
  assert.equal(root.find("[src],[srcset],[onerror],[onload]").length,0);
  assert.equal(root.find("a").length,1);
  assert.equal(root.find("a").attr("href"),"https://safe.test/a_(b)?x=1&y=2");
  assert.equal(root.find("a strong").text(),"P-21");
  assert.equal(root.find("a a,a .ujg-esi-management-role").length,0);
  assert.match(root.text(),/proof/);
  assert.match(root.text(),/<img src="https:\/\/evil.test\/alt">/);
  assert.deepEqual(x.requests,[]);
});

test("encoded schemes, credentials and non-HTTPS links stay inactive in every link form", t => {
  const x = setup(); t.after(() => x.dom.window.close());
  const root = x.render([
    '[encoded](jav&#x61;script:alert(1))',
    '[entity](javascript&#58;alert(1))',
    '[data](data:text/html,ignored)',
    '[plain](http://unsafe.test/x)',
    '[relative](//unsafe.test/x)',
    '[credentials](https://user:pass@unsafe.test/x)',
    '<https://user:pass@unsafe.test/x>',
    '[reference][unsafe]',
    '',
    '[unsafe]: javascript:alert(1)'
  ].join("\n"));
  assert.equal(root.find("a").length,0);
  assert.match(root.text(),/encoded/);
  assert.match(root.text(),/reference/);
});

test("report renderer leaves the shared Marked defaults unchanged", t => {
  const source = '<img src="https://example.test/raw.png">';
  const before = marked.parse(source);
  const x = setup(); t.after(() => x.dom.window.close());
  assert.equal(x.render(source).find("img").length,0);
  assert.equal(marked.parse(source),before);
  assert.match(before,/<img /);
});

for (const [name,source] of [
  ["image",'prefix <pre><img/src=x onerror=alert(1)>'],
  ["iframe",'prefix <pre><iframe/src="//evil.test/frame">']
]) {
  test("raw-block text tokens cannot create an active " + name, t => {
    const x = setup(); t.after(() => x.dom.window.close());
    const root = x.render(source).appendTo(x.$("body"));
    assert.deepEqual(x.requests,[],"Rendering untrusted text must not request resources");
    assert.equal(root.find("pre,img,iframe,[src],[onerror]").length,0);
    assert.equal(root.text().trimEnd(),source);
  });
}

test("raw-block text remains inert inside nested Markdown and other raw HTML contexts", t => {
  const x = setup(); t.after(() => x.dom.window.close());
  for (const source of [
    'prefix <script><img/src=x onerror=alert(1)>',
    'prefix <style><iframe/src="https://evil.test/frame">',
    '**prefix <pre><img/src=x onerror=alert(1)>**',
    '[prefix <pre><img/src=x onerror=alert(1)>](https://safe.test)',
    '- prefix <pre><svg/onload=alert(1)>',
    '> prefix <PRE><iframe/src="https://evil.test/frame">'
  ]) {
    const root = x.render(source).appendTo(x.$("body"));
    assert.equal(root.find("img,iframe,svg,script,style,pre,[src],[onload],[onerror]").length,0,source);
    assert.deepEqual(x.requests,[],source);
    root.remove();
  }
});

test("text escaping decodes entities once while code and raw HTML keep their literal text", t => {
  const x = setup(); t.after(() => x.dom.window.close());
  const root = x.render([
    'A &amp; B &lt;tag&gt; &#60;node&#62; &#x3c;hex&#x3e; &copy; &amp;lt; & unknown',
    '',
    '**&lt;bold&gt; &amp;** [&lt;label&gt; &amp;](https://safe.test)',
    '',
    '`&lt;code&gt; &amp;`',
    '',
    '```\n&lt;fenced&gt; &amp;\n```',
    '',
    'prefix <pre>&lt;img/src=x onerror=alert(1)&gt; &amp;lt; literal <text>'
  ].join("\n"));
  assert.equal(root.find("p").first().text(),'A & B <tag> <node> <hex> \u00a9 &lt; & unknown');
  assert.equal(root.find("strong").text(),'<bold> &');
  assert.equal(root.find("a").text(),'<label> &');
  assert.equal(root.find("p code").text(),'&lt;code&gt; &amp;');
  assert.equal(root.find("pre code").text().trimEnd(),'&lt;fenced&gt; &amp;');
  assert.equal(root.find("p").last().text(),'prefix <pre><img/src=x onerror=alert(1)> &lt; literal <text>');
  assert.equal(root.find("img,text,tag,node,hex,bold,label").length,0);
});

test("loose list items render emphasis and links as semantic HTML", t => {
  const x = setup(); t.after(() => x.dom.window.close());
  const root = x.render('- **done**\n\n- [details](https://safe.test)');
  assert.equal(root.find("ul > li > p > strong").text(),"done");
  assert.equal(root.find("ul > li > p > a").attr("href"),"https://safe.test/");
  assert.deepEqual(root.find("li").map((_,el) => x.$(el).text().trim()).get(),["done","details"]);
  assert.doesNotMatch(root.text(),/<strong>|<a /);
});

for (const [kind,separator] of [["tight","\n"],["loose","\n\n"]]) {
  test(kind + " task lists render disabled checkbox elements with correct state", t => {
    const x = setup(); t.after(() => x.dom.window.close());
    const root = x.render('- [x] **done**' + separator + '- [ ] [details](https://safe.test)');
    const boxes = root.find('input[type="checkbox"]');
    assert.equal(boxes.length,2);
    assert.deepEqual(boxes.map((_,el) => el.checked).get(),[true,false]);
    assert.ok(boxes.toArray().every(el => el.disabled));
    assert.equal(root.find("strong").text(),"done");
    assert.equal(root.find("a").attr("href"),"https://safe.test/");
    assert.doesNotMatch(root.text(),/<input|<strong>|<a /);
  });
}

test("nested loose task lists preserve paragraphs and keep raw-block payloads inert", t => {
  const x = setup(); t.after(() => x.dom.window.close());
  const root = x.render([
    '- [x] **outer** &amp; &lt;tag&gt;',
    '',
    '  another *paragraph*',
    '',
    '  - [ ] prefix <pre><img/src=x onerror=alert(1)>',
    '',
    '  - [x] prefix <pre><iframe/src="//evil.test/frame">',
    '',
    '- [ ] final'
  ].join("\n")).appendTo(x.$("body"));
  assert.equal(root.find("ul ul li").length,2);
  assert.equal(root.find("strong").text(),"outer");
  assert.equal(root.find("em").text(),"paragraph");
  assert.equal(root.find('input[type="checkbox"]:disabled').length,4);
  assert.match(root.find("ul > li > p").first().text(),/outer & <tag>/);
  assert.match(root.text(),/<img\/src=x onerror=alert\(1\)>/);
  assert.match(root.text(),/<iframe\/src="\/\/evil.test\/frame">/);
  assert.equal(root.find("img,iframe,pre,[src],[onerror],tag").length,0);
  assert.deepEqual(x.requests,[]);
});
