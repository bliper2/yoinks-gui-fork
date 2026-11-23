package com.yoinks.app.ui.history

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ContentCopy
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.platform.LocalContext
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
import com.yoinks.app.ui.components.Thumbnail
import com.yoinks.app.ui.format.Formatters
import com.yoinks.app.ui.preview.PreviewData
import com.yoinks.app.ui.theme.YoinksTheme
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class HistoryViewModel @Inject constructor(private val repo: HistoryRepository) : ViewModel() {
    val items: StateFlow<List<HistoryEntity>> = repo.all.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun delete(item: HistoryEntity, deleteFile: Boolean) = viewModelScope.launch { repo.delete(item, deleteFile) }
}

/** Open a saved file in another app (player, gallery…). */
fun openFile(context: Context, item: HistoryEntity): Boolean = try {
    context.startActivity(
        Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(item.contentUri), item.mimeType).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
    )
    true
} catch (e: ActivityNotFoundException) {
    false
} catch (e: SecurityException) {
    false
}

fun shareFile(context: Context, item: HistoryEntity) {
    val send = Intent(Intent.ACTION_SEND).setType(item.mimeType).putExtra(Intent.EXTRA_STREAM, Uri.parse(item.contentUri)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    context.startActivity(Intent.createChooser(send, item.title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

/** Every word of the search must appear in the title, file name or website. */
object HistorySearch {
    fun filter(items: List<HistoryEntity>, query: String): List<HistoryEntity> {
        val words = query.trim().lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty()) return items
        return items.filter { item ->
            val text = "${item.title} ${item.displayName} ${item.platform}".lowercase()
            words.all { it in text }
        }
    }
}

@Composable
fun HistoryRoute(onRedownload: (HistoryEntity) -> Unit, onMessage: (String) -> Unit, vm: HistoryViewModel = hiltViewModel()) {
    val items by vm.items.collectAsState()
    val context = LocalContext.current
    HistoryScreen(
        items = items,
        onOpen = { if (!openFile(context, it)) onMessage("That file is gone, or no app can open it.") },
        onShare = { shareFile(context, it) },
        onDelete = { item, deleteFile -> vm.delete(item, deleteFile) },
        onRedownload = onRedownload,
    )
}

@Composable
fun HistoryScreen(
    items: List<HistoryEntity>,
    onOpen: (HistoryEntity) -> Unit,
    onShare: (HistoryEntity) -> Unit,
    onDelete: (HistoryEntity, Boolean) -> Unit,
    onRedownload: (HistoryEntity) -> Unit,
    modifier: Modifier = Modifier,
) {
    var confirm by remember { mutableStateOf<HistoryEntity?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var media by rememberSaveable { mutableStateOf("All media") }
    var order by rememberSaveable { mutableStateOf("Newest first") }
    val clipboard = LocalClipboardManager.current
    val shown = remember(items, query, media, order) {
        val matches = HistorySearch.filter(items, query).filter {
            when (media) {
                "Audio" -> it.isAudio
                "Video" -> !it.isAudio
                else -> true
            }
        }
        when (order) {
            "Title A–Z" -> matches.sortedBy { it.title.lowercase() }
            "Largest first" -> matches.sortedByDescending { it.sizeBytes }
            "Oldest first" -> matches.sortedBy { it.createdAt }
            else -> matches.sortedByDescending { it.createdAt }
        }
    }
    val links = remember(shown) { shown.map { it.sourceUrl }.filter { it.isNotBlank() }.distinct() }
    Column(modifier.fillMaxSize()) {
        Text("History", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(16.dp))
        if (items.isEmpty()) {
            EmptyState(Icons.Rounded.History, "No downloads yet", "Everything you download is listed here.")
            return@Column
        }
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            label = { Text("Search history") },
            leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        FlowRow(Modifier.fillMaxWidth().padding(horizontal = 8.dp)) {
            HistoryChoice(media, listOf("All media", "Audio", "Video")) { media = it }
            HistoryChoice(order, listOf("Newest first", "Oldest first", "Title A–Z", "Largest first")) { order = it }
            IconAction(Icons.Rounded.ContentCopy, "Copy matching source links", enabled = links.isNotEmpty(), onClick = {
                clipboard.setText(AnnotatedString(links.joinToString("\n")))
            })
        }
        if (shown.isEmpty()) {
            EmptyState(Icons.Rounded.Search, "Nothing found", "Try another search or media type.")
            return@Column
        }
        LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
            items(shown, key = { it.id }) { item ->
                ListItem(
                    headlineContent = { Text(item.title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                    supportingContent = {
                        Text(
                            listOf(Formatters.timeAgo(item.createdAt), Formatters.bytes(item.sizeBytes), item.location).filter { it.isNotBlank() }.joinToString(" · "),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    leadingContent = { Thumbnail(item.thumbnail, item.isAudio, 48.dp) },
                    trailingContent = {
                        Box {
                            var menuOpen by remember { mutableStateOf(false) }
                            IconAction(Icons.Rounded.MoreVert, "More actions for ${item.title}", { menuOpen = true })
                            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                                DropdownMenuItem(
                                    text = { Text("Share") },
                                    leadingIcon = { Icon(Icons.Rounded.Share, null) },
                                    onClick = { menuOpen = false; onShare(item) },
                                )
                                if (item.sourceUrl.isNotBlank()) DropdownMenuItem(
                                    text = { Text("Copy source link") },
                                    leadingIcon = { Icon(Icons.Rounded.ContentCopy, null) },
                                    onClick = { menuOpen = false; clipboard.setText(AnnotatedString(item.sourceUrl)) },
                                )
                                DropdownMenuItem(
                                    text = { Text("Download again") },
                                    leadingIcon = { Icon(Icons.Rounded.Refresh, null) },
                                    onClick = { menuOpen = false; onRedownload(item) },
                                )
                                DropdownMenuItem(
                                    text = { Text("Remove from history") },
                                    leadingIcon = { Icon(Icons.Rounded.Delete, null) },
                                    onClick = { menuOpen = false; confirm = item },
                                )
                            }
                        }
                    },
                    colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface),
                    modifier = Modifier.animateItem().clickable(onClickLabel = "Open file") { onOpen(item) }.heightIn(min = 72.dp),
                )
            }
        }
    }
    confirm?.let { item ->
        var alsoFile by remember(item.id) { mutableStateOf(false) }
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text("Remove from history?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(item.title)
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Checkbox(checked = alsoFile, onCheckedChange = { alsoFile = it })
                        Text("Also delete the file from the phone")
                    }
                }
            },
            confirmButton = { TextButton(onClick = { onDelete(item, alsoFile); confirm = null }) { Text(if (alsoFile) "Delete" else "Remove") } },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun HistoryChoice(selected: String, values: List<String>, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }) { Text(selected) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            values.forEach { value ->
                DropdownMenuItem(text = { Text(value) }, onClick = { onSelect(value); open = false })
            }
        }
    }
}

@PreviewScreenSizes
@Composable
internal fun HistoryPreview() = YoinksTheme { Surface { HistoryScreen(PreviewData.history, {}, {}, { _, _ -> }, {}) } }
