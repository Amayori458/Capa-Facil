const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const page = await browser.newPage();
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    let saved;
    const source = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
    const html = source.replace('/* ============================== BOOT', `
      window.testModels = {
        open(data){ currentUser={usuario:'seller',role:'vendedora',nome:'Vendedora'}; document.querySelectorAll('.screen').forEach(s=>s.hidden=true); openEditor(GABARITOS[0],null,data,null); },
        state(){return layers.map(l=>({...l,_img:undefined,loaded:!!(l._img && l._img.naturalWidth)}));},
        select(){ selectLayer(layers[0].id); },
        async list(){document.querySelectorAll('.screen').forEach(s=>s.hidden=true);document.getElementById('screen-vendedora').hidden=false;document.querySelectorAll('#screen-vendedora .admin-panel').forEach(p=>p.hidden=p.id!=='vendedora-panel-modelos');await renderVendedoraModelos();}
      };
      window.renderCount=0; const originalRender=render; render=function(){window.renderCount++;return originalRender();};
      /* ============================== BOOT`);
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname!=='app.local')return route.abort();
      const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
      if(url.pathname==='/api/me')return json({},401);
      if(url.pathname==='/api/modelos'){
        if(route.request().method()==='POST'){saved=route.request().postDataJSON();return json({modelo:{id:'model-1'}});}
        const model={id:'model-1',nome:'Teste',gabarito_id:'10x15-20',design_json:saved.designJson,criado_em:'2026-10-01'};
        return json(url.search ? {modelo:model} : {modelos:[model]});
      }
      return json({assets:[],pedidos:[],usuarios:[]});
    });
    await page.goto('http://app.local');
    const data=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=80;c.height=80;
      const ctx=c.getContext('2d');ctx.fillStyle='#eb2040';ctx.fillRect(0,0,80,80);
      return {coverMode:'covers',background:{type:'solid',color1:'#ffffff'},layers:[{id:'photo',type:'image',name:'Foto teste',src:c.toDataURL(),natW:80,natH:80,x:30,y:30,w:70,h:70,imgScale:1.4,imgOffsetX:2,imgOffsetY:3,imgRotation:90,flipH:true,flipV:false,adjust:{brightness:110,contrast:105,saturation:90},visible:true,locked:false,opacity:1}]};
    });
    await page.evaluate(data=>window.testModels.open(data),data);
    await page.waitForFunction(()=>window.testModels.state()[0].loaded);
    await page.locator('#btn-save-template').click();
    await page.locator('.modal-box input').fill('Teste com foto');
    await page.locator('.modal-box [data-act=confirm]').click();
    await page.waitForFunction(()=>document.getElementById('toast-msg').textContent.includes('salvo'));
    assert.deepEqual(saved.designJson.layers[0],data.layers[0]);
    assert(!('_img' in saved.designJson.layers[0]));
    await page.reload();
    // Open the persisted model in a fresh document, with no preloaded Image objects.
    await page.evaluate(()=>{currentUser=undefined;});
    await page.evaluate(data=>window.testModels.open(data),{...data,layers:[]});
    await page.evaluate(()=>window.testModels.list());
    const before=await page.evaluate(()=>window.renderCount);
    await page.locator('.modelo-usar').click();
    await page.waitForFunction(()=>window.testModels.state()[0]?.loaded);
    assert(await page.evaluate(()=>window.renderCount)>before+1,'Image load must trigger an additional render');
    const reopened=await page.evaluate(()=>window.testModels.state()[0]);
    assert.equal(reopened.src,data.layers[0].src);
    assert.equal(reopened.imgScale,1.4);
    assert.deepEqual(reopened.adjust,data.layers[0].adjust);
    await page.evaluate(()=>window.testModels.select());
    await page.locator('#p-crop-toggle').click();
    await page.locator('#p-imgzoom').fill('1.8');
    await page.locator('#p-imgzoom').dispatchEvent('input');
    assert.equal((await page.evaluate(()=>window.testModels.state()))[0].imgScale,1.8);
    assert(await page.locator('#p-replace').isVisible());
    delete saved.designJson.layers[0].src;
    await page.evaluate(()=>window.testModels.list());
    await page.locator('.modelo-usar').click();
    assert(await page.locator('#p-replace').isVisible(),'Legacy model selects empty photo for replacement');
    assert.match(await page.locator('#toast-msg').textContent(),/antigo foi salvo sem as fotos/);
    assert.deepEqual(errors,[]);
    console.log('PASS: save preserves photo and all adjustments; reopening after reload restores image; load redraws canvas; crop remains editable; legacy models offer photo replacement; no browser errors.');
  } finally { await browser.close(); }
})().catch(err=>{console.error(err);process.exitCode=1;});
