package com.yoinks.app

import android.app.Application
import androidx.compose.runtime.Composable
import com.github.takahirom.roborazzi.captureRoboImage
import com.yoinks.app.ui.history.HistoryPreview
import com.yoinks.app.ui.queue.QueuePreview
import com.yoinks.app.ui.settings.SettingsPreview
import com.yoinks.app.ui.share.MediaSheetPreview
import com.yoinks.app.ui.share.SpotifySheetPreview
import com.yoinks.app.ui.shell.PhoneShellPreview
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Renders the main screens from their @Preview data to
 * app/build/screenshots/ (used for the README). No phone or emulator needed:
 * gradlew testDebugUnitTest --tests com.yoinks.app.ScreenshotTest
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
// A plain Application: the real one starts Hilt, WorkManager and yt-dlp.
@Config(sdk = [36], application = Application::class, qualifiers = "w411dp-h891dp-night-xxhdpi")
class ScreenshotTest {
    private fun shot(name: String, content: @Composable () -> Unit) =
        captureRoboImage("build/screenshots/$name.png", content = content)

    @Test fun home() = shot("android-home") { PhoneShellPreview() }
    @Test fun shareSheet() = shot("android-share-sheet") { MediaSheetPreview() }
    @Test fun spotify() = shot("android-spotify") { SpotifySheetPreview() }
    @Test fun queue() = shot("android-queue") { QueuePreview() }
    @Test fun history() = shot("android-history") { HistoryPreview() }
    @Test fun settings() = shot("android-settings") { SettingsPreview() }
}
