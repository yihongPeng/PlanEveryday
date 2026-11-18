module.exports = {
  appId: 'local.PlanEveryday.Desktop',
  productName: '芽芽计划',
  executableName: 'PlanEveryday',
  copyright: 'Copyright © PlanEveryday',
  directories: {buildResources: 'build'},
  win: {target: [{target: 'nsis', arch: ['x64']}], icon: 'assets/app.ico', executableName: 'PlanEveryday'},
  nsis: {
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: false,
    deleteAppDataOnUninstall: false,
    packElevateHelper: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: '芽芽计划',
    uninstallDisplayName: '芽芽计划',
    installerLanguages: ['zh_CN'],
    language: '2052',
    runAfterFinish: true,
    differentialPackage: true,
    artifactName: 'PlanEveryday-Setup-${version}.${ext}'
  },
  publish: [{provider: 'github', owner: 'yihongPeng', repo: 'PlanEveryday', releaseType: 'release'}]
};
