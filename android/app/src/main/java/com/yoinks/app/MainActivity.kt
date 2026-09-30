package com.yoinks.app

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.windowsizeclass.ExperimentalMaterial3WindowSizeClassApi
import androidx.compose.material3.windowsizeclass.calculateWindowSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.lifecycle.lifecycleScope
import com.yoinks.app.data.settings.SettingsRepository
import com.yoinks.app.domain.model.AppSettings
import com.yoinks.app.ui.legal.TermsGate
import com.yoinks.app.ui.share.SheetActions
import com.yoinks.app.ui.share.ShareSheetHost
import com.yoinks.app.ui.share.ShareViewModel
import com.yoinks.app.ui.shell.Destination
import com.yoinks.app.ui.shell.YoinksShell
import com.yoinks.app.ui.theme.YoinksTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * The only activity. Receives links from the share sheet (ACTION_SEND) and
 * from "Open with Yoinks" (ACTION_VIEW), also while already open (singleTask
 * -> onNewIntent), and hosts the adaptive UI.
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private val share: ShareViewModel by viewModels()
    @Inject lateinit var settingsRepo: SettingsRepository

    private val destination = MutableStateFlow(Destination.HOME)

    @OptIn(ExperimentalMaterial3WindowSizeClassApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) handle(intent)

        setContent {
            val settings by settingsRepo.settings.collectAsState()
            val loaded by settingsRepo.loaded.collectAsState()
            val widthClass = calculateWindowSizeClass(this).widthSizeClass
            YoinksTheme(settings) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    when {
                        !loaded -> Unit // stored settings not read yet: avoid flashing the wrong screen
                        settings.termsAccepted < AppSettings.TERMS_VERSION -> FirstRun()
                        else -> Main(widthClass)
                    }
                }
            }
        }
    }

    @Composable
    private fun FirstRun() {
        val scope = rememberCoroutineScope()
        // Ask for what Android needs once, right after accepting.
        val permissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { share.resumePending() }
        TermsGate(onAccept = {
            scope.launch {
                settingsRepo.update { it.copy(termsAccepted = AppSettings.TERMS_VERSION) }
                val needed = buildList {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
                    // Android 8–9 only: saving to Movies/Music needs the old storage permission.
                    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                }
                if (needed.isEmpty()) share.resumePending() else permissions.launch(needed.toTypedArray())
            }
        })
    }

    @Composable
    private fun Main(widthClass: androidx.compose.material3.windowsizeclass.WindowWidthSizeClass) {
        val snackbar = remember { SnackbarHostState() }
        val sheet by share.sheet.collectAsState()
        val message by share.message.collectAsState()
        val current by destination.collectAsState()

        LaunchedEffect(message) {
            message?.let {
                share.messageShown()
                snackbar.showSnackbar(it.text, duration = SnackbarDuration.Short)
            }
        }

        // Optional: offer a link found on the clipboard when the app gets focus.
        val focused = LocalWindowInfo.current.isWindowFocused
        val clipboard = LocalClipboardManager.current
        LaunchedEffect(focused) {
            if (!focused) return@LaunchedEffect
            val url = share.onClipboard(clipboard.getText()?.text) ?: return@LaunchedEffect
            val result = snackbar.showSnackbar("Copied link found: $url", actionLabel = "Yoink", duration = SnackbarDuration.Long)
            if (result == SnackbarResult.ActionPerformed) share.onIncoming(url, fromShare = false)
        }

        YoinksShell(widthClass, share, snackbar, current, onDestination = { destination.value = it })
        ShareSheetHost(
            sheet,
            SheetActions(
                close = share::close,
                download = share::download,
                wholePlaylist = share::wholePlaylist,
                downloadSpotify = share::downloadSpotify,
                retry = share::retry,
            ),
        )
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        intent ?: return
        when (intent.action) {
            Intent.ACTION_SEND -> if (intent.type?.startsWith("text/") == true) {
                // Captions often come with the link ("Look at this! https://vm.tiktok.com/…").
                val text = listOfNotNull(intent.getStringExtra(Intent.EXTRA_TEXT), intent.getStringExtra(Intent.EXTRA_SUBJECT)).joinToString(" ")
                share.onIncoming(text, fromShare = true)
            }
            Intent.ACTION_VIEW -> intent.dataString?.let { share.onIncoming(it, fromShare = true) }
        }
        intent.getStringExtra(EXTRA_DESTINATION)?.let { name ->
            Destination.entries.firstOrNull { it.name == name }?.let { lifecycleScope.launch { destination.value = it } }
        }
    }

    companion object {
        const val EXTRA_DESTINATION = "com.yoinks.app.DESTINATION"
        const val DEST_QUEUE = "QUEUE"
    }
}
