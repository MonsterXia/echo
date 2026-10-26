const assert = require('node:assert/strict')
const { test } = require('node:test')
const { JSDOM } = require('jsdom')
const { transformSync } = require('esbuild')
const fs = require('node:fs'), vm = require('node:vm')
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/?page=update' })
global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client')

test('update view ignores stale initial state, supports keyboard action and unsubscribes on unmount',async()=>{
  let receive, initial, unsubscribed=0
  const actions=[]
  const module={exports:{}}
  vm.runInNewContext(transformSync(fs.readFileSync('src/renderer/update/App.tsx','utf8'),{loader:'tsx',jsx:'automatic',format:'cjs'}).code,{
    module,exports:module.exports,PRODUCT_NAME:'Scrcpy Harmony',VERSION:'1.0.4-dev.0',
    main:{on:(_event,cb)=>{receive=cb;return()=>unsubscribed++},getUpdateState:()=>new Promise(resolve=>initial=resolve),updateAction:async value=>actions.push(value)},
    require(id){
      if(id==='common/util')return{t:key=>key}
      if(id.endsWith('.png'))return 'icon.png'
      if(id.endsWith('.scss'))return {panel:'panel',checking:'checking',result:'result'}
      return require(id)
    },
  })
  const root=createRoot(document.getElementById('root'))
  await act(async()=>root.render(React.createElement(module.exports.default)))
  assert.ok(document.querySelector('[role=progressbar]'))
  await act(async()=>receive({status:'available',productName:'Scrcpy Harmony',currentVersion:'1.0.4-dev.0',latestVersion:'2.0.0'}))
  await act(async()=>initial({status:'checking',productName:'Scrcpy Harmony',currentVersion:'1.0.4-dev.0'}))
  assert.equal(document.querySelector('h1').textContent,'updateFoundTitle')
  await act(async()=>document.querySelector('[role=dialog]').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})))
  assert.deepEqual(actions,['openRelease'])
  await act(async()=>root.unmount())
  assert.equal(unsubscribed,1)
})
