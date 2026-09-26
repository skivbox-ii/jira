const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {JSDOM} = require("jsdom");
const jquery = require("jquery");

test("component editor distinguishes absent components from noncanonical names", t => {
  const dom = new JSDOM('<div id="root"></div>', {runScripts:"outside-only"});
  t.after(() => dom.window.close());
  dom.window.scrollTo = () => {};
  const $ = jquery(dom.window);
  const modules = {jquery:$, _ujgESI_grid:{button:()=>$("<button/>"),create:()=>({render(){},dismissPopover(){}})}, _ujgESI_icons:()=>$("<span/>")};
  dom.window.define = (name,deps,factory) => {modules[name]=factory(...deps.map(dep=>modules[dep]));};
  dom.window.eval(fs.readFileSync(path.join(__dirname,"../../ujg-excel-story-importer-modules/rendering.js"),"utf8"));
  modules._ujgESI_rendering.init($("#root"),{});
  modules._ujgESI_rendering.render({rows:[], mappingEditorOpen:true, activeMappingBlock:"modules", componentsLoaded:true,
    componentOptions:[{id:"1",name:"Foo"}], mappingSettings:{moduleComponentMap:{A:" foo ",B:"Missing"}}});
  assert.match($(".ujg-esi-component-warning").text(), /Missing/);
  assert.doesNotMatch($(".ujg-esi-component-warning").text(), /foo/);
  assert.match($(".ujg-esi-component-name-warning").text(), /Foo/);
});
