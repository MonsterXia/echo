import { Menu, MenuItemConstructorOptions, app, shell } from 'electron'
import type { BaseWindow, MenuItem } from 'electron'
import * as window from 'share/main/lib/window'
import * as terminal from 'share/main/window/terminal'
import * as process from 'share/main/window/process'
import * as about from 'share/main/window/about'
import isMac from 'licia/isMac'
import { t } from 'common/util'
import isWindows from 'licia/isWindows'
import { getUserDataPath, handleEvent } from 'share/main/lib/util'
import * as updater from 'share/main/lib/updater'
import { isDev } from 'share/common/util'
import { editWindow } from './screencastEdit'

function getTemplate(): MenuItemConstructorOptions[] {
  const hideMenu = isMac
    ? [
        {
          type: 'separator',
        },
        {
          label: t('hideApp'),
          role: 'hide',
        },
        {
          label: t('hideOthers'),
          role: 'hideothers',
        },
        {
          label: t('showAll'),
          role: 'unhide',
        },
      ]
    : []

  const application = {
    label: app.name,
    submenu: [
      {
        label: t('aboutApp'),
        click() {
          about.showWin()
        },
      },
      {
        label: `${t('checkUpdate')}...`,
        async click(item: MenuItem) {
          const label = item.label
          item.enabled = false
          item.label = t('checkingForUpdates')
          refreshMenu()
          try {
            await updater.checkUpdate()
          } finally {
            item.label = label
            item.enabled = true
            refreshMenu()
          }
        },
      },
      ...hideMenu,
      {
        type: 'separator',
      },
      {
        label: t('quitApp'),
        accelerator: isMac ? 'Command+Q' : 'Ctrl+Q',
        click() {
          app.quit()
        },
      },
    ],
  }

  const edit = {
    label: t('edit'),
    submenu: [
      {
        role: 'cut',
        label: t('cut'),
      },
      {
        role: 'copy',
        label: t('copy'),
      },
      {
        role: 'paste',
        label: t('paste'),
      },
      {
        label: t('delete'),
        click: (_item: MenuItem, focused: BaseWindow | undefined) => editWindow('delete', focused, window.getWin('screencast')),
      },
      {
        label: t('selectAll'),
        accelerator: 'CommandOrControl+A',
        click: (_item: MenuItem, focused: BaseWindow | undefined) => editWindow('selectAll', focused, window.getWin('screencast')),
      },
    ],
  }

  const tools = {
    label: t('tools'),
    submenu: [
      {
        label: t('terminal'),
        click() {
          terminal.showWin()
        },
      },
      {
        label: t('processManager'),
        click() {
          process.showWin()
        },
      },
    ],
  }

  const help: any = {
    role: 'help',
    label: t('help'),
    submenu: [
      {
        label: t('reportIssue'),
        click() {
          shell.openExternal('https://github.com/MonsterXia/scrcpy-harmony/issues')
        },
      },
      {
        type: 'separator',
      },
      ...(isDev()
        ? [
            {
              label: t('openUserDataDir'),
              click() {
                shell.openPath(getUserDataPath(''))
              },
            },
            {
              label: t('debugMainProcess'),
              click() {
                process.debugMainProcess()
              },
            },
          ]
        : []),
      {
        role: 'toggledevtools',
        label: t('toggleDevtools'),
      },
    ],
  }

  const template = [tools, help]
  if (isMac) {
    template.unshift(application, edit)
  } else {
    template.unshift(application)
  }

  return template
}

function updateMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(getTemplate()))
  refreshMenu()
}

function refreshMenu() {
  if (isWindows) {
    window.sendTo('main', 'refreshMenu')
  }
}

export function init() {
  updateMenu()

  handleEvent('updateMenu', updateMenu)
}
