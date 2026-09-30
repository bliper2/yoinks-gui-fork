package com.yoinks.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp

/**
 * Tiny Markdown for the Terms/Privacy texts (the .md files in res/raw): #/##/###
 * headings, paragraphs, "- " lists, **bold**, `code` and [links](https://…).
 */
@Composable
fun MarkdownText(markdown: String, modifier: Modifier = Modifier) {
    val link = SpanStyle(color = MaterialTheme.colorScheme.primary, textDecoration = TextDecoration.Underline)
    val code = SpanStyle(fontFamily = FontFamily.Monospace, background = MaterialTheme.colorScheme.surfaceContainerHighest)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        markdown.replace("\r", "").split(Regex("\n{2,}")).map { it.trim() }.filter { it.isNotEmpty() }.forEach { block ->
            val lines = block.lines().filter { it.isNotBlank() }
            val heading = Regex("^(#{1,3})\\s+(.*)$").find(lines.first())
            when {
                heading != null && lines.size == 1 -> Text(
                    inline(heading.groupValues[2], link, code),
                    style = when (heading.groupValues[1].length) {
                        1 -> MaterialTheme.typography.headlineSmall
                        2 -> MaterialTheme.typography.titleMedium
                        else -> MaterialTheme.typography.titleSmall
                    },
                    modifier = Modifier.semantics { heading() },
                )
                lines.all { it.trimStart().startsWith("- ") } -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    lines.forEach { line ->
                        Row {
                            Text("•", modifier = Modifier.padding(end = 8.dp), style = MaterialTheme.typography.bodyMedium)
                            Text(inline(line.trimStart().removePrefix("- "), link, code), style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
                else -> Text(inline(lines.joinToString(" "), link, code), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

private val INLINE = Regex("""\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)]\((https://[^)\s]+)\)""")

private fun inline(text: String, link: SpanStyle, code: SpanStyle): AnnotatedString = buildAnnotatedString {
    var last = 0
    INLINE.findAll(text).forEach { m ->
        append(text.substring(last, m.range.first))
        when {
            m.groupValues[1].isNotEmpty() -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(m.groupValues[1]) }
            m.groupValues[2].isNotEmpty() -> withStyle(code) { append(m.groupValues[2]) }
            else -> withLink(LinkAnnotation.Url(m.groupValues[4], TextLinkStyles(style = link))) { append(m.groupValues[3]) }
        }
        last = m.range.last + 1
    }
    append(text.substring(last))
}
