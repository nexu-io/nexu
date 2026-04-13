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
!include "WinMessages.nsh"
!include "win-installer-lang.nsh"

!define PRODUCT_PUBLISHER "Powerformer, Inc."
!define PRODUCT_DIR_REGKEY "Software\Microsoft\Windows\CurrentVersion\App Paths\Nexu.exe"
!define UNINSTALL_REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
!define INSTALLER_LOG "$TEMP\nexu-custom-installer.log"
!define NEXU_CONFIG_REGKEY "Software\Nexu\Desktop"
!define NEXU_USER_DATA_VALUE "UserDataRoot"
!define DEFAULT_USER_DATA_DIR_NAME "nexu-desktop"
!define INSTALL_TOMBSTONE_PREFIX "nexu-desktop.old."
!define USERDATA_TOMBSTONE_PREFIX "nexu-userdata.old."
!define INSTALL_TOMBSTONE_MARKER ".nexu-installer-tombstone"

Var UserDataDir
Var OldUserDataDir
Var OldUserDataDirIsNonEmpty
Var PathCompareResult
Var UserDataInputHandle
Var MigrationStrategy
Var MigrationMoveRadioHandle
Var MigrationCopyRadioHandle
Var MigrationNoopRadioHandle
Var UninstallDeleteDataCheckboxHandle
Var UninstallDeleteLocalDataSelected
Var UninstallResolvedUserDataDir
Var UninstallResolvedUserDataDirHandle

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
; --- Temporarily disabled: custom directory pages are kept but not shown ---
; !insertmacro MUI_PAGE_DIRECTORY
; Page custom UserDataPageCreate UserDataPageLeave
; Page custom MigrationPageCreate MigrationPageLeave
; --- End temporarily disabled ---
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

Function TrimTrailingDirectorySeparators
  Push $1
  Push $2

trim_trailing_separators:
  StrLen $1 $0
  ${If} $1 <= 3
    Goto trim_done
  ${EndIf}

  IntOp $2 $1 - 1
  StrCpy $1 $0 1 $2
  StrCmp $1 "\" trim_one_separator
  StrCmp $1 "/" trim_one_separator
  Goto trim_done

trim_one_separator:
  StrCpy $0 $0 $2
  Goto trim_trailing_separators

trim_done:
  Pop $2
  Pop $1
FunctionEnd

Function CollapseDuplicateDefaultUserDataSuffix
  Push $1
  Push $2
  Push $3

  ${GetFileName} "$0" $1
  StrCpy $2 "${DEFAULT_USER_DATA_DIR_NAME}"
  System::Call 'kernel32::lstrcmpi(t r1, t r2)i.r3'
  IntCmp $3 0 maybe_collapse collapse_done collapse_done

maybe_collapse:
  ${GetParent} "$0" $2
  ${GetFileName} "$2" $1
  StrCpy $3 "${DEFAULT_USER_DATA_DIR_NAME}"
  System::Call 'kernel32::lstrcmpi(t r1, t r3)i.r1'
  IntCmp $1 0 do_collapse collapse_done collapse_done

do_collapse:
  StrCpy $0 "$2"

collapse_done:
  Pop $3
  Pop $2
  Pop $1
FunctionEnd

Function PathsEqualIgnoreCase
  Push $2
  Push $3

  StrCpy $PathCompareResult "0"
  StrCpy $2 "$0"
  Call TrimTrailingDirectorySeparators
  Call CollapseDuplicateDefaultUserDataSuffix
  StrCpy $2 "$0"

  StrCpy $0 "$1"
  Call TrimTrailingDirectorySeparators
  Call CollapseDuplicateDefaultUserDataSuffix
  StrCpy $3 "$0"

  StrCpy $0 "$2"
  StrCpy $1 "$3"
  System::Call 'kernel32::lstrcmpi(t r0, t r1)i.r2'
  IntCmp $2 0 paths_equal paths_not_equal paths_not_equal

paths_equal:
  StrCpy $PathCompareResult "1"

paths_not_equal:
  Pop $3
  Pop $2
FunctionEnd

