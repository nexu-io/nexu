!include "LogicLib.nsh"

!define NEXU_DATA_DIR_NAME "nexu-desktop"
!define NEXU_TOMBSTONE_PREFIX "nexu-desktop.tombstone-"
!define NEXU_RUNONCE_KEY "Software\Microsoft\Windows\CurrentVersion\RunOnce"
!define NEXU_RUNONCE_VALUE_PREFIX "NexuDesktopCleanup-"
!define NEXU_WSHELL "$SYSDIR\wscript.exe"
!define NEXU_CLEANUP_SCRIPT "$TEMP\nexu-desktop-cleanup.vbs"
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
  ${if} $0 == ""
    StrCpy $INSTDIR "$LOCALAPPDATA\Programs\nexu-desktop"
  ${endif}
  SetShellVarContext current
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

  Function WriteNexuCleanupScript
    Push $0

    ClearErrors
    FileOpen $0 "${NEXU_CLEANUP_SCRIPT}" w
    IfErrors done
    FileWrite $0 "On Error Resume Next$\r$\n"
    FileWrite $0 "WScript.Sleep 2000$\r$\n"
    FileWrite $0 "Dim fso$\r$\n"
    FileWrite $0 "Dim targetPath$\r$\n"
    FileWrite $0 "Set fso = CreateObject($\"Scripting.FileSystemObject$\")$\r$\n"
    FileWrite $0 "targetPath = WScript.Arguments(0)$\r$\n"
    FileWrite $0 "If fso.FolderExists(targetPath) Then fso.DeleteFolder targetPath, True$\r$\n"
    FileWrite $0 "If fso.FileExists(targetPath) Then fso.DeleteFile targetPath, True$\r$\n"
    FileClose $0

  done:
    Pop $0
  FunctionEnd

  Function QueueNexuAsyncDelete
    Exch $0
    Push $1
    Push $2

    Call WriteNexuCleanupScript
    System::Call 'kernel32::GetTickCount() i .r1'
    StrCpy $2 '"${NEXU_WSHELL}" //B //NoLogo "${NEXU_CLEANUP_SCRIPT}" "$0"'
    Exec $2
    WriteRegStr HKCU "${NEXU_RUNONCE_KEY}" "${NEXU_RUNONCE_VALUE_PREFIX}$1" $2

    Pop $2
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
    Push $0

    ClearErrors
    FileOpen $0 "${NEXU_CLEANUP_SCRIPT}" w
    IfErrors done
    FileWrite $0 "On Error Resume Next$\r$\n"
    FileWrite $0 "WScript.Sleep 2000$\r$\n"
    FileWrite $0 "Dim fso$\r$\n"
    FileWrite $0 "Dim targetPath$\r$\n"
    FileWrite $0 "Set fso = CreateObject($\"Scripting.FileSystemObject$\")$\r$\n"
    FileWrite $0 "targetPath = WScript.Arguments(0)$\r$\n"
    FileWrite $0 "If fso.FolderExists(targetPath) Then fso.DeleteFolder targetPath, True$\r$\n"
    FileWrite $0 "If fso.FileExists(targetPath) Then fso.DeleteFile targetPath, True$\r$\n"
    FileClose $0

  done:
    Pop $0
  FunctionEnd

  Function un.QueueNexuAsyncDelete
    Exch $0
    Push $1
    Push $2

    Call un.WriteNexuCleanupScript
    System::Call 'kernel32::GetTickCount() i .r1'
    StrCpy $2 '"${NEXU_WSHELL}" //B //NoLogo "${NEXU_CLEANUP_SCRIPT}" "$0"'
    Exec $2
    WriteRegStr HKCU "${NEXU_RUNONCE_KEY}" "${NEXU_RUNONCE_VALUE_PREFIX}$1" $2

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
