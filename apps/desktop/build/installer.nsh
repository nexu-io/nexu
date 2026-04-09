!include "LogicLib.nsh"
!include "WordFunc.nsh"

!define NEXU_DATA_DIR_NAME "nexu-desktop"
!define NEXU_TOMBSTONE_PREFIX "nexu-desktop.tombstone-"
!define NEXU_RUNONCE_KEY "Software\Microsoft\Windows\CurrentVersion\RunOnce"
!define NEXU_RUNONCE_VALUE_PREFIX "NexuDesktopCleanup-"
!define NEXU_WSHELL "$SYSDIR\wscript.exe"
!define NEXU_INSTALLER_LOG "$TEMP\nexu-installer-debug.log"

!macro preInit
  System::Call 'kernel32::GetTickCount() i .r0'
  FileOpen $1 "${NEXU_INSTALLER_LOG}" a
  IfErrors +2
  FileWrite $1 "$0ms | preInit entered$\r$\n"
  IfErrors +2
  FileClose $1
!macroend

!macro customInit
  Push "customInit entered"
  Call LogNexuInstallerEvent
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $1 HKCU "${INSTALL_REGISTRY_KEY}" DisplayVersion
  ${if} $0 == ""
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\nexu-desktop"
  ${else}
    StrCpy $INSTDIR "$0"
  ${endif}
  SetShellVarContext current
  Call EnsureNexuNotRunning
  ${if} $1 != ""
    Push $1
    Call ConfirmExistingInstallAction
  ${endif}
  Call CleanupPriorNexuDataTombstones
  Push "customInit leaving"
  Call LogNexuInstallerEvent
!macroend

!macro customInstall
  Push "customInstall entered"
  Call LogNexuInstallerEvent
!macroend

!macro customUnInstallSection
  Section /o "un.Delete local data (%APPDATA%\\nexu-desktop)"
    SetShellVarContext current
    Call un.TryQueueNexuDataDeletion
  SectionEnd
!macroend

