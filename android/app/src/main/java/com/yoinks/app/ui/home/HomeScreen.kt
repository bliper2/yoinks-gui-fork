package com.yoinks.app.ui.home

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.PlaylistAdd
import androidx.compose.material.icons.rounded.ContentPaste
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.PreviewScreenSizes
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.yoinks.app.data.history.HistoryEntity
import com.yoinks.app.data.history.HistoryRepository
import com.yoinks.app.ui.components.EmptyState
import com.yoinks.app.ui.components.IconAction
import com.yoinks.app.ui.components.SectionHeader
import com.yoinks.app.ui.components.StateButton
import com.yoinks.app.ui.components.ActionState
import com.yoinks.app.ui.components.Thumbnail
import com.yoinks.app.ui.format.Formatters
import com.yoinks.app.ui.preview.PreviewData
import com.yoinks.app.ui.share.ShareViewModel
import com.yoinks.app.ui.theme.YoinksTheme
import dagger.hilt.android.lifecycle.HiltViewModel
import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

@HiltViewModel
class HomeViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    history: HistoryRepository,
) : ViewModel() {
    val recent: StateFlow<List<HistoryEntity>> = history.recent(5).stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    /** Read a picked .txt file of links (max 2 MB). */
    suspend fun readText(uri: Uri): String? = withContext(Dispatchers.IO) {
        runCatching {
            context.contentResolver.openInputStream(uri)?.use { input ->
                val bytes = input.readBytes()
                if (bytes.size > 2_000_000) null else bytes.decodeToString()
            }
        }.getOrNull()
    }
}

@Composable
fun HomeRoute(share: ShareViewModel, onOpen: (HistoryEntity) -> Unit, vm: HomeViewModel = hiltViewModel()) {
    val recent by vm.recent.collectAsState()
    val scope = rememberCoroutineScope()
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            val text = vm.readText(uri)
            if (text == null) share.say("Could not read that file (2 MB max).") else share.enqueueBatch(text)
        }
    }
    HomeScreen(
        recent = recent,
        onSubmit = { share.onIncoming(it, fromShare = false) },
        onBatch = { share.enqueueBatch(it) },
        onImportFile = { pickFile.launch(arrayOf("text/plain")) },
        onRedownload = { share.onIncoming(it.sourceUrl, fromShare = false) },
        onOpen = onOpen,
    )
}

@Composable
fun HomeScreen(
    recent: List<HistoryEntity>,
    onSubmit: (String) -> Unit,
    onBatch: (String) -> Unit,
    onImportFile: () -> Unit,
    onRedownload: (HistoryEntity) -> Unit,
    onOpen: (HistoryEntity) -> Unit,
    modifier: Modifier = Modifier,
) {
    var text by rememberSaveable { mutableStateOf("") }
    var batchOpen by rememberSaveable { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    val submit = {
        if (text.isNotBlank()) {
            if (Regex("https?://").findAll(text).count() > 1) onBatch(text) else onSubmit(text)
            text = ""
        }
    }

    LazyColumn(
        modifier = modifier.fillMaxSize(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 24.dp),
    ) {
        item {
            Column(
                Modifier.fillMaxWidth().widthIn(max = 720.dp).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("Yoink a video or song", style = MaterialTheme.typography.headlineSmall)
                Text(
                    "Share a link to Yoinks from TikTok, YouTube, Instagram, Snapchat and more, or paste it here.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    label = { Text("Link") },
                    placeholder = { Text("https://…") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { submit() }),
                    trailingIcon = {
                        IconAction(Icons.Rounded.ContentPaste, "Paste link", onClick = {
                            val clip = clipboard.getText()?.text.orEmpty()
                            if (clip.isNotBlank()) text = clip
                        })
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                StateButton("Yoink", ActionState.Idle, onClick = submit, modifier = Modifier.fillMaxWidth(), enabled = text.isNotBlank())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { batchOpen = true }, modifier = Modifier.heightIn(min = 48.dp).weight(1f)) {
                        Icon(Icons.AutoMirrored.Rounded.PlaylistAdd, contentDescription = null)
                        Text("Several links", modifier = Modifier.padding(start = 8.dp))
                    }
                    OutlinedButton(onClick = onImportFile, modifier = Modifier.heightIn(min = 48.dp).weight(1f)) {
                        Icon(Icons.Rounded.Download, contentDescription = null)
                        Text("Import .txt", modifier = Modifier.padding(start = 8.dp))
                    }
                }
            }
        }
        item { SectionHeader("Recent") }
        if (recent.isEmpty()) {
            item { EmptyState(Icons.Rounded.History, "Nothing yet", "Your downloads show up here.") }
        }
        items(recent, key = { it.id }) { entry ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable { onOpen(entry) }
                    .heightIn(min = 64.dp)
                    .padding(horizontal = 16.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Thumbnail(entry.thumbnail, entry.isAudio, 48.dp)
                Column(Modifier.weight(1f)) {
                    Text(entry.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(Formatters.timeAgo(entry.createdAt), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconAction(Icons.Rounded.Refresh, "Download ${entry.title} again", onClick = { onRedownload(entry) })
            }
        }
    }

    if (batchOpen) BatchDialog(onDismiss = { batchOpen = false }, onAdd = { onBatch(it); batchOpen = false })
}

@Composable
private fun BatchDialog(onDismiss: () -> Unit, onAdd: (String) -> Unit) {
    var links by rememberSaveable { mutableStateOf("") }
    val count = Regex("https?://\\S+").findAll(links).count()
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Several links") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("One link per line. Each one is downloaded in your default format.", style = MaterialTheme.typography.bodyMedium)
                OutlinedTextField(links, { links = it }, minLines = 5, maxLines = 10, modifier = Modifier.fillMaxWidth(), label = { Text("Links") })
                Text(if (count == 0) "No links yet" else "$count link${if (count == 1) "" else "s"} found", style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { FilledTonalButton(onClick = { onAdd(links) }, enabled = count > 0) { Text("Add to queue") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@PreviewScreenSizes
@Composable
private fun HomePreview() = YoinksTheme {
    Surface { HomeScreen(PreviewData.history, {}, {}, {}, {}, {}) }
}
