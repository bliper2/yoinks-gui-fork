package com.yoinks.app.ui.settings

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings as AndroidSettings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.PreviewScreenSizes
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import com.yoinks.app.domain.format.FilenameTemplate
import com.yoinks.app.domain.model.AccentPreset
import com.yoinks.app.domain.model.AppSettings
import com.yoinks.app.domain.model.AudioBitrate
import com.yoinks.app.domain.model.AudioFormat
import com.yoinks.app.domain.model.DefaultFormat
import com.yoinks.app.domain.model.ShareBehavior
import com.yoinks.app.domain.model.ThemeMode
import com.yoinks.app.ui.components.ColorPickerDialog
import com.yoinks.app.ui.theme.YoinksTheme

/** Everything the settings screen can ask for. */
class SettingsCallbacks(
    val set: ((AppSettings) -> AppSettings) -> Unit,
    val pickFolder: (audio: Boolean) -> Unit,
    val resetFolder: (audio: Boolean) -> Unit,
    val updateYtDlp: () -> Unit,
    val importCookies: () -> Unit,
    val removeCookies: () -> Unit,
    val exportSettings: () -> Unit,
    val importSettings: () -> Unit,
    val reset: () -> Unit,
    val clearHistory: () -> Unit,
    val requestNotifications: () -> Unit,
    val openBattery: () -> Unit,
    val openLegal: (LegalPage) -> Unit,
)

enum class LegalPage { ABOUT, TERMS, PRIVACY }

data class SettingsUi(
    val settings: AppSettings,
    val errors: Map<String, String> = emptyMap(),
    val ytdlp: YtDlpState = YtDlpState(),
    val hasCookies: Boolean = false,
    val notificationsAllowed: Boolean = true,
)

