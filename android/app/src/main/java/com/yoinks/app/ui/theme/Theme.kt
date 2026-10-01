package com.yoinks.app.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.yoinks.app.domain.model.AccentPreset
import com.yoinks.app.domain.model.AppSettings
import com.yoinks.app.domain.model.ThemeMode
import com.yoinks.app.domain.model.UiStyle

/** Look choices the layout needs beyond MaterialTheme (read with LocalLook.current). */
data class Look(val style: UiStyle = UiStyle.CLEAN, val floatingNav: Boolean = false)

val LocalLook = staticCompositionLocalOf { Look() }

/** The accent the user picked (preset or custom). */
fun AppSettings.accentColor(): Color = Color(if (accent == AccentPreset.CUSTOM) customAccent else accent.argb)

/**
 * Yoinks theme: the style (Clean / Playful / Neon / Classic) sets shapes, type
 * and surfaces; Light / Dark / System, Material You colors on Android 12+
 * (when enabled), AMOLED black, and a scheme built from the accent otherwise.
 */
@Composable
fun YoinksTheme(settings: AppSettings = AppSettings(), content: @Composable () -> Unit) {
    val dark = when (settings.themeMode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
    val context = LocalContext.current
    var scheme = if (settings.dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
    } else {
        schemeFromAccent(settings.accentColor(), dark)
    }
    scheme = scheme.styled(settings.style, dark)
    if (dark && settings.amoledBlack) scheme = scheme.amoled()
    CompositionLocalProvider(LocalLook provides Look(settings.style, settings.floatingNav)) {
        MaterialTheme(colorScheme = scheme, shapes = shapesFor(settings.style), typography = typographyFor(settings.style), content = content)
    }
}

private fun shapesFor(style: UiStyle): Shapes = when (style) {
    UiStyle.CLEAN -> Shapes(
        extraSmall = RoundedCornerShape(6.dp), small = RoundedCornerShape(8.dp), medium = RoundedCornerShape(12.dp),
        large = RoundedCornerShape(16.dp), extraLarge = RoundedCornerShape(24.dp),
    )
    UiStyle.PLAYFUL -> Shapes(
        extraSmall = RoundedCornerShape(10.dp), small = RoundedCornerShape(16.dp), medium = RoundedCornerShape(22.dp),
        large = RoundedCornerShape(28.dp), extraLarge = RoundedCornerShape(36.dp),
    )
    UiStyle.NEON -> Shapes(
        extraSmall = RoundedCornerShape(3.dp), small = RoundedCornerShape(6.dp), medium = RoundedCornerShape(8.dp),
        large = RoundedCornerShape(12.dp), extraLarge = RoundedCornerShape(16.dp),
    )
    UiStyle.CLASSIC -> Shapes()
}

private fun typographyFor(style: UiStyle): Typography {
    val base = Typography()
    return when (style) {
        UiStyle.PLAYFUL -> base.copy(
            headlineSmall = base.headlineSmall.copy(fontWeight = FontWeight.ExtraBold),
            headlineMedium = base.headlineMedium.copy(fontWeight = FontWeight.ExtraBold),
            titleLarge = base.titleLarge.copy(fontWeight = FontWeight.ExtraBold),
            titleMedium = base.titleMedium.copy(fontWeight = FontWeight.Bold),
            labelLarge = base.labelLarge.copy(fontWeight = FontWeight.Bold),
        )
        UiStyle.NEON -> base.copy(
            titleLarge = base.titleLarge.copy(fontWeight = FontWeight.SemiBold, letterSpacing = base.titleLarge.letterSpacing * 1.5f),
            labelLarge = base.labelLarge.copy(fontWeight = FontWeight.SemiBold),
        )
        UiStyle.CLEAN -> base.copy(titleLarge = base.titleLarge.copy(fontWeight = FontWeight.SemiBold))
        UiStyle.CLASSIC -> base
    }
}

/** Surface tweaks per style on top of the accent/Material You scheme. */
private fun ColorScheme.styled(style: UiStyle, dark: Boolean): ColorScheme = when (style) {
    // Neutral greys instead of blue-tinted ones.
    UiStyle.CLEAN -> if (dark) copy(
        background = Color(0xFF0E1015), surface = Color(0xFF0E1015),
        surfaceContainerLow = Color(0xFF14161C), surfaceContainer = Color(0xFF181B21),
        surfaceContainerHigh = Color(0xFF1E2128), surfaceContainerHighest = Color(0xFF252932),
    ) else copy(
        background = Color(0xFFF5F6F8), surface = Color(0xFFF5F6F8),
        surfaceContainerLow = Color(0xFFFFFFFF), surfaceContainer = Color(0xFFEFF1F4),
    )
    // Accent-tinted containers.
    UiStyle.PLAYFUL -> copy(
        secondaryContainer = primaryContainer,
        onSecondaryContainer = onPrimaryContainer,
        surfaceContainer = primary.copy(alpha = if (dark) 0.12f else 0.08f).compositeOver(surfaceContainer),
        surfaceContainerHigh = primary.copy(alpha = if (dark) 0.16f else 0.1f).compositeOver(surfaceContainerHigh),
    )
    // Near-black with accent outlines.
    UiStyle.NEON -> if (dark) copy(
        background = Color(0xFF04050A), surface = Color(0xFF04050A),
        surfaceContainerLowest = Color.Black, surfaceContainerLow = Color(0xFF080A12),
        surfaceContainer = Color(0xFF0B0E17), surfaceContainerHigh = Color(0xFF10131E), surfaceContainerHighest = Color(0xFF151927),
        outline = primary.copy(alpha = 0.7f).compositeOver(Color.Black), outlineVariant = primary.copy(alpha = 0.35f).compositeOver(Color.Black),
    ) else copy(outline = primary, outlineVariant = primary.copy(alpha = 0.4f).compositeOver(Color.White))
    UiStyle.CLASSIC -> this
}

/** A Material 3 scheme from one accent color (tones mixed toward white/black). */
fun schemeFromAccent(accent: Color, dark: Boolean): ColorScheme {
    fun mix(color: Color, with: Color, amount: Float) = color.copy(alpha = 1f - amount).compositeOver(with)
    fun on(background: Color) = if (background.luminance() > 0.4f) Color(0xFF0A0D13) else Color.White
    val secondary = Color(0xFF22D3EE)
    return if (dark) {
        val primary = mix(accent, Color.White, 0.25f)
        val primaryContainer = mix(accent, Color(0xFF0A0D13), 0.55f)
        darkColorScheme(
            primary = primary,
            onPrimary = on(primary),
            primaryContainer = primaryContainer,
            onPrimaryContainer = mix(accent, Color.White, 0.8f),
            secondary = secondary,
            onSecondary = Color(0xFF0A0D13),
            secondaryContainer = mix(accent, Color(0xFF141824), 0.75f),
            onSecondaryContainer = Color(0xFFE8EDF4),
            tertiary = mix(secondary, Color.White, 0.2f),
            background = Color(0xFF0E1118),
            onBackground = Color(0xFFE8EDF4),
            surface = Color(0xFF0E1118),
            onSurface = Color(0xFFE8EDF4),
            surfaceVariant = Color(0xFF232838),
            onSurfaceVariant = Color(0xFFB3BACB),
            surfaceContainerLowest = Color(0xFF090B10),
            surfaceContainerLow = Color(0xFF131722),
            surfaceContainer = Color(0xFF171B27),
            surfaceContainerHigh = Color(0xFF1D2230),
            surfaceContainerHighest = Color(0xFF242A3A),
            outline = Color(0xFF6F7A8E),
            outlineVariant = Color(0xFF363D50),
            error = Color(0xFFFF8A8E),
            onError = Color(0xFF3B0A0C),
        )
    } else {
        val primary = mix(accent, Color.Black, 0.15f)
        lightColorScheme(
            primary = primary,
            onPrimary = on(primary),
            primaryContainer = mix(accent, Color.White, 0.8f),
            onPrimaryContainer = mix(accent, Color.Black, 0.6f),
            secondary = Color(0xFF0E8FA3),
            onSecondary = Color.White,
            secondaryContainer = mix(accent, Color.White, 0.88f),
            onSecondaryContainer = Color(0xFF141925),
            tertiary = Color(0xFF0E8FA3),
            background = Color(0xFFF7F8FC),
            onBackground = Color(0xFF141925),
            surface = Color(0xFFF7F8FC),
            onSurface = Color(0xFF141925),
            surfaceVariant = Color(0xFFE3E6EF),
            onSurfaceVariant = Color(0xFF4A5366),
            surfaceContainerLowest = Color.White,
            surfaceContainerLow = Color(0xFFF1F3F9),
            surfaceContainer = Color(0xFFECEEF5),
            surfaceContainerHigh = Color(0xFFE6E9F1),
            surfaceContainerHighest = Color(0xFFE0E3EC),
            outline = Color(0xFF737C8F),
            outlineVariant = Color(0xFFC6CBD8),
            error = Color(0xFFBA1A1A),
            onError = Color.White,
        )
    }
}

/** True black backgrounds for OLED screens. */
private fun ColorScheme.amoled() = copy(
    background = Color.Black,
    surface = Color.Black,
    surfaceContainerLowest = Color.Black,
    surfaceContainerLow = Color(0xFF0A0A0A),
    surfaceContainer = Color(0xFF101010),
    surfaceContainerHigh = Color(0xFF161616),
    surfaceContainerHighest = Color(0xFF1C1C1C),
)