Function NormalizeUserDataDir
  Push $1
  Push $2

  StrCpy $0 "$UserDataDir"
  Call TrimTrailingDirectorySeparators
  Call CollapseDuplicateDefaultUserDataSuffix
  ${GetFileName} "$0" $1

  StrCpy $2 "${DEFAULT_USER_DATA_DIR_NAME}"
  System::Call 'kernel32::lstrcmpi(t r1, t r2)i.r2'
  IntCmp $2 0 normalization_done append_suffix append_suffix

append_suffix:
  StrCpy $0 "$0\${DEFAULT_USER_DATA_DIR_NAME}"
  Goto normalization_done

normalization_done:
  StrCpy $UserDataDir "$0"
  Pop $2
  Pop $1
FunctionEnd

Function CleanupNexuConfigRegistryIfEmpty
  DeleteRegKey /ifempty HKCU "${NEXU_CONFIG_REGKEY}"
  DeleteRegKey /ifempty HKCU "Software\Nexu"
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

  Push "user-data raw-input=$UserDataDir"
  Call LogInstallerEvent

  Call NormalizeUserDataDir
  ${NSD_SetText} $UserDataInputHandle "$UserDataDir"
  Push "user-data normalized-target=$UserDataDir old=$OldUserDataDir"
  Call LogInstallerEvent

  StrCpy $0 "$UserDataDir"
  StrCpy $1 "$OldUserDataDir"
  Push "user-data compare-target=$0"
  Call LogInstallerEvent
  Push "user-data compare-old=$1"
  Call LogInstallerEvent
  Call PathsEqualIgnoreCase
  Push "user-data path-compare equal=$PathCompareResult"
  Call LogInstallerEvent
  ${If} $PathCompareResult == "1"
    Push "user-data no-op: normalized target equals current data dir"
    Call LogInstallerEvent
    Return
  ${EndIf}

  StrCpy $0 "$UserDataDir"
  Call UpdateDirectoryNonEmptyState
  ${If} $OldUserDataDirIsNonEmpty == "1"
    Push "user-data quick-fail target-non-empty target=$UserDataDir"
    Call LogInstallerEvent
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(Lang_ErrorUserDataTargetNonEmpty)"
    Abort
  ${EndIf}

  Push "user-data quick-pass target-available target=$UserDataDir"
  Call LogInstallerEvent
FunctionEnd

Function UpdateDirectoryNonEmptyState
  Push $1
  Push $2

  StrCpy $OldUserDataDirIsNonEmpty "0"
  IfFileExists "$0\*" 0 done
  FindFirst $1 $2 "$0\*"
loop:
  IfErrors close
  StrCmp $2 "" next
  StrCmp $2 "." next
  StrCmp $2 ".." next
  StrCpy $OldUserDataDirIsNonEmpty "1"
  Goto close
next:
  FindNext $1 $2
  Goto loop
close:
  FindClose $1
done:
  Pop $2
  Pop $1
FunctionEnd

Function MigrationPageCreate
  StrCpy $0 "$UserDataDir"
  StrCpy $1 "$OldUserDataDir"
  Call PathsEqualIgnoreCase
  ${If} $PathCompareResult == "1"
    Push "migration-page abort reason=same-effective-path target=$UserDataDir old=$OldUserDataDir"
    Call LogInstallerEvent
    Abort
  ${EndIf}

  StrCpy $0 "$OldUserDataDir"
  Call UpdateDirectoryNonEmptyState
  ${If} $OldUserDataDirIsNonEmpty != "1"
    Push "migration-page abort reason=old-dir-empty old=$OldUserDataDir"
    Call LogInstallerEvent
    Abort
  ${EndIf}

  Push "migration-page show target=$UserDataDir old=$OldUserDataDir"
  Call LogInstallerEvent

  !insertmacro MUI_HEADER_TEXT "$(Lang_MigrationTitle)" "$(Lang_MigrationSubtitle)"

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 18u "$(Lang_MigrationHelp)"
  Pop $0

  ${NSD_CreateLabel} 0 24u 100% 10u "$(Lang_MigrationOldDirLabel)"
  Pop $0
  ${NSD_CreateLabel} 0 34u 100% 12u "$OldUserDataDir"
  Pop $0

  ${NSD_CreateLabel} 0 50u 100% 10u "$(Lang_MigrationNewDirLabel)"
  Pop $0
  ${NSD_CreateLabel} 0 60u 100% 12u "$UserDataDir"
  Pop $0

  ${NSD_CreateRadioButton} 0 82u 100% 12u "$(Lang_MigrationMoveOption)"
  Pop $MigrationMoveRadioHandle
  ${NSD_Check} $MigrationMoveRadioHandle

  ${NSD_CreateRadioButton} 0 98u 100% 12u "$(Lang_MigrationCopyOption)"
  Pop $MigrationCopyRadioHandle

  ${NSD_CreateRadioButton} 0 114u 100% 12u "$(Lang_MigrationNoopOption)"
  Pop $MigrationNoopRadioHandle

  nsDialogs::Show
