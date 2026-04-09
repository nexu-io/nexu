Unicode true
ManifestDPIAware true
RequestExecutionLevel user

!ifndef APP_VERSION
  !error "APP_VERSION define is required"
!endif
!ifndef PRODUCT_NAME
  !error "PRODUCT_NAME define is required"
!endif
!ifndef OUTPUT_EXE
  !error "OUTPUT_EXE define is required"
!endif
!ifndef PAYLOAD_7Z
  !error "PAYLOAD_7Z define is required"
!endif
!ifndef SEVEN_Z_EXE
  !error "SEVEN_Z_EXE define is required"
!endif

!ifndef SEVEN_Z_DLL
  !error "SEVEN_Z_DLL define is required"
!endif
!ifndef APP_ICON
  !error "APP_ICON define is required"
!endif

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "win-installer-lang.nsh"

!define PRODUCT_PUBLISHER "Powerformer, Inc."
!define PRODUCT_DIR_REGKEY "Software\Microsoft\Windows\CurrentVersion\App Paths\Nexu.exe"
!define UNINSTALL_REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
!define INSTALLER_LOG "$TEMP\nexu-custom-installer.log"
!define NEXU_CONFIG_REGKEY "Software\Nexu\Desktop"
!define NEXU_USER_DATA_VALUE "UserDataRoot"
!define DEFAULT_USER_DATA_DIR_NAME "nexu-desktop"
!define INSTALL_TOMBSTONE_PREFIX "nexu-desktop.old."
!define INSTALL_TOMBSTONE_MARKER ".nexu-installer-tombstone"

Var UserDataDir
Var UserDataInputHandle
Var UninstallDeleteDataCheckboxHandle
Var UninstallDeleteLocalDataSelected

Name "${PRODUCT_NAME}"
OutFile "${OUTPUT_EXE}"
InstallDir "$LOCALAPPDATA\Programs\nexu-desktop"
InstallDirRegKey HKCU "${UNINSTALL_REGKEY}" "InstallLocation"
Icon "${APP_ICON}"
UninstallIcon "${APP_ICON}"
ShowInstDetails show
ShowUninstDetails show

!define MUI_ABORTWARNING
!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Nexu.exe"
!define MUI_FINISHPAGE_RUN_TEXT "$(Lang_FinishRunNexu)"
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "$(Lang_FinishCreateDesktopShortcut)"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom UserDataPageCreate UserDataPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
UninstPage custom un.UninstallOptionsPageCreate un.UninstallOptionsPageLeave
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

Function BrowseUserDataDir
  ${NSD_GetText} $UserDataInputHandle $0
  nsDialogs::SelectFolderDialog "$(Lang_SelectUserDataDir)" "$0"
  Pop $1
  ${If} $1 != error
    ${NSD_SetText} $UserDataInputHandle "$1"
  ${EndIf}
FunctionEnd

Function UserDataPageCreate
  !insertmacro MUI_HEADER_TEXT "$(Lang_AdvancedTitle)" "$(Lang_AdvancedSubtitle)"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "$(Lang_UserDataHelp)"
  Pop $0

  ${NSD_CreateLabel} 0 34u 100% 12u "$(Lang_UserDataLabel)"
  Pop $0

  ${NSD_CreateText} 0 49u 78% 14u "$UserDataDir"
  Pop $UserDataInputHandle

  ${NSD_CreateButton} 82% 48u 18% 14u "$(Lang_BrowseButton)"
  Pop $0
  ${NSD_OnClick} $0 BrowseUserDataDir

  nsDialogs::Show
FunctionEnd

Function UserDataPageLeave
  ${NSD_GetText} $UserDataInputHandle $UserDataDir
  ${If} $UserDataDir == ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(Lang_ErrorUserDataEmpty)"
    Abort
  ${EndIf}
FunctionEnd

Function un.UninstallOptionsPageCreate
  !insertmacro MUI_HEADER_TEXT "$(Lang_UninstallOptionsTitle)" "$(Lang_UninstallOptionsSubtitle)"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "$(Lang_UninstallOptionsHelp)"
  Pop $0

  ${NSD_CreateCheckbox} 0 34u 100% 12u "$(Lang_UninstallDeleteLocalDataCheckbox)"
  Pop $UninstallDeleteDataCheckboxHandle

  nsDialogs::Show
FunctionEnd

Function un.UninstallOptionsPageLeave
  ${NSD_GetState} $UninstallDeleteDataCheckboxHandle $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $UninstallDeleteLocalDataSelected "1"
  ${Else}
    StrCpy $UninstallDeleteLocalDataSelected "0"
  ${EndIf}
FunctionEnd

