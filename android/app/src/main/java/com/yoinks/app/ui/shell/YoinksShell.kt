package com.yoinks.app.ui.shell

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.yoinks.app.ui.theme.LocalLook
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Downloading
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.windowsizeclass.WindowWidthSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.tooling.preview.Preview
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import com.yoinks.app.domain.model.DownloadJob
import com.yoinks.app.ui.history.HistoryRoute
import com.yoinks.app.ui.history.openFile
import com.yoinks.app.ui.home.HomeRoute
import com.yoinks.app.ui.home.HomeScreen
import com.yoinks.app.ui.legal.LegalScreen
import com.yoinks.app.ui.preview.PreviewData
import com.yoinks.app.ui.queue.JobDetail
import com.yoinks.app.ui.queue.QueueActions
import com.yoinks.app.ui.queue.QueueRoute
import com.yoinks.app.ui.queue.QueueScreen
import com.yoinks.app.ui.queue.QueueViewModel
import com.yoinks.app.ui.queue.rememberQueueActions
import com.yoinks.app.ui.settings.LegalPage
import com.yoinks.app.ui.settings.SettingsRoute
import com.yoinks.app.ui.share.ShareViewModel
import com.yoinks.app.ui.theme.YoinksTheme
import com.yoinks.app.ui.update.UpdatePrompt

enum class Destination(val label: String, val icon: ImageVector) {
    HOME("Download", Icons.Rounded.Download),
    QUEUE("Queue", Icons.Rounded.Downloading),
    HISTORY("History", Icons.Rounded.History),
    SETTINGS("Settings", Icons.Rounded.Settings),
}

/**
 * Adaptive layout from the window width:
 *  Compact  (phones)              bottom navigation bar, one column
 *  Medium   (foldables, small tabs) navigation rail, one column
 *  Expanded (tablets, landscape)   rail + two panes: queue left, details/other right
 */