FunctionEnd

Function MigrationPageLeave
  ${NSD_GetState} $MigrationCopyRadioHandle $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $MigrationStrategy "copy"
    Return
  ${EndIf}

  ${NSD_GetState} $MigrationNoopRadioHandle $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $MigrationStrategy "noop"
    Return
  ${EndIf}

  StrCpy $MigrationStrategy "move"
FunctionEnd

Function un.UninstallOptionsPageCreate
  !insertmacro MUI_HEADER_TEXT "$(Lang_UninstallOptionsTitle)" "$(Lang_UninstallOptionsSubtitle)"

  Call un.ResolveUserDataDir

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "$(Lang_UninstallOptionsHelp)"
  Pop $0

  ${NSD_CreateLabel} 0 28u 100% 10u "$(Lang_UninstallDeleteLocalDataPathLabel)"
  Pop $0

  ${NSD_CreateText} 0 40u 100% 14u "$UninstallResolvedUserDataDir"
  Pop $UninstallResolvedUserDataDirHandle
  SendMessage $UninstallResolvedUserDataDirHandle ${EM_SETREADONLY} 1 0

  ${NSD_CreateCheckbox} 0 60u 100% 12u "$(Lang_UninstallDeleteLocalDataCheckbox)"
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

Function un.ResolveUserDataDir
  StrCpy $UninstallResolvedUserDataDir "$APPDATA\${DEFAULT_USER_DATA_DIR_NAME}"
  ReadRegStr $0 HKCU "${NEXU_CONFIG_REGKEY}" "${NEXU_USER_DATA_VALUE}"
  ${If} $0 != ""
    StrCpy $UninstallResolvedUserDataDir "$0"
  ${EndIf}

  StrCpy $0 "$UninstallResolvedUserDataDir"
  Call un.TrimTrailingDirectorySeparators
  Call un.CollapseDuplicateDefaultUserDataSuffix
  StrCpy $UninstallResolvedUserDataDir "$0"
FunctionEnd

Function un.TrimTrailingDirectorySeparators
  Push $1
  Push $2

un_trim_trailing_separators:
  StrLen $1 $0
  ${If} $1 <= 3
    Goto un_trim_done
  ${EndIf}

  IntOp $2 $1 - 1
  StrCpy $1 $0 1 $2
  StrCmp $1 "\" un_trim_one_separator
  StrCmp $1 "/" un_trim_one_separator
  Goto un_trim_done

un_trim_one_separator:
  StrCpy $0 $0 $2
  Goto un_trim_trailing_separators

un_trim_done:
  Pop $2
  Pop $1
FunctionEnd

Function un.CollapseDuplicateDefaultUserDataSuffix
  Push $1
  Push $2
  Push $3

  ${GetFileName} "$0" $1
  StrCpy $2 "${DEFAULT_USER_DATA_DIR_NAME}"
  System::Call 'kernel32::lstrcmpi(t r1, t r2)i.r3'
  IntCmp $3 0 un_maybe_collapse un_collapse_done un_collapse_done

un_maybe_collapse:
  ${GetParent} "$0" $2
  ${GetFileName} "$2" $1
  StrCpy $3 "${DEFAULT_USER_DATA_DIR_NAME}"
  System::Call 'kernel32::lstrcmpi(t r1, t r3)i.r1'
  IntCmp $1 0 un_do_collapse un_collapse_done un_collapse_done