Function LogInstallerEvent
  Exch $0
  Push $1
  Push $2

  System::Call 'kernel32::GetTickCount() i .r1'
  FileOpen $2 "${INSTALLER_LOG}" a
  IfErrors done
  FileWrite $2 "$1ms | $0$\r$\n"
  FileClose $2

done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function CreateStartMenuShortcutVbs
  Push $0
  Push $1

  StrCpy $0 "$PLUGINSDIR\create-shortcut.vbs"
  FileOpen $1 $0 w
  IfErrors done
  FileWrite $1 "Set shell = CreateObject($\"WScript.Shell$\")$\r$\n"
  FileWrite $1 "Set shortcut = shell.CreateShortcut(WScript.Arguments(0))$\r$\n"
  FileWrite $1 "shortcut.TargetPath = WScript.Arguments(1)$\r$\n"
  FileWrite $1 "shortcut.Arguments = WScript.Arguments(2)$\r$\n"
  FileWrite $1 "shortcut.WorkingDirectory = WScript.Arguments(3)$\r$\n"
  FileWrite $1 "shortcut.IconLocation = WScript.Arguments(4)$\r$\n"
  FileWrite $1 "shortcut.Save$\r$\n"
  FileClose $1

done:
  Pop $1
  Pop $0
FunctionEnd

Function CreateDesktopShortcut
  Call CreateStartMenuShortcutVbs
  nsExec::ExecToLog '"$SYSDIR\cscript.exe" //NoLogo "$PLUGINSDIR\create-shortcut.vbs" "$DESKTOP\Nexu.lnk" "$INSTDIR\Nexu.exe" "" "$INSTDIR" "$INSTDIR\Nexu.exe,0"'
  Pop $0
  ${If} $0 != "0"
    Push "failed to create desktop shortcut"
    Call LogInstallerEvent
    MessageBox MB_OK|MB_ICONSTOP "$(Lang_ErrorCreateShortcutFailed)"
  ${EndIf}
FunctionEnd

Function un.LogInstallerEvent
  Exch $0
  Push $1
  Push $2

  System::Call 'kernel32::GetTickCount() i .r1'
  FileOpen $2 "${INSTALLER_LOG}" a
  IfErrors done
  FileWrite $2 "$1ms | $0$\r$\n"
  FileClose $2

done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function QueueAsyncDelete
  Exch $0
  Push $1
  Push $2
  Push $3

  GetTempFileName $1
  StrCpy $2 "$1.cmd"
  Delete $1
  FileOpen $3 $2 w
  IfErrors done
  FileWrite $3 "@echo off$\r$\n"
  FileWrite $3 "ping 127.0.0.1 -n 3 >nul$\r$\n"
  FileWrite $3 "rmdir /s /q $\"$0$\"$\r$\n"
  FileWrite $3 "del /f /q $\"%~f0$\"$\r$\n"
  FileClose $3
  nsExec::Exec '"$SYSDIR\cmd.exe" /c "$2"'
  Pop $3

done:
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function un.QueueAsyncDelete
  Exch $0
  Push $1
  Push $2
  Push $3

  GetTempFileName $1
  StrCpy $2 "$1.cmd"
  Delete $1
  FileOpen $3 $2 w
  IfErrors done
  FileWrite $3 "@echo off$\r$\n"
  FileWrite $3 "ping 127.0.0.1 -n 3 >nul$\r$\n"
  FileWrite $3 "rmdir /s /q $\"$0$\"$\r$\n"
  FileWrite $3 "del /f /q $\"%~f0$\"$\r$\n"
  FileClose $3
  nsExec::Exec '"$SYSDIR\cmd.exe" /c "$2"'
  Pop $3

done:
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function BuildInstallTombstonePath
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9

  ${GetParent} "$INSTDIR" $1
  System::Call '*(i2, i2, i2, i2, i2, i2, i2, i2) p.r2'
  System::Call 'kernel32::GetLocalTime(p r2)'
  System::Call '*$2(i2.r3, i2.r4, i2.r5, i2.r6, i2.r7, i2.r8, i2.r9, i2.r0)'
  System::Free $2
  IntFmt $3 "%04d" $3
  IntFmt $4 "%02d" $4
  IntFmt $5 "%02d" $5
  IntFmt $6 "%02d" $7
  IntFmt $7 "%02d" $8
  IntFmt $8 "%02d" $9
  IntFmt $9 "%03d" $0
  StrCpy $0 "$1\${INSTALL_TOMBSTONE_PREFIX}$3$4$5$6$7$8$9"

  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
FunctionEnd

Function QueueInstallTombstoneCleanup
  Exch $0
  Push $1
  Push $2

  IfFileExists "$0\${INSTALL_TOMBSTONE_MARKER}" 0 done
  Push "$0"
  Call QueueAsyncDelete