@Composable
fun YoinksShell(
    widthClass: WindowWidthSizeClass,
    share: ShareViewModel,
    snackbar: SnackbarHostState,
    destination: Destination,
    onDestination: (Destination) -> Unit,
) {
    val queueVm: QueueViewModel = hiltViewModel()
    val jobs by queueVm.queue.jobs.collectAsState()
    var legal by rememberSaveable { mutableStateOf<LegalPage?>(null) }
    var selectedJobId by rememberSaveable { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val expanded = widthClass == WindowWidthSizeClass.Expanded

    val go: (Destination) -> Unit = {
        haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
        if (it != Destination.SETTINGS) legal = null
        onDestination(it)
    }
    val onSelectJob: (DownloadJob) -> Unit = {
        selectedJobId = it.id
        if (expanded) onDestination(Destination.QUEUE)
    }
    val message: (String) -> Unit = { share.say(it) }

    val page: @Composable (Destination) -> Unit = { d ->
        when (d) {
            Destination.HOME -> HomeRoute(share, onOpen = { if (!openFile(context, it)) message("That file is gone, or no app can open it.") })
            Destination.QUEUE ->
                if (expanded) JobDetail(jobs.firstOrNull { it.id == selectedJobId }, rememberQueueActions(queueVm, onSelectJob))
                else QueueRoute(onSelect = onSelectJob, selectedId = selectedJobId, vm = queueVm)
            Destination.HISTORY -> HistoryRoute(onRedownload = { share.onIncoming(it.sourceUrl, fromShare = false) }, onMessage = message)
            Destination.SETTINGS -> legal?.let { LegalScreen(it, onBack = { legal = null }, onOpen = { p -> legal = p }) }
                ?: SettingsRoute(openLegal = { legal = it }, onMessage = message)
        }
    }

    val activeCount = jobs.count { it.phase.isActive || it.phase.isPending }
    // Settings → Floating navigation bar: a pill over the content replaces
    // the bottom bar and the rail.
    val floating = LocalLook.current.floatingNav

    UpdatePrompt()

    Box(Modifier.fillMaxSize()) {
    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        contentWindowInsets = WindowInsets.safeDrawing,
        bottomBar = {
            if (widthClass == WindowWidthSizeClass.Compact && !floating) {
                NavigationBar {
                    Destination.entries.forEach { d ->
                        NavigationBarItem(
                            selected = destination == d,
                            onClick = { go(d) },
                            icon = { NavIcon(d, if (d == Destination.QUEUE) activeCount else 0) },
                            label = { Text(d.label) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        val contentPadding = if (floating) Modifier.padding(bottom = 84.dp) else Modifier
        if (widthClass == WindowWidthSizeClass.Compact) {
            Box(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding).then(contentPadding)) { page(destination) }
        } else {
            Row(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding).then(contentPadding)) {
                if (!floating) NavigationRail(containerColor = MaterialTheme.colorScheme.surfaceContainer) {
                    Destination.entries.forEach { d ->
                        NavigationRailItem(
                            selected = destination == d,
                            onClick = { go(d) },
                            icon = { NavIcon(d, if (d == Destination.QUEUE) activeCount else 0) },
                            label = { Text(d.label) },
                        )
                    }
                }
                if (expanded) {
                    // Left pane: the queue is always visible on large screens.
                    Box(Modifier.weight(0.42f).fillMaxHeight()) {
                        QueueScreen(jobs, rememberQueueActions(queueVm, onSelectJob), selectedJobId)
                    }
                    VerticalDivider()
                    Box(Modifier.weight(0.58f).fillMaxHeight()) { page(destination) }
                } else {
                    Box(Modifier.weight(1f).fillMaxHeight()) { page(destination) }
                }
            }
        }
    }
    if (floating) {
        FloatingNav(destination, activeCount, go, Modifier.align(Alignment.BottomCenter).windowInsetsPadding(WindowInsets.safeDrawing).padding(bottom = 12.dp))
    }
    }
}

/** The floating pill: icons, with the label of the current page. */
@Composable
internal fun FloatingNav(destination: Destination, activeCount: Int, go: (Destination) -> Unit, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        tonalElevation = 3.dp,
        shadowElevation = 8.dp,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(Modifier.padding(6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Destination.entries.forEach { d ->
                val selected = d == destination
                Surface(
                    onClick = { go(d) },
                    shape = CircleShape,
                    color = if (selected) MaterialTheme.colorScheme.primary else Color.Transparent,
                    contentColor = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.semantics { contentDescription = d.label },
                ) {
                    Row(Modifier.height(44.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        NavIcon(d, if (d == Destination.QUEUE) activeCount else 0)
                        if (selected) Text(d.label, style = MaterialTheme.typography.labelLarge)
                    }
                }
            }
        }
    }
}

@Composable
private fun NavIcon(d: Destination, badge: Int) {
    if (badge > 0) {
        BadgedBox(badge = { Badge { Text(badge.toString()) } }) { Icon(d.icon, contentDescription = null) }
    } else {
        Icon(d.icon, contentDescription = null)
    }
}

// ---------- previews: the layout at phone, foldable and tablet sizes ----------

@Composable
private fun ShellPreviewBody(widthClass: WindowWidthSizeClass) = YoinksTheme {
    val actions = QueueActions({}, {}, {}, {}, {}, {}, {}, {})
    Surface {
        Row {
            if (widthClass != WindowWidthSizeClass.Compact) {
                NavigationRail {
                    Destination.entries.forEach { d -> NavigationRailItem(selected = d == Destination.HOME, onClick = {}, icon = { Icon(d.icon, null) }, label = { Text(d.label) }) }
                }
            }
            if (widthClass == WindowWidthSizeClass.Expanded) {
                Box(Modifier.weight(0.42f)) { QueueScreen(PreviewData.jobs, actions) }
                VerticalDivider()
                Box(Modifier.weight(0.58f)) { HomeScreen(PreviewData.history, {}, {}, {}, {}, {}) }
            } else {
                Box(Modifier.weight(1f)) { HomeScreen(PreviewData.history, {}, {}, {}, {}, {}) }
            }
        }
    }
}

@Preview(name = "Phone", device = "spec:width=411dp,height=891dp", showSystemUi = true)
@Composable
internal fun PhoneShellPreview() = ShellPreviewBody(WindowWidthSizeClass.Compact)

@Preview(name = "Foldable", device = "spec:width=673dp,height=841dp", showSystemUi = true)
@Composable
internal fun FoldableShellPreview() = ShellPreviewBody(WindowWidthSizeClass.Medium)

@Preview(name = "Tablet", device = "spec:width=1280dp,height=800dp,dpi=240", showSystemUi = true)
@Composable
internal fun TabletShellPreview() = ShellPreviewBody(WindowWidthSizeClass.Expanded)
