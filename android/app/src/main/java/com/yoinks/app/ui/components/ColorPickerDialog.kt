package com.yoinks.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import android.graphics.Color as AndroidColor

/** Custom accent picker: hue / saturation / brightness sliders plus a hex field. */
@Composable
fun ColorPickerDialog(initial: Long, onDismiss: () -> Unit, onPick: (Long) -> Unit) {
    val hsv = remember { FloatArray(3).also { AndroidColor.colorToHSV(initial.toInt(), it) } }
    var hue by remember { mutableFloatStateOf(hsv[0]) }
    var sat by remember { mutableFloatStateOf(hsv[1]) }
    var value by remember { mutableFloatStateOf(hsv[2]) }
    val color = Color(AndroidColor.HSVToColor(floatArrayOf(hue, sat, value)))
    var hex by remember(color) { mutableStateOf(String.format("#%06X", color.toArgb() and 0xFFFFFF)) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Custom color") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(56.dp)
                        .background(color, RoundedCornerShape(16.dp))
                        .semantics { contentDescription = "Preview $hex" },
                )
                Text("Hue")
                Slider(value = hue, onValueChange = { hue = it }, valueRange = 0f..360f, modifier = Modifier.semantics { contentDescription = "Hue" })
                Text("Saturation")
                Slider(value = sat, onValueChange = { sat = it }, valueRange = 0.15f..1f, modifier = Modifier.semantics { contentDescription = "Saturation" })
                Text("Brightness")
                Slider(value = value, onValueChange = { value = it }, valueRange = 0.35f..1f, modifier = Modifier.semantics { contentDescription = "Brightness" })
                OutlinedTextField(
                    value = hex,
                    onValueChange = { text ->
                        hex = text
                        runCatching { AndroidColor.parseColor(text.trim()) }.getOrNull()?.let {
                            val out = FloatArray(3)
                            AndroidColor.colorToHSV(it, out)
                            hue = out[0]; sat = out[1].coerceAtLeast(0.15f); value = out[2].coerceAtLeast(0.35f)
                        }
                    },
                    label = { Text("Hex") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                )
            }
        },
        confirmButton = { TextButton(onClick = { onPick(color.toArgb().toLong() and 0xFFFFFFFFL) }) { Text("Use color") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
