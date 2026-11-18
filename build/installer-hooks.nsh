!include LogicLib.nsh
!include FileFunc.nsh
; Stock uninstall functions are intentionally unused by the atomic swap.
!pragma warning disable 6010
!ifndef BUILD_UNINSTALLER
  Var planRollback
!endif

!macro customHeader
  InstallDir "${PLAN_INSTALL_DIR}"
!macroend

!macro preInit
  ; $TEMP is a read-only NSIS constant. The native bootstrap sets TEMP/TMP
  ; before NSIS starts. Refuse a direct inner-payload launch using C temp.
  ; Ignore /D and _?= before the upstream template's first SetOutPath.
  StrCpy $INSTDIR "${PLAN_INSTALL_DIR}"
  GetFullPathName $0 "$TEMP"
  GetFullPathName $1 "${PLAN_TEMP_DIR}"
  ${If} $0 != $1
    SetErrorLevel 21
    MessageBox MB_OK|MB_ICONSTOP "请使用完整的芽芽计划安装包启动安装。临时目录必须位于 D 盘。" /SD IDOK
    Quit
  ${EndIf}
  SetOutPath "${PLAN_TEMP_DIR}"
  InitPluginsDir
  System::Call 'kernel32::SetEnvironmentVariableW(w "TEMP", w "${PLAN_TEMP_DIR}") i.r0'
  System::Call 'kernel32::SetEnvironmentVariableW(w "TMP", w "${PLAN_TEMP_DIR}") i.r0'
  !ifdef PLAN_QA
    FileOpen $0 "${PLAN_DATA_DIR}\installer-path-evidence.txt" w
    FileWrite $0 "TEMP=$TEMP$\r$\nPLUGINSDIR=$PLUGINSDIR$\r$\nOUTDIR=$OUTDIR$\r$\nINSTDIR=$INSTDIR$\r$\n"
    FileClose $0
  !endif
!macroend

!macro planCheckWritable DIRECTORY
  ClearErrors
  CreateDirectory "${DIRECTORY}"
  GetTempFileName $0 "${DIRECTORY}"
  FileOpen $1 "$0" w
  IfErrors 0 +4
    SetErrorLevel 22
    MessageBox MB_OK|MB_ICONSTOP "无法写入 ${DIRECTORY}。现有程序尚未替换，请检查目录权限。" /SD IDOK
    Quit
  FileWrite $1 "PlanEveryday installer write check"
  FileClose $1
  Delete "$0"
!macroend

!macro planCheckSpace
  ; Four payload copies plus 256 MB covers extraction, installed app, old app,
  ; installer cache and working files. Check before removal, never after it.
  System::Call 'kernel32::GetDiskFreeSpaceExW(w "D:\", *l .r0, *l .r1, *l .r2) i.r3'
  ${If} $3 == 0
    SetErrorLevel 23
    MessageBox MB_OK|MB_ICONSTOP "无法读取 D 盘剩余空间，安装已停止。" /SD IDOK
    Quit
  ${EndIf}
  System::Int64Op $0 < ${PLAN_REQUIRED_BYTES}
  Pop $0
  ${If} $0 != 0
    SetErrorLevel 24
    MessageBox MB_OK|MB_ICONSTOP "D 盘空间不足。请至少保留 ${PLAN_REQUIRED_MB} MB 空间后重试；现有程序和数据尚未更改。" /SD IDOK
    Quit
  ${EndIf}
!macroend

