const test = require("node:test");
const assert = require("node:assert/strict");
const {spawnSync} = require("node:child_process");
const path = require("node:path");

for (const timezone of ["UTC", "Europe/Moscow"]) {
  for (const date1904 of [false, true]) {
    test(`real deadline workbook retains its calendar date in ${timezone}, epoch1904=${date1904}`, () => {
      const code = `
        const assert=require('node:assert/strict'), path=require('node:path'), XLSX=require('xlsx');
        const load=require('./tests/helpers/load-amd-module');
        const dir='./ujg-excel-story-importer-modules';
        const config=load(path.join(dir,'config.js'),{});
        const loader=load(path.join(dir,'excel-loader.js'),{_ujgESI_config:config},{XLSX});
        const parser=load(path.join(dir,'parser.js'),{_ujgESI_config:config},{XLSX});
        const resolve=load(path.join(dir,'deadlines.js'),{}).resolve;
        (async()=>{
          for(const custom of [false,true]) {
            const name=custom?'Мой срок':'Срок', serial=46290-${date1904 ? 1462 : 0};
            const sheet=XLSX.utils.aoa_to_sheet([['Замечание',name,name,'Дата'],['Ошибка',serial,serial,serial]]);
            for(const cell of ['B2','C2','D2']) sheet[cell].z='dd/mm/yyyy';
            const workbook={SheetNames:['Журнал'],Sheets:{Журнал:sheet},Workbook:{WBProps:{date1904:${date1904}}}};
            const buffer=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});
            const loaded=await loader.readWorkbookFromBuffer(buffer);
            const options={columnMap:{deadline:name}}, row=parser.parseWorkbook(loaded,options).rows[0];
            const due=resolve(row,options);
            assert.equal(due.problem,null,JSON.stringify(row.sourceColumns));
            assert.equal(due.date,'2026-09-25',JSON.stringify(row.sourceColumns));
            assert.equal(row.sourceColumns['Дата'],'25/09/2026','Other Excel display dates stay unchanged');
          }
        })().catch(error=>{console.error(error);process.exitCode=1;});
      `;
      const result = spawnSync(process.execPath, ["-e", code], {
        cwd:path.join(__dirname,"../.."), env:{...process.env,TZ:timezone}, encoding:"utf8"
      });
      assert.equal(result.status,0,result.stderr || result.stdout);
    });
  }
}
