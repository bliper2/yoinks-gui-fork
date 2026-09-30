package com.yoinks.app.ui.legal

import androidx.annotation.RawRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.tooling.preview.PreviewScreenSizes
import androidx.compose.ui.unit.dp
import com.yoinks.app.BuildConfig
import com.yoinks.app.R
import com.yoinks.app.ui.components.ActionState
import com.yoinks.app.ui.components.IconAction
import com.yoinks.app.ui.components.MarkdownText
import com.yoinks.app.ui.components.StateButton
import com.yoinks.app.ui.settings.LegalPage
import com.yoinks.app.ui.theme.YoinksTheme
import androidx.compose.material.icons.rounded.Check

@Composable
private fun rawText(@RawRes id: Int): String {
    val context = LocalContext.current
    return remember(id) { context.resources.openRawResource(id).bufferedReader().use { it.readText() } }
}

/** First launch: terms + privacy, and an explicit "I understand and accept". */
@Composable
fun TermsGate(onAccept: () -> Unit, modifier: Modifier = Modifier, terms: String = rawText(R.raw.terms), privacy: String = rawText(R.raw.privacy)) {
    var agreed by rememberSaveable { mutableStateOf(false) }
    Column(modifier.fillMaxSize().safeDrawingPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
        Column(
            Modifier.weight(1f).widthIn(max = 720.dp).verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text("Welcome to Yoinks", style = MaterialTheme.typography.headlineMedium)
            Text("Please read these first. They are short.", style = MaterialTheme.typography.bodyLarge)
            MarkdownText(terms)
            HorizontalDivider()
            MarkdownText(privacy)
        }
        Surface(tonalElevation = 3.dp, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.widthIn(max = 720.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    Modifier.fillMaxWidth().toggleable(agreed, role = Role.Checkbox) { agreed = it }.heightIn(min = 48.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(checked = agreed, onCheckedChange = null)
                    Text("I understand and accept the Terms of use and the Privacy notice.", modifier = Modifier.padding(start = 8.dp))
                }
                StateButton("Continue", ActionState.Idle, onAccept, Modifier.fillMaxWidth(), icon = Icons.Rounded.Check, enabled = agreed)
            }
        }
    }
}

/** Terms / Privacy / About, reachable from Settings. */
@Composable
fun LegalScreen(page: LegalPage, onBack: () -> Unit, onOpen: (LegalPage) -> Unit, modifier: Modifier = Modifier) {
    val text = when (page) {
        LegalPage.TERMS -> rawText(R.raw.terms)
        LegalPage.PRIVACY -> rawText(R.raw.privacy)
        LegalPage.ABOUT -> rawText(R.raw.about).replace("{version}", BuildConfig.VERSION_NAME)
    }
    Column(modifier.fillMaxSize()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(4.dp)) {
            IconAction(Icons.AutoMirrored.Rounded.ArrowBack, "Back", onBack)
            Text(
                when (page) {
                    LegalPage.TERMS -> "Terms of use"
                    LegalPage.PRIVACY -> "Privacy"
                    LegalPage.ABOUT -> "About"
                },
                style = MaterialTheme.typography.titleLarge,
            )
        }
        Column(Modifier.verticalScroll(rememberScrollState()).widthIn(max = 720.dp).padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            MarkdownText(text)
            if (page == LegalPage.ABOUT) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { onOpen(LegalPage.TERMS) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Terms") }
                    OutlinedButton(onClick = { onOpen(LegalPage.PRIVACY) }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Privacy") }
                }
            }
        }
    }
}

@PreviewScreenSizes
@Composable
private fun TermsGatePreview() = YoinksTheme {
    Surface { TermsGate(onAccept = {}, terms = "# Terms of use\n\nShort terms text.\n\n- Personal use only.", privacy = "# Privacy\n\nNo tracking.") }
}