un_do_collapse:
  StrCpy $0 "$2"

un_collapse_done:
  Pop $3
  Pop $2
  Pop $1
FunctionEnd

Function LogInstallerEvent
  Exch $0
  Push $1

  FileOpen $1 "${INSTALLER_LOG}" a
  IfErrors done
  FileWrite $1 "$0$\r$\n"
  FileClose $1

done:
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

  FileOpen $1 "${INSTALLER_LOG}" a
  IfErrors done
  FileWrite $1 "$0$\r$\n"
  FileClose $1

done:
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

Function WriteTombstoneMarker
  Exch $0
  Push $1

  FileOpen $1 "$0\${INSTALL_TOMBSTONE_MARKER}" w
  IfErrors done
  FileWrite $1 "nexu-custom-installer tombstone$\r$\n"
  FileClose $1

done:
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
  Push $R0
  Push $R1

  ${GetParent} "$INSTDIR" $1
  GetTempFileName $R0
  ${GetFileName} "$R0" $R1
  Delete $R0
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
  StrCpy $R1 $R1 6
  StrCpy $0 "$1\${INSTALL_TOMBSTONE_PREFIX}$3$4$5-$6$7$8-$R1"

  Pop $R1
  Pop $R0
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

Function BuildUserDataTombstonePath
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  Push $R0
  Push $R1

  ${GetParent} "$0" $1
  GetTempFileName $R0
  ${GetFileName} "$R0" $R1
  Delete $R0
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
  StrCpy $R1 $R1 6
  StrCpy $0 "$1\${USERDATA_TOMBSTONE_PREFIX}$3$4$5-$6$7$8-$R1"

  Pop $R1
  Pop $R0
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

Function QueueUserDataTombstoneCleanup
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

Function QueueSiblingUserDataTombstoneCleanup
  Exch $0
  Push $1
  Push $2
  Push $3

  FindFirst $1 $2 "$0\${USERDATA_TOMBSTONE_PREFIX}*"
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

  StrCpy $0 "$OldUserDataDir"
  ${GetParent} "$0" $0
  Push "queueing cleanup for user-data tombstones"
  Call LogInstallerEvent
  Push "$0"
  Call QueueSiblingUserDataTombstoneCleanup

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
  Push "$0"
  Call WriteTombstoneMarker
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
  ReadRegStr $OldUserDataDir HKCU "${NEXU_CONFIG_REGKEY}" "${NEXU_USER_DATA_VALUE}"
  Push "installer init raw-reg-user-data=$OldUserDataDir"
  Call LogInstallerEvent
  ${If} $OldUserDataDir == ""
    StrCpy $OldUserDataDir "$APPDATA\${DEFAULT_USER_DATA_DIR_NAME}"
    Push "installer init fallback-default-user-data=$OldUserDataDir"
    Call LogInstallerEvent
  ${EndIf}
  StrCpy $0 "$OldUserDataDir"
  Call TrimTrailingDirectorySeparators
  Call CollapseDuplicateDefaultUserDataSuffix
  StrCpy $OldUserDataDir "$0"
  Push "installer init normalized-old-user-data=$OldUserDataDir"
  Call LogInstallerEvent
  StrCpy $UserDataDir "$OldUserDataDir"
  StrCpy $MigrationStrategy "move"
check_app_running:
  nsExec::ExecToStack '"$SYSDIR\tasklist.exe" /FI "IMAGENAME eq Nexu.exe" /FO CSV /NH'
  Pop $0
  Pop $1
  ${If} $0 != "0"
    Push "installer init app-running check failed exit=$0 output=$1"
    Call LogInstallerEvent
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(Lang_ErrorAppRunningCheckFailedRetry)" IDRETRY app_running_retry
    Push "installer init cancelled after app-running check failure"
    Call LogInstallerEvent
    Abort
  ${EndIf}
  StrCpy $2 $1 10
  ${If} $2 == '"Nexu.exe"'
    Push "installer init detected running Nexu instance"
    Call LogInstallerEvent
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(Lang_ErrorAppRunningRetry)" IDRETRY app_running_retry
    Push "installer init cancelled because Nexu is still running"
    Call LogInstallerEvent
    Abort
  ${EndIf}
  Push "installer init app-running check passed"
  Call LogInstallerEvent
  Goto on_init_done