@Composable
fun SettingsRoute(openLegal: (LegalPage) -> Unit, onMessage: (String) -> Unit, vm: SettingsViewModel = hiltViewModel()) {
    val settings by vm.settings.collectAsState()
    val errors by vm.errors.collectAsState()
    val ytdlp by vm.ytdlp.collectAsState()
    val hasCookies by vm.hasCookies.collectAsState()
    val message by vm.message.collectAsState()
    val context = LocalContext.current
    var notificationsAllowed by remember { mutableStateOf(notificationsGranted(context)) }

    LaunchedEffect(message) {
        message?.let {
            onMessage(it)
            vm.messageShown()
        }
    }

    var pickingAudio by rememberSaveable { mutableStateOf(false) }
    val folderPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri -> uri?.let { vm.pickFolder(it, pickingAudio) } }
    val cookiePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let(vm::importCookies) }
    val exporter = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri -> uri?.let(vm::export) }
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let(vm::import) }
    val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { notificationsAllowed = it }

    SettingsScreen(
        ui = SettingsUi(settings, errors, ytdlp, hasCookies, notificationsAllowed),
        callbacks = SettingsCallbacks(
            set = { vm.set(it) },
            pickFolder = { audio -> pickingAudio = audio; folderPicker.launch(null) },
            resetFolder = { vm.resetFolder(it) },
            updateYtDlp = { vm.updateYtDlp() },
            importCookies = { cookiePicker.launch(arrayOf("text/plain", "text/*", "application/octet-stream")) },
            removeCookies = vm::removeCookies,
            exportSettings = { exporter.launch("yoinks-settings.json") },
            importSettings = { importer.launch(arrayOf("application/json", "text/plain", "*/*")) },
            reset = { vm.reset() },
            clearHistory = { vm.clearHistory() },
            requestNotifications = {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            },
            openBattery = {
                runCatching { context.startActivity(Intent(AndroidSettings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
            },
            openLegal = openLegal,
        ),
    )
}

private fun notificationsGranted(context: android.content.Context) =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

@Composable
fun SettingsScreen(ui: SettingsUi, callbacks: SettingsCallbacks, modifier: Modifier = Modifier) {
    val s = ui.settings
    val set = callbacks.set
    var confirm by remember { mutableStateOf<String?>(null) }
    var picker by remember { mutableStateOf(false) }

    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
        Text("Settings", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(16.dp))
        Column(Modifier.widthIn(max = 840.dp)) {
            SettingsGroup("Look") {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Theme", style = MaterialTheme.typography.bodyLarge)
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                        ThemeMode.entries.forEachIndexed { i, mode ->
                            SegmentedButton(
                                selected = s.themeMode == mode,
                                onClick = { set { it.copy(themeMode = mode) } },
                                shape = SegmentedButtonDefaults.itemShape(i, ThemeMode.entries.size),
                            ) { Text(mode.name.lowercase().replaceFirstChar(Char::uppercase)) }
                        }
                    }
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    SwitchRow("Material You colors", s.dynamicColor, { v -> set { it.copy(dynamicColor = v) } }, "Use colors from your wallpaper")
                }
                SwitchRow("AMOLED black", s.amoledBlack, { v -> set { it.copy(amoledBlack = v) } }, "Pure black backgrounds in dark mode")
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Accent color" + if (s.dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) " (turn off Material You to use it)" else "", style = MaterialTheme.typography.bodyLarge)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        AccentPreset.entries.forEach { preset ->
                            val color = Color(if (preset == AccentPreset.CUSTOM) s.customAccent else preset.argb)
                            Swatch(color, preset.label, selected = s.accent == preset) {
                                if (preset == AccentPreset.CUSTOM) picker = true else set { it.copy(accent = preset) }
                            }
                        }
                    }
                }
            }

            SettingsGroup("Downloads") {
                ActionRow("Video folder", s.videoFolderUri?.let(::folderName) ?: "Movies/Yoinks (default)", onClick = { callbacks.pickFolder(false) }) {
                    if (s.videoFolderUri != null) TextActionButton("Default", { callbacks.resetFolder(false) })
                }
                ActionRow("Music folder", s.audioFolderUri?.let(::folderName) ?: "Music/Yoinks (default)", onClick = { callbacks.pickFolder(true) }) {
                    if (s.audioFolderUri != null) TextActionButton("Default", { callbacks.resetFolder(true) })
                }
                ChoiceRow("Default format", DefaultFormat.entries, s.defaultFormat, { it.label }, { v -> set { it.copy(defaultFormat = v) } }, "Music apps always default to audio")
                SwitchRow("Always use the default format", s.alwaysUseFormat, { v -> set { it.copy(alwaysUseFormat = v) } }, "Skip the quality list and start at once")
                TemplateEditor(s, ui.errors["filenameTemplate"], set)
            }

            SettingsGroup("Audio") {
                ChoiceRow("Audio format", AudioFormat.entries, s.audioFormat, { it.label }, { v -> set { it.copy(audioFormat = v) } })
                ChoiceRow("Bitrate", AudioBitrate.entries, s.audioBitrate, { it.label }, { v -> set { it.copy(audioBitrate = v) } }, if (s.audioFormat == AudioFormat.FLAC) "FLAC is lossless" else null)
            }

            SettingsGroup("Tags and extras") {
                SwitchRow("Save title, artist, album and chapters", s.embedMetadata, { v -> set { it.copy(embedMetadata = v) } })
                SwitchRow("Add cover art", s.embedThumbnail, { v -> set { it.copy(embedThumbnail = v) } })
                SwitchRow("Add subtitles to videos", s.embedSubs, { v -> set { it.copy(embedSubs = v) } })
                if (s.embedSubs) {
                    var lang by remember(s.subsLang) { mutableStateOf(s.subsLang) }
                    OutlinedTextField(
                        value = lang,
                        onValueChange = { lang = it; set { st -> st.copy(subsLang = it) } },
                        label = { Text("Subtitle language (en, de, pt-BR, all)") },
                        isError = ui.errors.containsKey("subsLang"),
                        supportingText = ui.errors["subsLang"]?.let { { Text(it) } },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                    )
                }
                SwitchRow("TikTok without watermark", s.tiktokNoWatermark, { v -> set { it.copy(tiktokNoWatermark = v) } }, "When TikTok offers a clean copy")
            }

            SettingsGroup("Playlists") {
                SwitchRow("Own folder per playlist or album", s.playlistFolder, { v -> set { it.copy(playlistFolder = v) } })
                SwitchRow("Number the files (001, 002, …)", s.playlistNumbered, { v -> set { it.copy(playlistNumbered = v) } })
            }

            SettingsGroup("Queue") {
                SliderRow("Downloads at the same time", s.concurrency, 1..5, { v -> set { it.copy(concurrency = v) } })
                SliderRow("Retry failed downloads", s.retries, 0..10, { v -> set { it.copy(retries = v) } }, { if (it == 0) "Off" else "$it×" })
                var speed by remember(s.speedLimitMbps) { mutableStateOf(if (s.speedLimitMbps == 0f) "" else s.speedLimitMbps.toString()) }
                OutlinedTextField(
                    value = speed,
                    onValueChange = { text -> speed = text; text.ifBlank { "0" }.toFloatOrNull()?.let { v -> set { it.copy(speedLimitMbps = v) } } },
                    label = { Text("Speed limit per download (MB/s, blank = none)") },
                    isError = ui.errors.containsKey("speedLimitMbps"),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
                )
                SwitchRow("Wi-Fi only", s.wifiOnly, { v -> set { it.copy(wifiOnly = v) } }, "Wait for Wi-Fi before downloading")
                SwitchRow("Notifications", s.notifications, { v -> set { it.copy(notifications = v) } }, "When a download finishes or fails")
                if (!ui.notificationsAllowed) {
                    ActionRow("Allow notifications", "Android is blocking Yoinks' notifications", onClick = callbacks.requestNotifications)
                }
                ActionRow("Battery optimization", "Set Yoinks to Unrestricted so long downloads are not stopped", onClick = callbacks.openBattery)
            }

            SettingsGroup("Sharing") {
                ShareBehavior.entries.forEach { behavior ->
                    Row(
                        Modifier.fillMaxWidth().selectable(s.shareBehavior == behavior, role = Role.RadioButton) { set { it.copy(shareBehavior = behavior) } }
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        androidx.compose.material3.RadioButton(selected = s.shareBehavior == behavior, onClick = null)
                        Text(behavior.label)
                    }
                }
                SwitchRow(
                    "Look for links on the clipboard",
                    s.clipboardDetection,
                    { v -> set { it.copy(clipboardDetection = v) } },
                    "When you open Yoinks, offer a link you copied. Off by default: the clipboard is only read while Yoinks is open, and only on this phone.",
                )
            }

            SettingsGroup("yt-dlp") {
                ActionRow(
                    "Version",
                    when {
                        ui.ytdlp.busy -> "Updating…"
                        ui.ytdlp.version != null -> ui.ytdlp.version
                        else -> "Starting…"
                    },
                    onClick = callbacks.updateYtDlp,
                ) { TextActionButton("Update now", callbacks.updateYtDlp, enabled = !ui.ytdlp.busy) }
                SwitchRow("Update automatically", s.ytdlpAutoUpdate, { v -> set { it.copy(ytdlpAutoUpdate = v) } }, "Sites change often; old versions stop working")
                if (s.ytdlpAutoUpdate) {
                    ChoiceRow("Check every", listOf(1, 7, 30), s.ytdlpUpdateDays, { mapOf(1 to "Day", 7 to "Week", 30 to "Month").getValue(it) }, { v -> set { it.copy(ytdlpUpdateDays = v) } })
                }
                ActionRow(
                    if (ui.hasCookies) "Replace cookies file" else "Import cookies (optional)",
                    "For age-restricted or members-only videos. Export cookies.txt from a browser where you are signed in.",
                    onClick = callbacks.importCookies,
                ) { if (ui.hasCookies) TextActionButton("Remove", callbacks.removeCookies) }
                if (ui.hasCookies) SwitchRow("Use cookies", s.useCookies, { v -> set { it.copy(useCookies = v) } })
                Text(
                    "Privacy: the cookies file stays inside Yoinks on this phone. yt-dlp sends each cookie only to its own site so it treats you as signed in. Anyone with the file can use those accounts, so remove it when you no longer need it.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }

            SettingsGroup("Your data") {
                ActionRow("Export settings", "Save them as a JSON file", onClick = callbacks.exportSettings)
                ActionRow("Import settings", "Load a JSON export", onClick = callbacks.importSettings)
                ActionRow("Clear history", "Your files are not deleted", onClick = { confirm = "history" })
                ActionRow("Reset to defaults", onClick = { confirm = "reset" })
            }

            SettingsGroup("About") {
                ActionRow("About Yoinks", "Version, open-source licenses", onClick = { callbacks.openLegal(LegalPage.ABOUT) })
                ActionRow("Terms of use", onClick = { callbacks.openLegal(LegalPage.TERMS) })
                ActionRow("Privacy", onClick = { callbacks.openLegal(LegalPage.PRIVACY) })
            }
        }
    }

    if (picker) {
        ColorPickerDialog(s.customAccent, onDismiss = { picker = false }) { color ->
            set { it.copy(accent = AccentPreset.CUSTOM, customAccent = color) }
            picker = false
        }
    }
    confirm?.let { what ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text(if (what == "reset") "Reset all settings?" else "Clear history?") },
            text = { Text(if (what == "reset") "Every setting goes back to its default." else "The list of downloads is cleared. Your files stay on the phone.") },
            confirmButton = {
                TextButton(onClick = {
                    if (what == "reset") callbacks.reset() else callbacks.clearHistory()
                    confirm = null
                }) { Text(if (what == "reset") "Reset" else "Clear") }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun TemplateEditor(s: AppSettings, error: String?, set: ((AppSettings) -> AppSettings) -> Unit) {
    var text by remember(s.filenameTemplate) { mutableStateOf(s.filenameTemplate) }
    val video = FilenameTemplate.preview(text, "mp4")
    val audio = FilenameTemplate.preview(text, s.audioFormat.ext)
    val list = FilenameTemplate.preview(text, s.audioFormat.ext, playlist = true, folder = s.playlistFolder, numbered = s.playlistNumbered)
    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it; if (FilenameTemplate.validate(it) == null) set { st -> st.copy(filenameTemplate = it) } },
            label = { Text("File name") },
            isError = video.isFailure || error != null,
            supportingText = { Text(video.exceptionOrNull()?.message ?: error ?: "Preview updates as you type") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            FilenameTemplate.tokenNames.forEach { token ->
                AssistChip(onClick = {
                    text += "{$token}"
                    if (FilenameTemplate.validate(text) == null) set { st -> st.copy(filenameTemplate = text) }
                }, label = { Text("{$token}") })
            }
        }
        listOf(video, audio, list).mapNotNull { it.getOrNull() }.forEach {
            Text("↳ $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun Swatch(color: Color, label: String, selected: Boolean, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            Modifier
                .size(48.dp)
                .selectable(selected = selected, role = Role.RadioButton, onClick = onClick)
                .semantics { contentDescription = "$label accent" }
                .background(color, CircleShape)
                .then(if (selected) Modifier.border(3.dp, MaterialTheme.colorScheme.onSurface, CircleShape) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            if (selected) Icon(Icons.Rounded.Check, contentDescription = null, tint = Color.White)
        }
        Text(label, style = MaterialTheme.typography.labelSmall)
    }
}

private fun folderName(uri: String): String =
    Uri.decode(uri).substringAfterLast(':').ifBlank { "Chosen folder" }

private val previewCallbacks = SettingsCallbacks({}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {})

@PreviewScreenSizes
@Composable
internal fun SettingsPreview() = YoinksTheme {
    Surface { SettingsScreen(SettingsUi(AppSettings(), ytdlp = YtDlpState("2026.08.19")), previewCallbacks) }
}
