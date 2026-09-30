package com.yoinks.app.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp

/** What a download button is doing. */
sealed interface ActionState {
    data object Idle : ActionState
    data object Loading : ActionState
    /** [fraction] 0..1, or null for indeterminate. */
    data class Downloading(val fraction: Float?) : ActionState
    data object Done : ActionState
    data class Error(val message: String) : ActionState
}

/**
 * The main "Download" button: idle, loading, downloading (progress ring),
 * done and error states, a 56dp touch target, haptic feedback when the
 * state settles, and a TalkBack label that says what is happening.
 */
@Composable
fun StateButton(
    label: String,
    state: ActionState,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector = Icons.Rounded.Download,
    enabled: Boolean = true,
) {
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(state) {
        when (state) {
            ActionState.Done -> haptics.performHapticFeedback(HapticFeedbackType.Confirm)
            is ActionState.Error -> haptics.performHapticFeedback(HapticFeedbackType.Reject)
            else -> Unit
        }
    }
    val busy = state is ActionState.Loading || state is ActionState.Downloading
    val spoken = when (state) {
        ActionState.Idle -> label
        ActionState.Loading -> "$label, working"
        is ActionState.Downloading -> state.fraction?.let { "Downloading, ${(it * 100).toInt()} percent" } ?: "Downloading"
        ActionState.Done -> "Done"
        is ActionState.Error -> "Failed: ${state.message}"
    }
    Button(
        onClick = {
            haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
            onClick()
        },
        enabled = enabled && !busy,
        modifier = modifier
            .heightIn(min = 56.dp)
            .semantics {
                contentDescription = spoken
                stateDescription = spoken
            },
        colors = if (state is ActionState.Error) ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error) else ButtonDefaults.buttonColors(),
    ) {
        AnimatedContent(targetState = state, label = "state") { s ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) {
                    when (s) {
                        ActionState.Idle -> Icon(icon, contentDescription = null)
                        ActionState.Loading -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.5.dp, color = MaterialTheme.colorScheme.onPrimary)
                        is ActionState.Downloading ->
                            if (s.fraction == null) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.5.dp)
                            else CircularProgressIndicator(progress = { s.fraction }, modifier = Modifier.size(20.dp), strokeWidth = 2.5.dp)
                        ActionState.Done -> Icon(Icons.Rounded.Check, contentDescription = null)
                        is ActionState.Error -> Icon(Icons.Rounded.ErrorOutline, contentDescription = null)
                    }
                }
                Text(
                    when (s) {
                        ActionState.Idle -> label
                        ActionState.Loading -> "Working…"
                        is ActionState.Downloading -> s.fraction?.let { "${(it * 100).toInt()}%" } ?: "Downloading…"
                        ActionState.Done -> "Added"
                        is ActionState.Error -> "Try again"
                    },
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    }
}

/** A full-width [StateButton]. */
@Composable
fun WideStateButton(label: String, state: ActionState, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) =
    StateButton(label, state, onClick, modifier.fillMaxWidth(), enabled = enabled)