!ifndef BUILD_UNINSTALLER
  Function LogNexuInstallerEvent
    Exch $0
    Push $1
    Push $2

    System::Call 'kernel32::GetTickCount() i .r1'
    FileOpen $2 "${NEXU_INSTALLER_LOG}" a
    IfErrors done
    FileWrite $2 "$1ms | $0$\r$\n"
    FileClose $2

  done:
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd

  Function .onInstSuccess
    Push "install complete"
    Call LogNexuInstallerEvent
  FunctionEnd

  Function WriteNexuCleanupScript
    Exch $0
    Push $1

    ClearErrors
    FileOpen $1 "$0" w
    IfErrors done
    FileWrite $1 "On Error Resume Next$\r$\n"
    FileWrite $1 "WScript.Sleep 2000$\r$\n"
    FileWrite $1 "Dim fso$\r$\n"
    FileWrite $1 "Dim targetPath$\r$\n"
    FileWrite $1 "Set fso = CreateObject($\"Scripting.FileSystemObject$\")$\r$\n"
    FileWrite $1 "targetPath = WScript.Arguments(0)$\r$\n"
    FileWrite $1 "If fso.FolderExists(targetPath) Then fso.DeleteFolder targetPath, True$\r$\n"
    FileWrite $1 "If fso.FileExists(targetPath) Then fso.DeleteFile targetPath, True$\r$\n"
    FileClose $1

  done:
    Pop $1
    Pop $0
  FunctionEnd

  Function QueueNexuAsyncDelete
    Exch $0
    Push $1
    Push $2
    Push $3
    Push $4

    System::Call 'kernel32::GetTempFileNameW(w "$TEMP", w "nxd", i 0, w .r3) i .r4'
    Push $3
    Call WriteNexuCleanupScript
    System::Call 'kernel32::GetTickCount() i .r1'
    StrCpy $2 '"${NEXU_WSHELL}" //B //NoLogo "$3" "$0"'
    Exec $2
    ${WordFind} "$3" "\" "-1" $4
    WriteRegStr HKCU "${NEXU_RUNONCE_KEY}" "${NEXU_RUNONCE_VALUE_PREFIX}$1-$4" $2

    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd

  Function EnsureNexuNotRunning
    Push $0
    Push $1
    Push $2

    Push "EnsureNexuNotRunning start"
    Call LogNexuInstallerEvent

  retry:
    nsExec::ExecToStack '"$SYSDIR\tasklist.exe" /FI "IMAGENAME eq Nexu.exe" /NH'
    Pop $0
    Pop $1
    StrCpy $2 $1 8

    ${If} $0 == "0"
    ${AndIf} $2 == "Nexu.exe"
      Push "Nexu process detected during install init"
      Call LogNexuInstallerEvent
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Nexu is currently running.$\r$\n$\r$\nPlease quit the app before continuing the installation." /SD IDCANCEL IDRETRY retry
      Abort
    ${EndIf}

    Push "EnsureNexuNotRunning done"
    Call LogNexuInstallerEvent

    Pop $2
    Pop $1
    Pop $0
  FunctionEnd

  Function ConfirmExistingInstallAction
    Exch $0
    Push $1

    ${If} $0 == ""
      Goto done
    ${EndIf}

    ${VersionCompare} "$0" "${VERSION}" $1

    ${If} $1 == 1
      Push "Blocking downgrade install: installed=$0 installer=${VERSION}"
      Call LogNexuInstallerEvent
      MessageBox MB_OK|MB_ICONSTOP "A newer version of Nexu ($0) is already installed at:$\r$\n$INSTDIR$\r$\n$\r$\nThis installer contains ${VERSION}. Downgrading is blocked by default." /SD IDOK
      Abort
    ${ElseIf} $1 == 0
      Push "Prompting same-version reinstall confirmation: version=$0"
      Call LogNexuInstallerEvent
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "Nexu $0 is already installed at:$\r$\n$INSTDIR$\r$\n$\r$\nContinuing will repair or reinstall the existing app." /SD IDCANCEL IDOK done
      Abort
    ${Else}
      Push "Prompting upgrade confirmation: installed=$0 installer=${VERSION}"
      Call LogNexuInstallerEvent
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "Nexu $0 is already installed at:$\r$\n$INSTDIR$\r$\n$\r$\nContinuing will upgrade the existing installation to ${VERSION}." /SD IDCANCEL IDOK done
      Abort
    ${EndIf}

  done:
    Pop $1
    Pop $0
  FunctionEnd

  Function CleanupPriorNexuDataTombstones
    Push $0
    Push $1

    Push "CleanupPriorNexuDataTombstones start"
    Call LogNexuInstallerEvent

    FindFirst $0 $1 "$APPDATA\${NEXU_TOMBSTONE_PREFIX}*"
    loop:
      StrCmp $1 "" done
      IfFileExists "$APPDATA\$1\*.*" queue 0
      IfFileExists "$APPDATA\$1\." queue next
    queue:
      Push "$APPDATA\$1"
      Call QueueNexuAsyncDelete
    next:
      FindNext $0 $1
      Goto loop
    done:
      FindClose $0

    Push "CleanupPriorNexuDataTombstones done"
    Call LogNexuInstallerEvent

    Pop $1
    Pop $0
  FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
  Function un.WriteNexuCleanupScript
    Exch $0
    Push $1

    ClearErrors
    FileOpen $1 "$0" w
    IfErrors done
    FileWrite $1 "On Error Resume Next$\r$\n"
    FileWrite $1 "WScript.Sleep 2000$\r$\n"
    FileWrite $1 "Dim fso$\r$\n"
    FileWrite $1 "Dim targetPath$\r$\n"
    FileWrite $1 "Set fso = CreateObject($\"Scripting.FileSystemObject$\")$\r$\n"
    FileWrite $1 "targetPath = WScript.Arguments(0)$\r$\n"
    FileWrite $1 "If fso.FolderExists(targetPath) Then fso.DeleteFolder targetPath, True$\r$\n"
    FileWrite $1 "If fso.FileExists(targetPath) Then fso.DeleteFile targetPath, True$\r$\n"
    FileClose $1

  done:
    Pop $1
    Pop $0
  FunctionEnd

  Function un.QueueNexuAsyncDelete
    Exch $0
    Push $1
    Push $2
    Push $3
    Push $4

    System::Call 'kernel32::GetTempFileNameW(w "$TEMP", w "nxd", i 0, w .r3) i .r4'
    Push $3
    Call un.WriteNexuCleanupScript
    System::Call 'kernel32::GetTickCount() i .r1'
    StrCpy $2 '"${NEXU_WSHELL}" //B //NoLogo "$3" "$0"'
    Exec $2
    ${WordFind} "$3" "\" "-1" $4
    WriteRegStr HKCU "${NEXU_RUNONCE_KEY}" "${NEXU_RUNONCE_VALUE_PREFIX}$1-$4" $2

    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Pop $0
  FunctionEnd

  Function un.TryQueueNexuDataDeletion
    Push $0
    Push $1

    IfFileExists "$APPDATA\${NEXU_DATA_DIR_NAME}\*.*" data_exists 0
    IfFileExists "$APPDATA\${NEXU_DATA_DIR_NAME}" data_exists done

    data_exists:
      System::Call 'kernel32::GetTickCount() i .r0'
      StrCpy $1 "$APPDATA\${NEXU_TOMBSTONE_PREFIX}$0"
      ClearErrors
      Rename "$APPDATA\${NEXU_DATA_DIR_NAME}" "$1"
      IfErrors rename_failed rename_done

    rename_failed:
      DetailPrint "Could not detach local data; leaving it in place."
      Goto done

    rename_done:
      Push "$1"
      Call un.QueueNexuAsyncDelete

    done:
      Pop $1
      Pop $0
  FunctionEnd
!endif
