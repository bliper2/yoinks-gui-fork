; Extra steps for the Yoinks installer (electron-builder NSIS include).
; The app registers its browser-extension helper per user when it starts
; (main/helper.js); uninstalling must take those entries away again.

!macro customUnInstall
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.yoinks.host"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.yoinks.host"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.yoinks.host"
  DeleteRegKey HKCU "Software\Mozilla\NativeMessagingHosts\com.yoinks.host"
  DeleteRegKey HKCU "Software\Waterfox\NativeMessagingHosts\com.yoinks.host"
  RMDir /r "$APPDATA\yoinks-gui\helper"
  RMDir /r "$APPDATA\${APP_FILENAME}\helper"
!macroend