!macro customInit
  StrCpy $INSTDIR "${PLAN_INSTALL_DIR}"
  SetShellVarContext current
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 != ""
  ${AndIf} $0 != "${PLAN_INSTALL_DIR}"
    SetErrorLevel 25
    MessageBox MB_OK|MB_ICONSTOP "旧安装路径与固定 D 盘路径不一致。为保护原文件，安装已停止。" /SD IDOK
    Quit
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "${PLAN_INSTALL_DIR}") i.r0'
  IntOp $0 $0 & 0x400
  ${If} $0 != 0
    IfFileExists "${PLAN_INSTALL_DIR}" 0 +4
      SetErrorLevel 25
      MessageBox MB_OK|MB_ICONSTOP "程序目录不能是链接或连接点，安装已停止。" /SD IDOK
      Quit
  ${EndIf}
  IfFileExists "$INSTDIR\installed-by-nsis" planKnownInstall
  FindFirst $0 $1 "$INSTDIR\*"
  ${DoWhile} $1 != ""
    ${If} $1 != "."
    ${AndIf} $1 != ".."
      FindClose $0
      SetErrorLevel 25
      MessageBox MB_OK|MB_ICONSTOP "目标目录已有其他文件。为保护这些文件，安装已停止，请先移走该目录中的文件。" /SD IDOK
      Quit
    ${EndIf}
    FindNext $0 $1
  ${Loop}
  FindClose $0
  planKnownInstall:
  ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  ${If} $0 != ""
  ${AndIf} $0 != '$\"${PLAN_INSTALL_DIR}\${UNINSTALL_FILENAME}$\" /currentuser'
    SetErrorLevel 25
    MessageBox MB_OK|MB_ICONSTOP "旧卸载信息与程序路径不一致。为保护原文件，安装已停止。" /SD IDOK
    Quit
  ${EndIf}
  !insertmacro planCheckWritable "${PLAN_INSTALL_DIR}"
  !insertmacro planCheckWritable "${PLAN_TEMP_DIR}"
  !insertmacro planCheckWritable "${PLAN_DATA_DIR}\updates"
  !insertmacro planCheckSpace
!macroend

!macro customCheckAppRunning
  ; Covers old portable releases and the native pet, without taskkill.
  StrCpy $R8 0
  ${Do}
    !ifdef PLAN_QA
      ; QA is isolated by full executable path, so the user's portable app can
      ; stay open during real installer and upgrade tests.
      nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -Command "if (@(Get-Process | Where-Object { $$_.Path -and $$_.Path.StartsWith($\'${PLAN_INSTALL_DIR}\$\', [StringComparison]::OrdinalIgnoreCase) }).Count) { exit 0 } else { exit 603 }"'
      Pop $R0
      StrCpy $R1 603
    !else
      ${nsProcess::FindProcess} "PlanEveryday.exe" $R0
      ${nsProcess::FindProcess} "PlanEveryday.Pet.exe" $R1
    !endif
    ${If} $R0 == 603
    ${AndIf} $R1 == 603
      ${Break}
    ${EndIf}
    ${If} $R0 != 0
    ${AndIf} $R0 != 603
      SetErrorLevel 26
      MessageBox MB_OK|MB_ICONSTOP "无法确认芽芽计划是否已退出，安装已停止。" /SD IDOK
      Quit
    ${EndIf}
    ${If} $R1 != 0
    ${AndIf} $R1 != 603
      SetErrorLevel 26
      MessageBox MB_OK|MB_ICONSTOP "无法确认桌宠是否已退出，安装已停止。" /SD IDOK
      Quit
    ${EndIf}
    ${If} $R8 < 20
      Sleep 500
      IntOp $R8 $R8 + 1
    ${Else}
      IfSilent planRunningSilent planRunningPrompt
      planRunningSilent:
        SetErrorLevel 20
        Quit
      planRunningPrompt:
        MessageBox MB_RETRYCANCEL|MB_ICONINFORMATION "芽芽计划或桌宠仍在运行。请先保存编辑，并从托盘或桌宠菜单选择“退出应用”，再点击“重试”。安装不会强制结束进程。" /SD IDCANCEL IDRETRY planRetryRunning
        SetErrorLevel 20
        Quit
      planRetryRunning:
        StrCpy $R8 20
    ${EndIf}
  ${Loop}
!macroend

!macro planValidateFile RELATIVE EXPECTED
  ${StdUtils.HashFile} $0 "SHA2-256" "$PLUGINSDIR\validated-app\${RELATIVE}"
  ${If} $0 != "${EXPECTED}"
    SetErrorLevel 27
    MessageBox MB_OK|MB_ICONSTOP "安装内容校验失败，请重新下载安装包。现有程序和数据尚未替换。" /SD IDOK
    Quit
  ${EndIf}
!macroend

