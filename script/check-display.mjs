import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { build as bundle } from 'esbuild'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { _electron as electron } from 'playwright-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const output = path.resolve(
  process.argv[2] || path.join(root, 'dist/display-evidence'),
)
await fs.mkdir(output, { recursive: true })
await build({
  configFile: false,
  root: path.join(root, 'test/fixtures/display'),
  base: './',
  plugins: [
    react(),
    {
      name: 'synthetic-device-boundary',
      load(id) {
        if (id.replaceAll('\\', '/').endsWith('/screencast/store.ts'))
          return 'export default (globalThis.displayStore = {})'
        if (id.replaceAll('\\', '/').endsWith('/renderer/lib/util.ts'))
          return 'export async function installBundles() { throw new Error("Device operations forbidden in display fixture") }'
      },
    },
  ],
  resolve: {
    alias: {
      share: path.join(root, 'src/share'),
      common: path.join(root, 'src/common'),
    },
  },
  css: {
    modules: { localsConvention: 'camelCaseOnly' },
    preprocessorOptions: { scss: { api: 'modern' } },
  },
  build: {
    outDir: path.join(root, 'dist/display/renderer'),
    emptyOutDir: true,
  },
})
await bundle({
  entryPoints: [path.join(root, 'src/main/window/screencast.ts')],
  outfile: path.join(root, 'dist/display/main/index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'custom-electron-titlebar/main'],
  alias: {
    share: path.join(root, 'src/share'),
    common: path.join(root, 'src/common'),
  },
  define: { 'import.meta.env.MODE': '"production"' },
  plugins: [
    {
      name: 'no-device-or-user-settings',
      setup(b) {
        b.onLoad({ filter: /main[/\\]lib[/\\]store\.ts$/ }, () => ({
          contents:
            'const store = { get: (key) => key === "screencast" ? global.displayWindowData : undefined, set() {} }; export const getWindowStore = () => store; export const getScreencastStore = () => store;',
        }))
        b.onLoad({ filter: /share[/\\]main[/\\]lib[/\\]util\.ts$/ }, () => ({
          contents:
            'export const getTheme = () => false; export const handleEvent = () => {}',
        }))
        b.onLoad({ filter: /share[/\\]common[/\\]log\.ts$/ }, () => ({
          contents: 'export default () => ({ info() {}, debug() {} })',
        }))
      },
    },
  ],
})

const sourceFiles = [
  'src/main/window/screencast.ts',
  'src/renderer/screencast/components/Toolbar.module.scss',
  'src/renderer/screencast/components/Screencast.module.scss',
  'src/renderer/screencast/lib/ScreencastClient.ts',
  'script/check-display.mjs',
]
const sourceHashes = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (file) => [
      file,
      createHash('sha256')
        .update(await fs.readFile(path.join(root, file)))
        .digest('hex'),
    ]),
  ),
)
const report = {
  boundary:
    'Real Electron BrowserWindow, shared window factory, screencast showWin, components, CSS, client/JPEG decoder. Simulated screen.workArea and HDC transport; titlebar HTML reserves 31px, not actual titlebar interaction. Runtime display metrics already reflect force-device-scale-factor and do not describe a physical DPI change. No Windows display configuration changed.',
  host: {
    platform: process.platform,
    osVersion: os.version(),
    node: process.version,
  },
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  sourceHashes,
  cases: [],
}
for (const pixels of [
  [800, 600],
  [1024, 768],
]) {
  for (const dsf of [1, 1.25, 1.5]) {
    for (const restored of pixels[0] === 800 && dsf === 1.5
      ? [false, true]
      : [false]) {
      const userData = await fs.mkdtemp(
        path.join(os.tmpdir(), 'harmony-display-'),
      )
      const id = `${pixels.join('x')}-${dsf}${restored ? '-restored' : ''}`
      const area = {
        x: 20,
        y: 20,
        width: Math.floor(pixels[0] / dsf),
        height: Math.floor(pixels[1] / dsf),
      }
      const saved = restored
        ? { bounds: { x: -1000, y: -700, width: 1200, height: 900 } }
        : {}
      const env = {
        ...process.env,
        DISPLAY_USER_DATA: userData,
        DISPLAY_DSF: String(dsf),
        DISPLAY_WORK_AREA: JSON.stringify(area),
        DISPLAY_SAVED_BOUNDS: JSON.stringify(saved),
      }
      delete env.ELECTRON_RUN_AS_NODE
      const application = await electron.launch({
        executablePath: require('electron'),
        args: [path.join(root, 'test/fixtures/display/main.cjs')],
        env,
      })
      try {
        const page = await application.firstWindow()
        await page.waitForFunction(() => window.displayTest)
        const evidence = await application.evaluate(({ BrowserWindow }) => ({
          ...global.displayEvidence,
          initial: BrowserWindow.getAllWindows()[0].getBounds(),
          minimum: BrowserWindow.getAllWindows()[0].getMinimumSize(),
          versions: process.versions,
        }))
        const samples = []
        const sizes = restored
          ? [['initial', null]]
          : [
              ['initial', null],
              ['minimum', [320, 320]],
              ['compact-edge', [480, 360]],
              ['wide-edge', [481, 360]],
            ]
        for (const [size, requested] of sizes) {
          if (requested)
            await application.evaluate(
              ({ BrowserWindow }, [w, h]) =>
                BrowserWindow.getAllWindows()[0].setSize(w, h),
              requested,
            )
          for (const [width, height] of [
            [1080, 2400],
            [1920, 1080],
          ]) {
            for (const scale of [1, 0.5]) {
              await page.evaluate(
                ([w, h, s]) => window.displayTest.frame(w, h, s),
                [width, height, scale],
              )
              await page.locator('canvas').waitFor()
              await page.evaluate(() => document.fonts.ready)
              const metrics = await page.evaluate(() => {
                const canvas = document.querySelector('canvas')
                const toolbar = document.querySelector('.luna-toolbar')
                const rect = (el) => {
                  const r = el.getBoundingClientRect()
                  return {
                    x: r.x,
                    y: r.y,
                    width: r.width,
                    height: r.height,
                    right: r.right,
                    bottom: r.bottom,
                  }
                }
                return {
                  viewport: [innerWidth, innerHeight],
                  dpr: devicePixelRatio,
                  canvas: rect(canvas),
                  bitmap: [canvas.width, canvas.height],
                  toolbar: rect(toolbar),
                  toolbarScroll: [toolbar.clientWidth, toolbar.scrollWidth],
                  controls: [...toolbar.querySelectorAll('button,select')].map(
                    rect,
                  ),
                  font: getComputedStyle(toolbar).fontFamily,
                  smoothing: canvas.getContext('2d').imageSmoothingEnabled,
                }
              })
              const bounds = await application.evaluate(({ BrowserWindow }) =>
                BrowserWindow.getAllWindows()[0].getBounds(),
              )
              const pointers = await page.evaluate(() => {
                const canvas = document.querySelector('canvas')
                const r = canvas.getBoundingClientRect()
                window.displayTest.calls.length = 0
                for (const [x, y] of [
                  [0, 0],
                  [1, 0],
                  [0, 1],
                  [1, 1],
                  [0.5, 0.5],
                ]) {
                  canvas.dispatchEvent(
                    new PointerEvent('pointerdown', {
                      clientX: r.x + r.width * x,
                      clientY: r.y + r.height * y,
                    }),
                  )
                  canvas.dispatchEvent(
                    new PointerEvent('pointerup', {
                      clientX: r.x + r.width * x,
                      clientY: r.y + r.height * y,
                    }),
                  )
                }
                return window.displayTest.calls.map((args) => args.slice(1))
              })
              const expectedPointers = [
                [0, 0],
                [width - 1, 0],
                [0, height - 1],
                [width - 1, height - 1],
                [width / 2, height / 2],
              ]
              const checks = {
                // Forced Chromium scale on a differently scaled Windows host can
                // round native bounds by up to 2 DIP. Preserve raw measurements.
                fitsWorkArea:
                  bounds.x >= area.x - 2 &&
                  bounds.y >= area.y - 2 &&
                  bounds.x + bounds.width <= area.x + area.width + 2 &&
                  bounds.y + bounds.height <= area.y + area.height + 2,
                canvasVisible:
                  metrics.canvas.width > 0 &&
                  metrics.canvas.height > 0 &&
                  metrics.canvas.bottom <= metrics.viewport[1] + 1 &&
                  metrics.canvas.y >= metrics.toolbar.bottom - 1,
                aspectPreserved:
                  Math.abs(
                    metrics.canvas.width / metrics.canvas.height -
                      width / height,
                  ) < 0.01,
                toolbarAccessible:
                  metrics.controls.length === 10 &&
                  metrics.controls.every(
                    (r) =>
                      r.width > 0 &&
                      r.height > 0 &&
                      r.x >= 0 &&
                      r.right <= metrics.viewport[0] + 1 &&
                      r.y >= metrics.toolbar.y &&
                      r.bottom <= metrics.toolbar.bottom + 1,
                  ),
                pointers:
                  pointers.length === 5 &&
                  pointers.every(
                    (p, i) =>
                      p.length === 2 &&
                      p.every(
                        (v, j) =>
                          Number.isFinite(v) &&
                          Math.abs(v - expectedPointers[i][j]) <= 1,
                      ),
                  ),
              }
              const filename = `${id}-${size}-${width}x${height}-${scale}.png`
              await page.screenshot({ path: path.join(output, filename) })
              samples.push({
                size,
                device: [width, height],
                scale,
                bounds,
                metrics,
                pointers,
                checks,
                screenshot: filename,
              })
            }
          }
        }
        report.cases.push({ id, saved, evidence, samples })
      } finally {
        await application.close()
        await fs.rm(userData, { recursive: true, force: true })
      }
    }
  }
}
await fs.writeFile(
  path.join(output, 'report.json'),
  JSON.stringify(report, null, 2),
)
const failures = report.cases.flatMap((c) =>
  c.samples
    .filter((s) => Object.values(s.checks).some((v) => !v))
    .map((s) => ({
      id: c.id,
      size: s.size,
      device: s.device,
      scale: s.scale,
      checks: s.checks,
    })),
)
console.log(
  JSON.stringify(
    {
      cases: report.cases.length,
      samples: report.cases.reduce((n, c) => n + c.samples.length, 0),
      failures,
    },
    null,
    2,
  ),
)
if (failures.length) process.exitCode = 1