done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function QueueSiblingInstallTombstoneCleanup
  Push $0
  Push $1
  Push $2
  Push $3

  ${GetParent} "$INSTDIR" $0
  FindFirst $1 $2 "$0\${INSTALL_TOMBSTONE_PREFIX}*"
loop:
  IfErrors done
  StrCmp $2 "" next
  StrCmp $2 "." next
  StrCmp $2 ".." next
  StrCpy $3 "$0\$2"
  IfFileExists "$3\${INSTALL_TOMBSTONE_MARKER}" 0 next
  Push "$3"
  Call QueueAsyncDelete

next:
  FindNext $1 $2
  Goto loop

done:
  FindClose $1
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function PrepareInstallDirectory
  Push $0
  Push $1

  DetailPrint "$(Lang_StatusCleanupOldBackups)"
  Push "queueing cleanup for install tombstones"
  Call LogInstallerEvent
  Call QueueSiblingInstallTombstoneCleanup

  IfFileExists "$INSTDIR\*" has_existing_install done

has_existing_install:
  MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON2 "$(Lang_ConfirmOverwriteInstall)" IDYES move_existing_install
  Abort

move_existing_install:
  DetailPrint "$(Lang_StatusMoveOldInstall)"
  Push "moving previous install directory to tombstone"
  Call LogInstallerEvent
  Call BuildInstallTombstonePath
  StrCpy $0 "$0"
  Rename "$INSTDIR" "$0"
  IfErrors rename_failed
  FileOpen $1 "$0\${INSTALL_TOMBSTONE_MARKER}" w
  IfErrors tombstone_marker_done
  FileWrite $1 "nexu-custom-installer tombstone$\r$\n"
  FileClose $1

tombstone_marker_done:
  Push "$0"
  Call QueueInstallTombstoneCleanup
  Goto done

rename_failed:
  Push "failed to move previous install directory to tombstone"
  Call LogInstallerEvent
  MessageBox MB_OK|MB_ICONSTOP "$(Lang_ErrorMoveOldInstallFailed)"
  Abort

done:
  Pop $1
  Pop $0
FunctionEnd

Function .onInit
  SetShellVarContext current
  Delete "${INSTALLER_LOG}"
  Push "installer init"
  Call LogInstallerEvent
  ReadRegStr $UserDataDir HKCU "${NEXU_CONFIG_REGKEY}" "${NEXU_USER_DATA_VALUE}"
  ${If} $UserDataDir == ""
    StrCpy $UserDataDir "$APPDATA\${DEFAULT_USER_DATA_DIR_NAME}"
  ${EndIf}
  nsExec::ExecToStack '"$SYSDIR\tasklist.exe" /FI "IMAGENAME eq Nexu.exe" /NH'
  Pop $0
  Pop $1
  StrCpy $2 $1 8
  ${If} $0 == "0"
  ${AndIf} $2 == "Nexu.exe"
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(Lang_ErrorAppRunning)"
    Abort
  ${EndIf}
FunctionEnd

