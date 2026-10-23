package com.yoinks.app.ui.history

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
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
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.AlertDialog
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
    const val SHOW_AFTER = 6

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
    var query by remember { mutableStateOf("") }
    val shown = remember(items, query) { HistorySearch.filter(items, query) }
    Column(modifier.fillMaxSize()) {
        Text("History", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(16.dp))
        if (items.isEmpty()) {
            EmptyState(Icons.Rounded.History, "No downloads yet", "Everything you download is listed here.")
            return@Column
        }
        // Search appears once the list is long enough to need it.
        if (items.size > HistorySearch.SHOW_AFTER || query.isNotEmpty()) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text("Search downloads") },
                leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 8.dp),
            )
        }
        if (shown.isEmpty()) {
            EmptyState(Icons.Rounded.Search, "Nothing found", "No download matches “${query.trim()}”.")
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
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconAction(Icons.AutoMirrored.Rounded.OpenInNew, "Open ${item.title}", { onOpen(item) })
                            IconAction(Icons.Rounded.Share, "Share ${item.title}", { onShare(item) })
                            IconAction(Icons.Rounded.Refresh, "Download ${item.title} again", { onRedownload(item) })
                            IconAction(Icons.Rounded.Delete, "Delete ${item.title}", { confirm = item })
                        }
                    },
                    colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface),
                    modifier = Modifier.heightIn(min = 72.dp),
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

@PreviewScreenSizes
@Composable
internal fun HistoryPreview() = YoinksTheme { Surface { HistoryScreen(PreviewData.history, {}, {}, { _, _ -> }, {}) } }