app_running_retry:
  Push "installer init retry requested after running-app prompt"
  Call LogInstallerEvent
  Goto check_app_running
on_init_done:
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
  StrCpy $0 "$UserDataDir"
  StrCpy $1 "$APPDATA\${DEFAULT_USER_DATA_DIR_NAME}"
  Call PathsEqualIgnoreCase
  ${If} $PathCompareResult == "1"
    DeleteRegValue HKCU "${NEXU_CONFIG_REGKEY}" "${NEXU_USER_DATA_VALUE}"
    Call CleanupNexuConfigRegistryIfEmpty
  ${Else}
    WriteRegStr HKCU "${NEXU_CONFIG_REGKEY}" "${NEXU_USER_DATA_VALUE}" "$UserDataDir"
  ${EndIf}
  StrCpy $0 "$OldUserDataDir"
  StrCpy $1 "$UserDataDir"
  Call PathsEqualIgnoreCase
  Push "install-section path-compare target=$UserDataDir old=$OldUserDataDir equal=$PathCompareResult"
  Call LogInstallerEvent
  ${If} $PathCompareResult != "1"
    StrCpy $0 "$OldUserDataDir"
    Call UpdateDirectoryNonEmptyState
  ${EndIf}
  ${If} $PathCompareResult != "1"
  ${AndIf} $OldUserDataDirIsNonEmpty == "1"
    Push "install-section write-pending source=$OldUserDataDir target=$UserDataDir strategy=$MigrationStrategy"
    Call LogInstallerEvent
    WriteRegStr HKCU "${NEXU_CONFIG_REGKEY}" "PendingUserDataMigrationSource" "$OldUserDataDir"
    WriteRegStr HKCU "${NEXU_CONFIG_REGKEY}" "PendingUserDataMigrationTarget" "$UserDataDir"
    WriteRegStr HKCU "${NEXU_CONFIG_REGKEY}" "PendingUserDataMigrationStrategy" "$MigrationStrategy"
  ${Else}
    Push "install-section clear-pending target=$UserDataDir old=$OldUserDataDir"
    Call LogInstallerEvent
    DeleteRegValue HKCU "${NEXU_CONFIG_REGKEY}" "PendingUserDataMigrationSource"
    DeleteRegValue HKCU "${NEXU_CONFIG_REGKEY}" "PendingUserDataMigrationTarget"
    DeleteRegValue HKCU "${NEXU_CONFIG_REGKEY}" "PendingUserDataMigrationStrategy"
  ${EndIf}
  DetailPrint "$(Lang_StatusInstallDone)"
  Push "install section done"
  Call LogInstallerEvent
SectionEnd

Section "Uninstall"
  DetailPrint "$(Lang_StatusUninstallStart)"
  Push "uninstall section start"
  Call un.LogInstallerEvent
  Call un.ResolveUserDataDir
  Push "uninstall section resolved-user-data=$UninstallResolvedUserDataDir delete-local-data=$UninstallDeleteLocalDataSelected"
  Call un.LogInstallerEvent
  DeleteRegValue HKCU "${NEXU_CONFIG_REGKEY}" "PendingUserDataMigrationSource"
  DeleteRegValue HKCU "${NEXU_CONFIG_REGKEY}" "PendingUserDataMigrationTarget"
  DeleteRegValue HKCU "${NEXU_CONFIG_REGKEY}" "PendingUserDataMigrationStrategy"
  Call un.CleanupNexuConfigRegistryIfEmpty
  Delete "$DESKTOP\Nexu.lnk"
  Delete "$SMPROGRAMS\Nexu\Nexu.lnk"
  Delete "$SMPROGRAMS\Nexu\Uninstall Nexu.lnk"
  RMDir "$SMPROGRAMS\Nexu"
  DeleteRegKey HKCU "${UNINSTALL_REGKEY}"
  DeleteRegKey HKCU "${PRODUCT_DIR_REGKEY}"
  Delete "$INSTDIR\Uninstall Nexu.exe"
  Call un.BuildInstallTombstonePath
  StrCpy $0 "$0"
  Rename "$INSTDIR" "$0"
  IfErrors install_dir_rename_failed
  Push "$0"
  Call un.WriteTombstoneMarker
  Push "$0"
  Call un.QueueInstallTombstoneCleanup
  Push "uninstall section renamed install dir to tombstone and queued delete"
  Call un.LogInstallerEvent
  Goto uninstall_done