!macro planPreparePayload
  !insertmacro planCheckSpace
  SetOutPath "$PLUGINSDIR\validated-app"
  !insertmacro extractEmbeddedAppPackage
  !ifdef PLAN_QA
    ReadEnvStr $0 "PLAN_INSTALLER_QA_CORRUPT_PAYLOAD"
    ${If} $0 == "1"
      FileOpen $0 "$PLUGINSDIR\validated-app\resources\app.asar" a
      FileWrite $0 "QA integrity fault"
      FileClose $0
    ${EndIf}
  !endif
  File "/oname=$PLUGINSDIR\validated-app\${UNINSTALL_FILENAME}" "${UNINSTALLER_OUT_FILE}"
  FileOpen $0 "$PLUGINSDIR\validated-app\installed-by-nsis" w
  FileWrite $0 "PlanEveryday NSIS ${VERSION}$\r$\n"
  FileClose $0
  !insertmacro planValidatePayload
  !insertmacro planValidateUninstaller
  SetOutPath "${PLAN_TEMP_DIR}"
!macroend

!macro planSwapApplication
  ; The stock template deletes the old app before extracting. Keep its entire
  ; directory on D instead; registry and shortcuts remain intact until success.
  StrCpy $planRollback ""
  IfFileExists "$INSTDIR\installed-by-nsis" planKeepPrevious planEmptyTarget
  planKeepPrevious:
    CreateDirectory "${PLAN_DATA_DIR}\updates\program-rollback"
    GetTempFileName $planRollback "${PLAN_DATA_DIR}\updates\program-rollback"
    Delete "$planRollback"
    ClearErrors
    Rename "$INSTDIR" "$planRollback"
    IfErrors planSwapFailed planInstallPrepared
  planEmptyTarget:
    RMDir "$INSTDIR"
  planInstallPrepared:
    !ifdef PLAN_QA
      ReadEnvStr $0 "PLAN_INSTALLER_QA_FAIL_SWAP"
      ${If} $0 == "1"
        Goto planRestorePrevious
      ${EndIf}
    !endif
    ClearErrors
    Rename "$PLUGINSDIR\validated-app" "$INSTDIR"
    IfErrors planRestorePrevious planSwapDone
  planRestorePrevious:
    ${If} $planRollback != ""
      ClearErrors
      Rename "$planRollback" "$INSTDIR"
      IfErrors planRestoreFailed
    ${EndIf}
  planSwapFailed:
    SetErrorLevel 29
    MessageBox MB_OK|MB_ICONSTOP "程序文件无法替换，旧版本已保留。请关闭占用程序目录的软件后重试。" /SD IDOK
    Quit
  planRestoreFailed:
    SetErrorLevel 30
    MessageBox MB_OK|MB_ICONSTOP "替换失败，旧程序仍完整保留在：$\r$\n$planRollback$\r$\n请将该目录恢复到 ${PLAN_INSTALL_DIR} 后重新启动。个人数据未更改。" /SD IDOK
    Quit
  planSwapDone:
    SetOutPath "$INSTDIR"
!macroend

!macro customUnInit
  ${If} $INSTDIR != "${PLAN_INSTALL_DIR}"
    SetErrorLevel 28
    MessageBox MB_OK|MB_ICONSTOP "卸载目录不匹配，已停止以保护其他文件。" /SD IDOK
    Quit
  ${EndIf}
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i.r0'
  IntOp $0 $0 & 0x400
  ${If} $0 != 0
    SetErrorLevel 28
    MessageBox MB_OK|MB_ICONSTOP "程序目录已变为链接，卸载已停止。" /SD IDOK
    Quit
  ${EndIf}
!macroend

!macro customUnInstall
  ; Never remove PlanEverydayData, images, backups or the update cache.
  Delete "$INSTDIR\installed-by-nsis"
!macroend

!macro customRemoveFiles
  ; Delete only the shipped file manifest. Unknown files and all personal data
  ; are preserved, and nested directories are removed only when empty.
  SetOutPath "${PLAN_TEMP_DIR}"
  !insertmacro planRemovePayload
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
  Delete "$INSTDIR\installed-by-nsis"
  RMDir "$INSTDIR"
!macroend
