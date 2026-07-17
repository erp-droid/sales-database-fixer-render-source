Unicode True

!include "MUI2.nsh"

!define APP_NAME "MeadowBrook CRM"
!define APP_VERSION "1.0.1"
!define APP_PUBLISHER "MeadowBrook"
!define APP_URL "https://sales-meadowb.onrender.com/accounts"
!define APP_REG_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\MeadowBrook CRM"

Name "${APP_NAME}"
OutFile "../../public/downloads/MeadowBrook-CRM-Setup.exe"
InstallDir "$LOCALAPPDATA\MeadowBrook CRM"
InstallDirRegKey HKCU "${APP_REG_KEY}" "InstallLocation"
RequestExecutionLevel user

SetCompressor /SOLID lzma
Icon "MeadowBrook-CRM.ico"
UninstallIcon "MeadowBrook-CRM.ico"
BrandingText "MeadowBrook CRM"

VIProductVersion "1.0.1.0"
VIAddVersionKey /LANG=1033 "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "CompanyName" "${APP_PUBLISHER}"
VIAddVersionKey /LANG=1033 "FileDescription" "MeadowBrook CRM Windows Installer"
VIAddVersionKey /LANG=1033 "LegalCopyright" "MeadowBrook"

!define MUI_ABORTWARNING
!define MUI_ICON "MeadowBrook-CRM.ico"
!define MUI_UNICON "MeadowBrook-CRM.ico"
!define MUI_FINISHPAGE_TITLE "MeadowBrook CRM is ready"
!define MUI_FINISHPAGE_TEXT "Setup has finished installing MeadowBrook CRM on your computer."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open MeadowBrook CRM"
!define MUI_FINISHPAGE_RUN_FUNCTION "LaunchMeadowBrookCRM"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Var ChromePath

Function FindChrome
  StrCpy $ChromePath ""

  ReadRegStr $ChromePath HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" ""
  StrCmp $ChromePath "" 0 chrome_found

  SetRegView 64
  ReadRegStr $ChromePath HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" ""
  StrCmp $ChromePath "" 0 chrome_found

  SetRegView 32
  ReadRegStr $ChromePath HKLM "Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" ""
  StrCmp $ChromePath "" 0 chrome_found

  IfFileExists "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe" 0 +3
    StrCpy $ChromePath "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    Goto chrome_found

  IfFileExists "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe" 0 +3
    StrCpy $ChromePath "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe"
    Goto chrome_found

  IfFileExists "$PROGRAMFILES32\Google\Chrome\Application\chrome.exe" 0 chrome_not_found
    StrCpy $ChromePath "$PROGRAMFILES32\Google\Chrome\Application\chrome.exe"
    Goto chrome_found

chrome_not_found:
  StrCpy $ChromePath ""

chrome_found:
FunctionEnd

Function LaunchMeadowBrookCRM
  ExecShell "open" "$DESKTOP\MeadowBrook CRM.lnk"
FunctionEnd

Function .onInit
  SetShellVarContext current
  Call FindChrome
  StrCmp $ChromePath "" 0 chrome_ready
    MessageBox MB_OK|MB_ICONSTOP "Google Chrome must be installed before installing MeadowBrook CRM.$\r$\n$\r$\nDownload Chrome from https://www.google.com/chrome/ and run this setup again."
    Abort
chrome_ready:
FunctionEnd

Section "MeadowBrook CRM" MainSection
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /oname=MeadowBrook-CRM.ico "MeadowBrook-CRM.ico"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateShortcut \
    "$DESKTOP\MeadowBrook CRM.lnk" \
    "$ChromePath" \
    '--app="${APP_URL}"' \
    "$INSTDIR\MeadowBrook-CRM.ico" \
    0 \
    SW_SHOWNORMAL \
    "" \
    "Open MeadowBrook CRM in Google Chrome"

  CreateDirectory "$SMPROGRAMS\MeadowBrook CRM"
  CreateShortcut \
    "$SMPROGRAMS\MeadowBrook CRM\MeadowBrook CRM.lnk" \
    "$ChromePath" \
    '--app="${APP_URL}"' \
    "$INSTDIR\MeadowBrook-CRM.ico" \
    0 \
    SW_SHOWNORMAL \
    "" \
    "Open MeadowBrook CRM in Google Chrome"
  CreateShortcut "$SMPROGRAMS\MeadowBrook CRM\Uninstall MeadowBrook CRM.lnk" "$INSTDIR\Uninstall.exe"

  SetRegView 64
  WriteRegStr HKCU "${APP_REG_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${APP_REG_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${APP_REG_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${APP_REG_KEY}" "DisplayIcon" "$INSTDIR\MeadowBrook-CRM.ico"
  WriteRegStr HKCU "${APP_REG_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${APP_REG_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${APP_REG_KEY}" "URLInfoAbout" "${APP_URL}"
  WriteRegDWORD HKCU "${APP_REG_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${APP_REG_KEY}" "NoRepair" 1

SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\MeadowBrook CRM.lnk"
  Delete "$SMPROGRAMS\MeadowBrook CRM\MeadowBrook CRM.lnk"
  Delete "$SMPROGRAMS\MeadowBrook CRM\Uninstall MeadowBrook CRM.lnk"
  RMDir "$SMPROGRAMS\MeadowBrook CRM"

  Delete "$INSTDIR\MeadowBrook-CRM.ico"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  SetRegView 64
  DeleteRegKey HKCU "${APP_REG_KEY}"
SectionEnd
