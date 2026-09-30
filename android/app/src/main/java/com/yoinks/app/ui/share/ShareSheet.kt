package com.yoinks.app.ui.share

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.PlaylistPlay
import androidx.compose.material.icons.rounded.ContentCut
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.yoinks.app.domain.model.Clip
import com.yoinks.app.domain.model.Confidence
import com.yoinks.app.domain.model.FormatOption
import com.yoinks.app.domain.model.LinkRules
import com.yoinks.app.domain.model.MediaInfo
import com.yoinks.app.domain.model.MediaKind
import com.yoinks.app.domain.model.SpotifyLookup
import com.yoinks.app.domain.model.YoinksError
import com.yoinks.app.ui.components.ActionState
import com.yoinks.app.ui.components.Chip
import com.yoinks.app.ui.components.StateButton
import com.yoinks.app.ui.components.Thumbnail
import com.yoinks.app.ui.format.Formatters
import com.yoinks.app.ui.preview.PreviewData
import com.yoinks.app.ui.theme.YoinksTheme

/** Callbacks from the sheet to [ShareViewModel]. */
class SheetActions(
    val close: () -> Unit,
    val download: (MediaInfo, FormatOption, Clip?) -> Unit,
    val wholePlaylist: (String) -> Unit,
    val downloadSpotify: (String, SpotifyLookup, List<Int>) -> Unit,
    val retry: (String) -> Unit,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareSheetHost(state: SheetState, actions: SheetActions) {
    if (state == SheetState.Hidden) return
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(onDismissRequest = actions.close, sheetState = sheetState) {
        ShareSheetContent(state, actions, Modifier.navigationBarsPadding())
    }
}

@Composable
fun ShareSheetContent(state: SheetState, actions: SheetActions, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 16.dp)) {
        when (state) {
            SheetState.Hidden -> Unit
            is SheetState.Working -> Working(state.status, actions.close)
            is SheetState.Media -> MediaOptions(state.info, actions)
            is SheetState.Spotify -> SpotifyMatches(state.url, state.lookup, actions)
            is SheetState.Failed -> Failed(state.url, state.error, actions)
        }
    }
}

@Composable
private fun Working(status: String, onCancel: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        CircularProgressIndicator()
        Text(status, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.semantics { contentDescription = status })
        TextButton(onClick = onCancel, modifier = Modifier.heightIn(min = 48.dp)) { Text("Cancel") }
    }
}

