package com.yoinks.app.ui.settings

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.yoinks.app.data.cookies.CookieStore
import com.yoinks.app.BuildConfig
import com.yoinks.app.data.health.HealthCheck
import com.yoinks.app.data.history.HistoryRepository
import com.yoinks.app.domain.health.HealthItem
import com.yoinks.app.data.settings.SettingsRepository
import com.yoinks.app.domain.engine.MediaEngine
import com.yoinks.app.domain.errors.ErrorTranslator
import com.yoinks.app.domain.model.AppSettings
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

data class YtDlpState(val version: String? = null, val busy: Boolean = false)

data class HealthUi(val busy: Boolean = false, val items: List<HealthItem> = emptyList())

@HiltViewModel
class SettingsViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val repo: SettingsRepository,
    private val engine: MediaEngine,
    private val cookies: CookieStore,
    private val history: HistoryRepository,
    private val healthCheck: HealthCheck,
) : ViewModel() {
    private val _health = MutableStateFlow(HealthUi())
    val health: StateFlow<HealthUi> = _health.asStateFlow()

    fun runHealth() = viewModelScope.launch {
        _health.value = _health.value.copy(busy = true)
        _health.value = HealthUi(busy = false, items = healthCheck.run())
    }

    /** The results as text to paste into Discord or a GitHub issue. */
    fun healthText(): String = buildString {
        appendLine("Yoinks ${BuildConfig.VERSION_NAME} (Android) health check")
        _health.value.items.forEach { appendLine("${it.status.name}  ${it.label}: ${it.detail}") }
    }.trim()

    val settings: StateFlow<AppSettings> = repo.settings

    private val _errors = MutableStateFlow<Map<String, String>>(emptyMap())
    val errors: StateFlow<Map<String, String>> = _errors.asStateFlow()

    private val _ytdlp = MutableStateFlow(YtDlpState())
    val ytdlp: StateFlow<YtDlpState> = _ytdlp.asStateFlow()

    private val _hasCookies = MutableStateFlow(cookies.hasCookies)
    val hasCookies: StateFlow<Boolean> = _hasCookies.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    init {
        viewModelScope.launch { _ytdlp.update { it.copy(version = runCatching { engine.version() }.getOrNull()) } }
    }

    fun set(change: (AppSettings) -> AppSettings) = viewModelScope.launch {
        val result = repo.update(change)
        _errors.value = result.errors
        result.errors.values.firstOrNull()?.let { _message.value = it }
    }

    fun updateYtDlp() = viewModelScope.launch {
        _ytdlp.update { it.copy(busy = true) }
        val text = try {
            val r = engine.update()
            _ytdlp.update { it.copy(version = r.version) }
            r.message
        } catch (e: Exception) {
            ErrorTranslator.translate(e).message
        }
        _ytdlp.update { it.copy(busy = false) }
        _message.value = text
    }

    /** Keep access to a folder picked with the system folder picker. */
    fun pickFolder(uri: Uri, audio: Boolean) {
        runCatching {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
        set { if (audio) it.copy(audioFolderUri = uri.toString()) else it.copy(videoFolderUri = uri.toString()) }
    }

    fun resetFolder(audio: Boolean) = set { if (audio) it.copy(audioFolderUri = null) else it.copy(videoFolderUri = null) }

    fun importCookies(uri: Uri) = viewModelScope.launch {
        _message.value = try {
            val count = cookies.import(uri)
            set { it.copy(useCookies = true) }
            "Imported $count cookies. They stay on this phone."
        } catch (e: Exception) {
            ErrorTranslator.translate(e).message
        }
        _hasCookies.value = cookies.hasCookies
    }

    fun removeCookies() {
        cookies.clear()
        _hasCookies.value = false
        set { it.copy(useCookies = false) }
        _message.value = "Cookies removed."
    }

    fun export(uri: Uri) = viewModelScope.launch {
        _message.value = runCatching {
            withContext(Dispatchers.IO) { context.contentResolver.openOutputStream(uri)?.use { it.write(repo.export(settings.value).encodeToByteArray()) } }
            "Settings exported."
        }.getOrElse { "Could not write that file." }
    }

    fun import(uri: Uri) = viewModelScope.launch {
        val text = withContext(Dispatchers.IO) {
            runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes().takeIf { b -> b.size < 200_000 }?.decodeToString() } }.getOrNull()
        }
        if (text == null) {
            _message.value = "Could not read that file."
            return@launch
        }
        val result = repo.import(text)
        _errors.value = result.errors
        _message.value = result.errors.values.firstOrNull()?.let { "Imported, but: $it" } ?: "Settings imported."
    }

    fun reset() = viewModelScope.launch {
        repo.reset()
        _errors.value = emptyMap()
        _message.value = "Settings reset to defaults."
    }

    fun clearHistory() = viewModelScope.launch {
        history.clear()
        _message.value = "History cleared. Your files were not deleted."
    }

    fun messageShown() {
        _message.value = null
    }
}