install_dir_rename_failed:
  Push "$INSTDIR"
  Call un.QueueAsyncDelete
  Push "uninstall section failed to rename install dir; queued direct delete"
  Call un.LogInstallerEvent

uninstall_done:
  ${If} $UninstallDeleteLocalDataSelected == "1"
    Push "$UninstallResolvedUserDataDir"
    Call un.BuildUserDataTombstonePath
    StrCpy $1 "$0"
    StrCpy $0 "$UninstallResolvedUserDataDir"
    Rename "$0" "$1"
    IfErrors userdata_rename_failed
    DeleteRegValue HKCU "${NEXU_CONFIG_REGKEY}" "${NEXU_USER_DATA_VALUE}"
    Call un.CleanupNexuConfigRegistryIfEmpty
    DetailPrint "$(Lang_StatusQueueDeleteData)"
    Push "$1"
    Call un.WriteTombstoneMarker
    Push "$1"
    Call un.QueueUserDataTombstoneCleanup
    Push "renamed local data dir to tombstone and queued delete source=$0 tombstone=$1"
    Call un.LogInstallerEvent
    Goto uninstall_done_after_userdata

userdata_rename_failed:
    DeleteRegValue HKCU "${NEXU_CONFIG_REGKEY}" "${NEXU_USER_DATA_VALUE}"
    Call un.CleanupNexuConfigRegistryIfEmpty
    DetailPrint "$(Lang_StatusQueueDeleteData)"
    Push "$0"
    Call un.QueueAsyncDelete
    Push "failed to rename local data dir; queued direct delete source=$0"
    Call un.LogInstallerEvent
  ${EndIf}

uninstall_done_after_userdata:
SectionEnd

Function un.CleanupNexuConfigRegistryIfEmpty
  DeleteRegKey /ifempty HKCU "${NEXU_CONFIG_REGKEY}"
  DeleteRegKey /ifempty HKCU "Software\Nexu"
FunctionEnd

Function un.WriteTombstoneMarker
  Exch $0
  Push $1

  FileOpen $1 "$0\${INSTALL_TOMBSTONE_MARKER}" w
  IfErrors done
  FileWrite $1 "nexu-custom-installer tombstone$\r$\n"
  FileClose $1

done:
  Pop $1
  Pop $0
FunctionEnd

Function un.BuildInstallTombstonePath
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  Push $R0
  Push $R1

  ${GetParent} "$INSTDIR" $1
  GetTempFileName $R0
  ${GetFileName} "$R0" $R1
  Delete $R0
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
  StrCpy $R1 $R1 6
  StrCpy $0 "$1\${INSTALL_TOMBSTONE_PREFIX}$3$4$5-$6$7$8-$R1"

  Pop $R1
  Pop $R0
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

Function un.BuildUserDataTombstonePath
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  Push $R0
  Push $R1

  ${GetParent} "$0" $1
  GetTempFileName $R0
  ${GetFileName} "$R0" $R1
  Delete $R0
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
  StrCpy $R1 $R1 6
  StrCpy $0 "$1\${USERDATA_TOMBSTONE_PREFIX}$3$4$5-$6$7$8-$R1"

  Pop $R1
  Pop $R0
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

Function un.QueueInstallTombstoneCleanup
  Exch $0
  Push $1
  Push $2

  IfFileExists "$0\${INSTALL_TOMBSTONE_MARKER}" 0 done
  Push "$0"
  Call un.QueueAsyncDelete

done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

Function un.QueueUserDataTombstoneCleanup
  Exch $0
  Push $1
  Push $2

  IfFileExists "$0\${INSTALL_TOMBSTONE_MARKER}" 0 done
  Push "$0"
  Call un.QueueAsyncDelete

done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