Section "Install"
  SetShellVarContext current
  DetailPrint "$(Lang_StatusInstallStart)"
  Push "install section start"
  Call LogInstallerEvent

  Push "about to check previous install contents"
  Call LogInstallerEvent
  Call PrepareInstallDirectory

  SetOutPath "$PLUGINSDIR"
  DetailPrint "$(Lang_StatusEmbedPayload)"
  Push "embedded payload staging start"
  Call LogInstallerEvent
  File "/oname=$PLUGINSDIR\payload.7z" "${PAYLOAD_7Z}"
  File "/oname=$PLUGINSDIR\7z.exe" "${SEVEN_Z_EXE}"
  File "/oname=$PLUGINSDIR\7z.dll" "${SEVEN_Z_DLL}"
  Push "embedded payload staging done"
  Call LogInstallerEvent

  CreateDirectory "$INSTDIR"
  DetailPrint "$(Lang_StatusExtractPayload)"
  DetailPrint "$(Lang_StatusExtractDiagnostics)"
  Push "payload extraction start"
  Call LogInstallerEvent
  Push 'payload extraction archive="$PLUGINSDIR\payload.7z" target="$INSTDIR"'
  Call LogInstallerEvent
  nsExec::Exec '"$PLUGINSDIR\7z.exe" x -y "$PLUGINSDIR\payload.7z" "-o$INSTDIR"'
  Pop $0
  Push "payload extraction exit code $0"
  Call LogInstallerEvent
  ${If} $0 != "0"
    DetailPrint "7z extraction failed with exit code $0"
    Push "payload extraction failed; see ${INSTALLER_LOG}"
    Call LogInstallerEvent
    MessageBox MB_OK|MB_ICONSTOP "$(Lang_ErrorExtractFailed)$(Lang_ErrorExtractFailedWithLog)"
    Abort
  ${EndIf}
  Push "payload extraction done"
  Call LogInstallerEvent

  WriteUninstaller "$INSTDIR\Uninstall Nexu.exe"
  CreateDirectory "$SMPROGRAMS\Nexu"
  DetailPrint "$(Lang_StatusFinalizeInstall)"
  Call CreateStartMenuShortcutVbs
  nsExec::ExecToLog '"$SYSDIR\cscript.exe" //NoLogo "$PLUGINSDIR\create-shortcut.vbs" "$SMPROGRAMS\Nexu\Nexu.lnk" "$INSTDIR\Nexu.exe" "" "$INSTDIR" "$INSTDIR\Nexu.exe,0"'
  Pop $0
  ${If} $0 != "0"
    Push "failed to create app Start Menu shortcut"
    Call LogInstallerEvent
    MessageBox MB_OK|MB_ICONSTOP "$(Lang_ErrorCreateShortcutFailed)"
    Abort
  ${EndIf}
  nsExec::ExecToLog '"$SYSDIR\cscript.exe" //NoLogo "$PLUGINSDIR\create-shortcut.vbs" "$SMPROGRAMS\Nexu\Uninstall Nexu.lnk" "$INSTDIR\Uninstall Nexu.exe" "" "$INSTDIR" "$INSTDIR\Uninstall Nexu.exe,0"'
  Pop $0
  ${If} $0 != "0"
    Push "failed to create uninstall Start Menu shortcut"
    Call LogInstallerEvent
    MessageBox MB_OK|MB_ICONSTOP "$(Lang_ErrorCreateShortcutFailed)"
    Abort
  ${EndIf}

  WriteRegStr HKCU "${UNINSTALL_REGKEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${UNINSTALL_REGKEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_REGKEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_REGKEY}" "UninstallString" '"$INSTDIR\Uninstall Nexu.exe"'
  WriteRegStr HKCU "${UNINSTALL_REGKEY}" "DisplayIcon" "$INSTDIR\Nexu.exe"
  WriteRegStr HKCU "${PRODUCT_DIR_REGKEY}" "" "$INSTDIR\Nexu.exe"
  ${If} $UserDataDir == "$APPDATA\${DEFAULT_USER_DATA_DIR_NAME}"
    DeleteRegValue HKCU "${NEXU_CONFIG_REGKEY}" "${NEXU_USER_DATA_VALUE}"
  ${Else}
    WriteRegStr HKCU "${NEXU_CONFIG_REGKEY}" "${NEXU_USER_DATA_VALUE}" "$UserDataDir"
  ${EndIf}
  DetailPrint "$(Lang_StatusInstallDone)"
  Push "install section done"
  Call LogInstallerEvent
SectionEnd

Section "Uninstall"
  DetailPrint "$(Lang_StatusUninstallStart)"
  Push "uninstall section start"
  Call un.LogInstallerEvent
  StrCpy $UninstallDeleteLocalDataSelected "0"
  Delete "$DESKTOP\Nexu.lnk"
  Delete "$SMPROGRAMS\Nexu\Nexu.lnk"
  Delete "$SMPROGRAMS\Nexu\Uninstall Nexu.lnk"
  RMDir "$SMPROGRAMS\Nexu"
  DeleteRegKey HKCU "${UNINSTALL_REGKEY}"
  DeleteRegKey HKCU "${PRODUCT_DIR_REGKEY}"
  Delete "$INSTDIR\Uninstall Nexu.exe"
  Push "$INSTDIR"
  Call un.QueueAsyncDelete
  Push "uninstall section queued async delete"
  Call un.LogInstallerEvent
SectionEnd

Section "un.$(Lang_UninstallDeleteLocalData)"
  ${If} $UninstallDeleteLocalDataSelected != "1"
    Goto done
  ${EndIf}
  StrCpy $0 "$APPDATA\${DEFAULT_USER_DATA_DIR_NAME}"
  ReadRegStr $1 HKCU "${NEXU_CONFIG_REGKEY}" "${NEXU_USER_DATA_VALUE}"
  ${If} $1 != ""
    StrCpy $0 "$1"
  ${EndIf}
  DeleteRegValue HKCU "${NEXU_CONFIG_REGKEY}" "${NEXU_USER_DATA_VALUE}"
  DetailPrint "$(Lang_StatusQueueDeleteData)"
  Push "$0"
  Call un.QueueAsyncDelete
  Push "queued local data delete"
  Call un.LogInstallerEvent
done:
SectionEnd
