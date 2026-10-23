import builder from 'electron-builder'
import isMac from 'licia/isMac.js'

cd('dist')

const pkg = await fs.readJson('package.json')

let publishChannel = 'latest'
if (isMac && process.arch !== 'arm64') {
  publishChannel = 'latest-${arch}'
}

const config = {
  appId: pkg.appId,
  directories: {
    output: `../release/${pkg.version}`,
  },
  files: ['main', 'preload', 'renderer', 'LICENSE', 'THIRD_PARTY_NOTICES.txt'],
  extraResources: {
    from: 'resources',
    to: './',
    filter: ['**/*'],
  },
  artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
  nsis: {
    allowToChangeInstallationDirectory: true,
    oneClick: false,
  },
  win: {
    target: [
      {
        target: 'nsis',
      },
    ],
  },
  mac: {
    electronLanguages: ['zh_CN', 'en'],
    target: [
      {
        target: 'dmg',
      },
    ],
  },
  publish: {
    provider: 'github',
    owner: 'MonsterXia',
    repo: 'scrcpy-harmony',
    channel: publishChannel,
  },
}

await builder.build({
  config,
  publish: process.argv.includes('--no-publish') ? 'never' : undefined,
})
