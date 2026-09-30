package com.yoinks.app.ui.update

import android.content.ActivityNotFoundException
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.yoinks.app.data.update.AppUpdate
import com.yoinks.app.data.update.AppUpdater
import com.yoinks.app.ui.format.Formatters
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

sealed interface UpdateState {
    data object None : UpdateState
    data class Available(val update: AppUpdate) : UpdateState
    data class Downloading(val update: AppUpdate, val progress: Float?) : UpdateState
    data class Ready(val update: AppUpdate, val apk: File) : UpdateState
    data class Failed(val update: AppUpdate) : UpdateState
}

/** Checks for a new release once per app start; "Later" hides it until the next start. */
@HiltViewModel
class UpdateViewModel @Inject constructor(val updater: AppUpdater) : ViewModel() {
    private val _state = MutableStateFlow<UpdateState>(UpdateState.None)
    val state: StateFlow<UpdateState> = _state

    init {
        viewModelScope.launch {
            runCatching { updater.check() }.getOrNull()?.let { _state.value = UpdateState.Available(it) }
        }
    }

    fun download(update: AppUpdate) {
        _state.value = UpdateState.Downloading(update, null)
        viewModelScope.launch {
            runCatching { updater.download(update) { _state.value = UpdateState.Downloading(update, it) } }
                .onSuccess { _state.value = UpdateState.Ready(update, it) }
                .onFailure { _state.value = UpdateState.Failed(update) }
        }
    }

    fun dismiss() {
        _state.value = UpdateState.None
    }
}

@Composable
fun UpdatePrompt(vm: UpdateViewModel = hiltViewModel()) {
    val state by vm.state.collectAsState()
    val context = LocalContext.current
    val install: (File) -> Unit = { apk ->
        // First time: Android sends the user to "Install unknown apps" for Yoinks;
        // tapping Install again afterwards opens the installer.
        val intent = if (vm.updater.canInstall()) vm.updater.installIntent(apk) else vm.updater.allowInstallsIntent()
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            vm.dismiss()
        }
    }

    when (val s = state) {
        UpdateState.None -> Unit
        is UpdateState.Available -> UpdateDialog(
            title = "Yoinks ${s.update.version} is available",
            text = "Download the update (${Formatters.bytes(s.update.sizeBytes)}) and install it?",
            confirm = "Update" to { vm.download(s.update) },
            onLater = vm::dismiss,
        )
        is UpdateState.Downloading -> UpdateDialog(
            title = "Downloading Yoinks ${s.update.version}…",
            progress = s.progress ?: -1f,
            onLater = vm::dismiss,
        )
        is UpdateState.Ready -> UpdateDialog(
            title = "Yoinks ${s.update.version} is ready",
            text = "Tap Install. If Android asks, allow Yoinks to install apps, then come back and tap Install again.",
            confirm = "Install" to { install(s.apk) },
            onLater = vm::dismiss,
        )
        is UpdateState.Failed -> UpdateDialog(
            title = "Update failed",
            text = "Could not download Yoinks ${s.update.version}. Check your connection and try again.",
            confirm = "Try again" to { vm.download(s.update) },
            onLater = vm::dismiss,
        )
    }
}

@Composable
private fun UpdateDialog(title: String, text: String? = null, progress: Float? = null, confirm: Pair<String, () -> Unit>? = null, onLater: () -> Unit) {
    AlertDialog(
        onDismissRequest = onLater,
        title = { Text(title) },
        text = {
            Column {
                text?.let { Text(it) }
                if (progress != null) {
                    Spacer(Modifier.height(12.dp))
                    if (progress < 0f) LinearProgressIndicator(Modifier.fillMaxWidth())
                    else LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth())
                }
            }
        },
        confirmButton = { confirm?.let { (label, action) -> TextButton(onClick = action) { Text(label) } } },
        dismissButton = { TextButton(onClick = onLater) { Text("Later") } },
    )
}
