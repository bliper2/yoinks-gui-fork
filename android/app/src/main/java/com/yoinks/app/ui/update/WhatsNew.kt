package com.yoinks.app.ui.update

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.yoinks.app.R
import com.yoinks.app.domain.support.Changelog
import com.yoinks.app.ui.components.MarkdownText

/** Shown once after the app was updated: what changed in this version. */
@Composable
fun WhatsNewDialog(version: String, onClose: () -> Unit) {
    val context = LocalContext.current
    val notes = remember(version) {
        val all = context.resources.openRawResource(R.raw.changelog).bufferedReader().use { it.readText() }
        Changelog.section(all, version) ?: all
    }
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Yoinks $version") },
        text = { Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) { MarkdownText(notes) } },
        confirmButton = { TextButton(onClick = onClose) { Text("Got it") } },
    )
}