@Composable
private fun Header(title: String, subtitle: String, thumbnail: String?, audio: Boolean, badge: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
        Thumbnail(thumbnail, audio, 88.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Chip(badge)
            Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (subtitle.isNotEmpty()) Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun MediaOptions(info: MediaInfo, actions: SheetActions) {
    var selected by rememberSaveable(info.url, info.isPlaylist) { mutableIntStateOf(info.defaultIndex) }
    var clipOn by rememberSaveable { mutableStateOf(false) }
    var start by rememberSaveable { mutableStateOf("") }
    var end by rememberSaveable { mutableStateOf("") }
    var clipError by remember { mutableStateOf<String?>(null) }
    var button by remember { mutableStateOf<ActionState>(ActionState.Idle) }

    val subtitle = listOfNotNull(info.uploader, info.playlistCount?.let { "$it items" } ?: info.durationSeconds?.let(Formatters::duration)).joinToString(" · ")
    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        item { Header(info.title, subtitle, info.thumbnail, info.platform.isMusic, info.platform.displayName) }
        if (info.isSlideshow) {
            item { Note("TikTok photo slideshows: yt-dlp can only save the sound, not the photos.") }
        }
        if (LinkRules.hasPlaylistParam(info.url) && !info.isPlaylist) {
            item {
                OutlinedButton(onClick = { actions.wholePlaylist(info.url) }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Icon(Icons.AutoMirrored.Rounded.PlaylistPlay, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Get the whole playlist instead")
                }
            }
        }
        item { Text("Quality", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 8.dp)) }
        item {
            Column(Modifier.selectableGroup(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                info.formats.forEachIndexed { index, option ->
                    FormatRow(option, selected == index, isDefault = index == info.defaultIndex) { selected = index }
                }
            }
        }
        if (!info.isPlaylist) {
            item {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Switch) { clipOn = !clipOn },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(Icons.Rounded.ContentCut, contentDescription = null)
                    Text("Only a clip", modifier = Modifier.weight(1f))
                    Switch(checked = clipOn, onCheckedChange = null)
                }
            }
            if (clipOn) {
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedTextField(start, { start = it; clipError = null }, label = { Text("From (1:05)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                        OutlinedTextField(end, { end = it; clipError = null }, label = { Text("To (blank = end)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.weight(1f))
                    }
                    clipError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
        item {
            StateButton(
                label = "Download",
                state = button,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                enabled = info.formats.isNotEmpty(),
                onClick = {
                    val clip = if (clipOn && !info.isPlaylist) {
                        val s = Formatters.parseTime(start) ?: 0.0
                        val e = Formatters.parseTime(end)
                        when {
                            s.isNaN() || e?.isNaN() == true -> { clipError = "Write times like 1:05 or 65."; return@StateButton }
                            e != null && e <= s -> { clipError = "The clip has to end after it starts."; return@StateButton }
                            else -> Clip(s, e)
                        }
                    } else null
                    button = ActionState.Done
                    actions.download(info, info.formats[selected.coerceIn(0, info.formats.lastIndex)], clip)
                },
            )
        }
    }
}

@Composable
private fun FormatRow(option: FormatOption, selected: Boolean, isDefault: Boolean, onSelect: () -> Unit) {
    val audio = option.kind == MediaKind.AUDIO
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier
                .selectable(selected = selected, onClick = onSelect, role = Role.RadioButton)
                .heightIn(min = 56.dp)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            RadioButton(selected = selected, onClick = null)
            Text(option.label, style = MaterialTheme.typography.titleSmall, color = if (audio) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
            Text(option.ext.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (isDefault) Chip("default")
            Spacer(Modifier.weight(1f))
            Text(Formatters.bytes(option.sizeBytes), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SpotifyMatches(url: String, lookup: SpotifyLookup, actions: SheetActions) {
    val entity = lookup.entity
    val selections = remember(lookup) { mutableStateListOf(*lookup.candidates.map { if (it.isEmpty()) -1 else 0 }.toTypedArray()) }
    val chosen = selections.count { it >= 0 }
    val low = lookup.candidates.indices.count { i -> selections[i] >= 0 && lookup.candidates[i][selections[i]].level == Confidence.LOW }

    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { Header(entity.title, "Spotify ${entity.type} · ${entity.artists.joinToString(", ")}", entity.cover, true, "Spotify → YouTube Music") }
        item {
            Note(
                if (low > 0) "$low low-confidence match${if (low == 1) "" else "es"}: check before downloading."
                else "Matched on YouTube Music. Spotify's title, artist, album and cover are written into each file. Nothing is downloaded from Spotify.",
            )
        }
        itemsIndexed(entity.tracks) { i, track ->
            val candidates = lookup.candidates.getOrElse(i) { emptyList() }
            var open by remember { mutableStateOf(false) }
            val current = candidates.getOrNull(selections[i])
            Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(track.title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        ConfidenceBadge(current?.confidence, current?.level)
                    }
                    Text(track.artists.joinToString(", "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        current?.let { "→ ${it.title} — ${it.artist}${it.durationSeconds?.let { d -> " · " + Formatters.duration(d) } ?: ""}" }
                            ?: if (candidates.isEmpty()) "No match found on YouTube Music" else "Skipped",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    if (candidates.isNotEmpty()) {
                        TextButton(onClick = { open = true }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Pick a different result") }
                        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                            candidates.forEachIndexed { n, c ->
                                DropdownMenuItem(
                                    text = { Text("${c.title} — ${c.artist} · ${c.confidence}%") },
                                    onClick = { selections[i] = n; open = false },
                                )
                            }
                            DropdownMenuItem(text = { Text("Skip this song") }, onClick = { selections[i] = -1; open = false })
                        }
                    }
                }
            }
        }
        item {
            StateButton(
                label = if (chosen == 1) "Download 1 song" else "Download $chosen songs",
                state = ActionState.Idle,
                enabled = chosen > 0,
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                onClick = { actions.downloadSpotify(url, lookup, selections.toList()) },
            )
        }
    }
}

@Composable
private fun ConfidenceBadge(score: Int?, level: Confidence?) {
    val (container, content, word) = when (level) {
        Confidence.HIGH -> Triple(Color(0x332FB47C), Color(0xFF2FB47C), "high")
        Confidence.MEDIUM -> Triple(Color(0x33E8A317), Color(0xFFB57B00), "medium")
        Confidence.LOW -> Triple(MaterialTheme.colorScheme.errorContainer, MaterialTheme.colorScheme.onErrorContainer, "low")
        null -> Triple(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.colorScheme.onSurfaceVariant, "skip")
    }
    Chip(
        text = score?.let { "$it%" } ?: "skip",
        container = container,
        content = content,
        modifier = Modifier.semantics { contentDescription = if (score != null) "$word confidence, $score percent" else "skipped" },
    )
}

@Composable
private fun Failed(url: String?, error: YoinksError, actions: SheetActions) {
    Column(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(Icons.Rounded.ErrorOutline, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(40.dp))
        Text("That didn't work", style = MaterialTheme.typography.titleMedium)
        Text(error.message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (url != null && error.retryable) FilledTonalButton(onClick = { actions.retry(url) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Try again") }
            TextButton(onClick = actions.close, modifier = Modifier.heightIn(min = 48.dp)) { Text("Close") }
        }
    }
}

@Composable
private fun Note(text: String) {
    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = MaterialTheme.shapes.medium) {
        Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Rounded.Info, contentDescription = null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
            Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSecondaryContainer)
        }
    }
}

private val previewActions = SheetActions({}, { _, _, _ -> }, {}, { _, _, _ -> }, {})

@Preview(name = "Sheet – video", widthDp = 400, heightDp = 800, showBackground = true)
@Composable
internal fun MediaSheetPreview() = YoinksTheme { Surface { ShareSheetContent(SheetState.Media(PreviewData.media), previewActions) } }

@Preview(name = "Sheet – Spotify", widthDp = 400, heightDp = 800, showBackground = true)
@Composable
internal fun SpotifySheetPreview() = YoinksTheme { Surface { ShareSheetContent(SheetState.Spotify("https://open.spotify.com/album/x", PreviewData.spotify), previewActions) } }

@Preview(name = "Sheet – error", widthDp = 400, showBackground = true)
@Composable
internal fun ErrorSheetPreview() = YoinksTheme { Surface { ShareSheetContent(SheetState.Failed("https://x.com/a/status/1", YoinksError("private", "This video is private.", false)), previewActions) } }
