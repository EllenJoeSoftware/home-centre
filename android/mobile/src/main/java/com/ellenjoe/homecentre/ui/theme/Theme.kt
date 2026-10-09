package com.ellenjoe.homecentre.ui.theme

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color

val HcBackground = Color(0xFF0B0F14)
val HcSurface = Color(0xFF131A22)
val HcSurfaceVariant = Color(0xFF1C2530)
val HcAccent = Color(0xFF14B8A6)

private val colors = darkColorScheme(
    primary = HcAccent,
    onPrimary = Color(0xFF00201C),
    primaryContainer = Color(0xFF0F766E),
    onPrimaryContainer = Color(0xFFCCFBF1),
    secondary = Color(0xFF5EEAD4),
    background = HcBackground,
    onBackground = Color(0xFFE6EDF3),
    surface = HcBackground,
    onSurface = Color(0xFFE6EDF3),
    surfaceVariant = HcSurfaceVariant,
    onSurfaceVariant = Color(0xFF9AA7B4),
    surfaceContainer = HcSurface,
    surfaceContainerHigh = HcSurfaceVariant,
    surfaceContainerLow = HcSurface,
    outline = Color(0xFF3A4654),
    error = Color(0xFFF87171),
)

@Composable
fun HomeCentreTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors) {
        // Surface sets LocalContentColor to onBackground so text is never default-black on the dark background.
        Surface(modifier = Modifier.fillMaxSize(), color = colors.background, contentColor = colors.onBackground, content = content)
    }
}
