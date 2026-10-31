// One-off acceptance against genuine installed binaries (or explicit local dist).
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { _electron } from 'playwright-core'
import semver from 'semver'
const require = createRequire(import.meta.url)
const [executable, version, outputArg, stable = '1.0.4', betaTarget = '1.0.4'] = process.argv.slice(2)
assert.ok(executable && version && outputArg && semver.valid(version) && semver.valid(stable) && semver.valid(betaTarget))
const local = executable === '--local'
const legacy = version === '1.0.3'
const output = path.resolve(outputArg)
await fs.mkdir(output, {recursive:true})
const profile = process.env.RELEASE_PROFILE || await fs.mkdtemp(path.join(os.tmpdir(),'stable-update-'))
const report = {version, platform:process.platform, arch:process.arch, local, scenarios:[], passed:false}
let app, timer
async function startCheck(beta, offline) {
  await app.evaluate(({Menu}, {beta,offline}) => {
    const e = globalThis.releaseEvidence
    e.offline = offline; e.requests=[]; e.external=[]
    const all = menu => menu.items.flatMap(i=>[i,...(i.submenu?all(i.submenu):[])])
    const items = all(Menu.getApplicationMenu())
    const item = items.find(i=>/Check for Updates|检查更新/i.test(i.label))
    if (!item) throw Error('Missing update menu')
    const b = items.find(i=>/Beta Update|接收预发布更新/.test(i.label))
    if (b && b.checked !== beta) b.click()
    if (b && b.checked !== beta) throw Error('Beta menu click did not change state')
    e.betaMenu = b ? {label:b.label, checked:b.checked}:null
    item.click()
  }, {beta,offline})
}
async function check(beta, offline=false, cancel=false) {
  const target = beta ? betaTarget:stable
  const expected = offline?'error':semver.gt(target,version)?'available':'upToDate'
  const newWindow = legacy ? null : app.waitForEvent('window')
  newWindow?.catch(()=>{}) // Preserve the original trigger error without an orphan rejection.
  await startCheck(beta, cancel ? 'hold' : offline)
  const win = legacy ? await app.firstWindow() : await newWindow
  let state, text
  if (cancel) {
    const closed=win.waitForEvent('close')
    await win.getByRole('button', {name:/Cancel|取消/}).click()
    await closed
    report.scenarios.push({beta,cancelled:true})
    return
  }
  if (legacy) {
    const modal=win.locator('.luna-modal:visible')
    await modal.getByText(offline?/Failed to check for updates|检查更新失败/:expected==='available'?/A new version is available|有可用的更新/:/There are currently no updates available|当前没有可用的更新/).waitFor({timeout:60000})
    text=await modal.innerText()
    await modal.screenshot({path:path.join(output,`legacy-${report.scenarios.length}.png`)})
    await modal.locator('.luna-modal-primary').click()
    await modal.waitFor({state:'hidden'})
  } else {
    await win.waitForFunction(()=>window.main?.getUpdateState)
    const deadline=Date.now()+60000
    do {
      state=await win.evaluate(()=>window.main.getUpdateState())
      if(state?.status && state.status!=='checking') break
      await new Promise(resolve=>setTimeout(resolve,100))
    }while(Date.now()<deadline)
    assert.equal(state.currentVersion,version)
    assert.equal(state.status,expected)
    if(!offline) assert.equal(state.latestVersion,target)
    const dialog=win.getByRole('dialog')
    await dialog.waitFor({state:'visible'})
    await win.getByRole('button',{name:expected==='available'?/Open Downloads|打开下载/:/OK|好|确定/}).first().waitFor({state:'visible'})
    text=await dialog.innerText()
    if(!offline) assert.ok(text.includes(target) || (target===version && text.includes(version)))
    await dialog.screenshot({path:path.join(output,`current-${report.scenarios.length}.png`)})
    const closed=win.waitForEvent('close')
    await win.getByRole('button',{name:expected==='available'?/Open Downloads|打开下载/:/OK|好|确定/}).first().click()
    await closed
  }
  if(expected==='available') await app.evaluate(async()=>{
    const until=Date.now()+15000
    while(!globalThis.releaseEvidence.external.some(e=>e.finished)){
      if(Date.now()>until)throw Error('External handoff did not finish')
      await new Promise(r=>setTimeout(r,100))
    }
  })
  const evidence=await app.evaluate(()=>globalThis.releaseEvidence)
  if(offline){
    assert.ok(evidence.requests.some(r=>r.cancelled),'Offline fault was not applied')
    assert.equal(evidence.external.length,0)
  }else{
    const metadata=process.platform==='win32'?'latest.yml':process.arch==='arm64'?'latest-mac.yml':'latest-x64-mac.yml'
    assert.ok(evidence.requests.some(r=>r.url.endsWith(`/download/v${target}/${metadata}`)&&!r.cancelled),'Wrong metadata target')
    assert.ok(evidence.requests.some(r=>r.status===200),'No successful network response')
    assert.ok(!evidence.requests.some(r=>r.url.includes('liriliri')))
    if(expected==='available') {
      const url='https://github.com/MonsterXia/scrcpy-harmony/releases'+(legacy?'':`/tag/v${target}`)
      assert.deepEqual(evidence.external.map(({url,finished,error})=>({url,finished,error})),[{url,finished:true,error:null}])
    } else assert.equal(evidence.external.length,0)
  }
  report.scenarios.push({beta,offline,expected,target,state,text,...evidence})
}
try {
  app=await _electron.launch({executablePath:local?require('electron'):await fs.realpath(executable),
    args:[...(local?[path.resolve('dist/main/index.js')]:[]),`--user-data-dir=${profile}`],timeout:30000})
  timer=setTimeout(()=>app.process().kill(),240000)
  const page=await app.firstWindow()
  await page.waitForFunction(()=>window.main?.getSettingsStore)
  const runtime=await app.evaluate(({app,session,shell})=>{
    globalThis.releaseEvidence={offline:false,requests:[],external:[]}
    const e=globalThis.releaseEvidence
    const safe=v=>{const u=new URL(v);return u.origin+u.pathname}
    const net=session.fromPartition('electron-updater',{cache:false})
    net.webRequest.onBeforeRequest((d,cb)=>{
      e.requests.push({url:safe(d.url),cancelled:Boolean(e.offline)})
      if(e.offline==='hold')setTimeout(()=>cb({cancel:true}),3000)
      else cb({cancel:e.offline})
    })
    net.webRequest.onCompleted(d=>e.requests.push({url:safe(d.url),status:d.statusCode}))
    const original=shell.openExternal.bind(shell)
    shell.openExternal=async url=>{
      const item={url,finished:false,error:null};e.external.push(item)
      try {return await original(url)}catch(err){item.error=err.message;throw err}finally{item.finished=true}
    }
    return {packaged:app.isPackaged,version:app.getVersion(),arch:process.arch,profile:app.getPath('userData'),appPath:app.getAppPath()}
  })
  assert.equal(runtime.packaged,!local)
  if(!local) assert.equal(runtime.version,version)
  assert.equal(runtime.arch,process.arch)
  assert.equal(await fs.realpath(runtime.profile),await fs.realpath(profile))
  report.runtime={packaged:runtime.packaged,version:runtime.version,arch:runtime.arch,
    sha256:createHash('sha256').update(await fs.readFile(local?'dist/main/index.js':runtime.appPath)).digest('hex')}
  // Reuse an explicitly provided disposable profile across installer replacements.
  if(process.env.RELEASE_PROFILE_EXPECT==='preserved'){
    assert.equal(await page.evaluate(()=>window.main.getSettingsStore('language')),'en-US')
    assert.equal(await page.evaluate(()=>window.main.getSettingsStore('theme')),'dark')
    report.settingsPreserved=true
  }
  await page.evaluate(async()=>{await window.main.setSettingsStore('language','en-US');await window.main.setSettingsStore('theme','dark')})
  await check(false)
  await check(false,true)
  await check(false)
  if(!legacy){await check(true);await check(true,true,true);await check(true)}
  assert.equal(app.process().exitCode,null)
  await app.close();app=null
  report.passed=true
}catch(error){report.error=error.stack;console.error(error);throw error}
finally{
  if(app)await app.close().catch(()=>app.process().kill())
  clearTimeout(timer)
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n')
}
console.log(JSON.stringify({version,passed:report.passed,scenarios:report.scenarios.length}))
