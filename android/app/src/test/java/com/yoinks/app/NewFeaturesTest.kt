package com.yoinks.app

import com.yoinks.app.data.engine.InfoParser
import com.yoinks.app.data.engine.YtDlpArgs
import com.yoinks.app.domain.errors.ErrorTranslator
import com.yoinks.app.domain.format.FilenameTemplate
import com.yoinks.app.domain.format.FormatPicker
import com.yoinks.app.domain.health.HealthRules
import com.yoinks.app.domain.health.HealthStatus
import com.yoinks.app.domain.model.AppSettings
import com.yoinks.app.domain.model.Clip
import com.yoinks.app.domain.model.DownloadRequest
import com.yoinks.app.domain.model.FolderBy
import com.yoinks.app.domain.model.Platform
import com.yoinks.app.domain.queue.DownloadWindow
import com.yoinks.app.domain.queue.QueueGate
import com.yoinks.app.domain.settings.SettingsValidator
import com.yoinks.app.domain.support.Changelog
import com.yoinks.app.domain.support.DebugReport
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDate
import java.time.LocalTime

class NewFeaturesTest {
    private val json = Json { ignoreUnknownKeys = true }

    // ---------- download window and waiting reasons ----------

    @Test fun downloadWindowIncludingOneThatCrossesMidnight() {
        val day = AppSettings(scheduleOn = true, scheduleFrom = "01:00", scheduleTo = "07:00")
        assertTrue("off means always open", DownloadWindow.isOpen(day.copy(scheduleOn = false), LocalTime.of(12, 0)))
        assertFalse(DownloadWindow.isOpen(day, LocalTime.of(0, 59)))
        assertTrue(DownloadWindow.isOpen(day, LocalTime.of(1, 0)))
        assertTrue(DownloadWindow.isOpen(day, LocalTime.of(6, 59)))
        assertFalse(DownloadWindow.isOpen(day, LocalTime.of(7, 0)))
        val night = AppSettings(scheduleOn = true, scheduleFrom = "22:00", scheduleTo = "06:00")
        assertTrue(DownloadWindow.isOpen(night, LocalTime.of(23, 0)))
        assertTrue(DownloadWindow.isOpen(night, LocalTime.of(3, 0)))
        assertFalse(DownloadWindow.isOpen(night, LocalTime.of(12, 0)))
        assertTrue("same time means always", DownloadWindow.isOpen(AppSettings(scheduleOn = true, scheduleFrom = "08:00", scheduleTo = "08:00"), LocalTime.of(3, 0)))
    }

    private fun gate(s: AppSettings, online: Boolean = true, unmetered: Boolean = true, saver: Boolean = false, battery: Int? = 80, charging: Boolean = false, now: LocalTime = LocalTime.NOON) =
        QueueGate.waitingText(s, online, unmetered, saver, battery, charging, now)

    @Test fun waitingReasonsComeInOrderOfHowBasicTheyAre() {
        assertNull(gate(AppSettings()))
        assertEquals("Waiting for a connection", gate(AppSettings(wifiOnly = true), online = false, unmetered = false))
        assertEquals("Waiting for Wi-Fi", gate(AppSettings(wifiOnly = true), unmetered = false))
        assertEquals("Waiting (Data Saver is on)", gate(AppSettings(respectDataSaver = true), unmetered = false, saver = true))
        assertNull("Data Saver only matters on mobile data", gate(AppSettings(respectDataSaver = true), unmetered = true, saver = true))
        assertEquals("Waiting (battery is low)", gate(AppSettings(pauseOnLowBattery = true), battery = 10))
        assertNull("charging is fine", gate(AppSettings(pauseOnLowBattery = true), battery = 10, charging = true))
        assertNull("setting off", gate(AppSettings(pauseOnLowBattery = false), battery = 5))
        assertEquals("Waiting for 01:00", gate(AppSettings(scheduleOn = true), now = LocalTime.NOON))
    }

    // ---------- settings ----------

    @Test fun newSettingsAreValidated() {
        val bad = AppSettings(
            scheduleFrom = "25:00",
            scheduleTo = "7pm",
            siteFormats = mapOf("youtube" to "720", "Bad Site" to "audio", "soundcloud" to "9999"),
            lastSeenVersion = "not a version!!",
        )
        val result = SettingsValidator.validate(bad)
        assertEquals("01:00", result.settings.scheduleFrom)
        assertEquals("07:00", result.settings.scheduleTo)
        assertEquals(mapOf("youtube" to "720"), result.settings.siteFormats)
        assertEquals("", result.settings.lastSeenVersion)
        assertEquals(setOf("scheduleFrom", "scheduleTo", "siteFormats"), result.errors.keys)
        assertTrue(SettingsValidator.validate(AppSettings(scheduleFrom = "23:59", siteFormats = mapOf("youtube-music" to "audio"), lastSeenVersion = "2.2.0")).errors.isEmpty())
    }

    @Test fun rememberedQualitiesUseTheNearestAllowedOne() {
        assertEquals("audio", FormatPicker.rememberable("audio"))
        assertEquals("best", FormatPicker.rememberable("best"))
        assertEquals("720", FormatPicker.rememberable("720"))
        assertEquals("480", FormatPicker.rememberable("360"))
        assertEquals("best", FormatPicker.rememberable("4320"))
        assertEquals("youtube-music", Platform.YOUTUBE_MUSIC.key)
    }

    // ---------- file names and arguments ----------

    @Test fun foldersByUploaderOrSite() {
        assertEquals("%(uploader,channel|Unknown).60B/%(title).120B.%(ext)s", FilenameTemplate.toYtdlp("{title}", false, true, true, "", FolderBy.UPLOADER))
        assertEquals("%(extractor_key|Other)s/%(playlist_title,playlist|Playlist).80B/%(playlist_index)03d - %(title).120B.%(ext)s", FilenameTemplate.toYtdlp("{title}", true, true, true, "", FolderBy.SITE))
        assertEquals("%(title).120B.%(ext)s", FilenameTemplate.toYtdlp("{title}", false, true, true))
        assertEquals("Rick Astley/Never Gonna Give You Up.mp3", FilenameTemplate.preview("{title}", "mp3", folderBy = FolderBy.UPLOADER).getOrThrow())
    }

    private fun args(settings: AppSettings = AppSettings(), request: DownloadRequest) =
        YtDlpArgs.download(request, settings, Platform.YOUTUBE, File("/out"), null)

    @Test fun playlistItemsAndChapterSplitting() {
        val playlist = DownloadRequest("https://youtube.com/playlist?list=PL1", "t", format = "720", playlist = true, items = listOf(1, 3, 5))
        val withItems = args(request = playlist)
        assertEquals("1,3,5", withItems[withItems.indexOf("--playlist-items") + 1])
        assertFalse("items only apply to playlists", args(request = playlist.copy(playlist = false)).contains("--playlist-items"))
        assertFalse(args(request = playlist.copy(items = null)).contains("--playlist-items"))

        val video = DownloadRequest("https://youtu.be/x", "t", format = "720")
        val split = args(AppSettings(splitChapters = true), video)
        assertTrue(split.contains("--split-chapters"))
        assertTrue(split.any { it.startsWith("chapter:") && it.contains("%(section_number)03d") })
        assertFalse("not for clips", args(AppSettings(splitChapters = true), video.copy(clip = Clip(1.0, 5.0))).contains("--split-chapters"))
        assertFalse(args(AppSettings(splitChapters = false), video).contains("--split-chapters"))
    }

    @Test fun theSearchTextIsNeverAnOption() {
        val searchArgs = YtDlpArgs.searchVideos(AppSettings(), null)
        assertTrue(searchArgs.containsAll(listOf("-J", "--flat-playlist")))
        assertTrue("the words go in separately, after --", searchArgs.none { it.startsWith("ytsearch") })
    }

    // ---------- parsing ----------

    @Test fun playlistEntriesAreListedSoYouCanPick() {
        val raw = """{"_type":"playlist","title":"Mix","entries":[{"id":"a","title":"One","duration":61},{"id":"b","title":"Two"},null]}"""
        val info = InfoParser.parse(json, raw, "https://www.youtube.com/playlist?list=PL1", AppSettings())
        assertTrue(info.isPlaylist)
        assertEquals(listOf("One", "Two", "Untitled"), info.entries.map { it.title })
        assertEquals(61L, info.entries.first().durationSeconds)
        assertTrue(InfoParser.parse(json, """{"title":"x","formats":[]}""", "https://youtu.be/x", AppSettings()).entries.isEmpty())
    }

    @Test fun searchResultsAreReadFromTheFlatList() {
        val raw = """{"entries":[
            {"id":"abc","title":"Lofi","uploader":"Girl","duration":120,"thumbnails":[{"url":"http://x/a.jpg"},{"url":"https://i.ytimg.com/b.jpg"}]},
            {"title":"no id"},
            {"id":"def","url":"https://www.youtube.com/watch?v=def","channel":"Chan"}]}"""
        val results = InfoParser.searchResults(json, raw)
        assertEquals(2, results.size)
        assertEquals("https://www.youtube.com/watch?v=abc", results[0].url)
        assertEquals("https://i.ytimg.com/b.jpg", results[0].thumbnail)
        assertEquals("Chan", results[1].uploader)
        assertEquals("Untitled", results[1].title)
    }

    // ---------- support ----------

    @Test fun theChangelogSectionOfOneVersion() {
        val md = "# Changelog\n\n## 2.2.0\n\n- New thing\n- Other thing\n\n## 2.1.1\n\n- Fix\n"
        assertEquals("- New thing\n- Other thing", Changelog.section(md, "2.2.0"))
        assertEquals("- Fix", Changelog.section(md, "2.1.1"))
        assertNull(Changelog.section(md, "9.9.9"))
    }

    @Test fun theSupportReportHasWhatIsNeededAndNothingElse() {
        val text = DebugReport.build("2.2.0", "Android 15", "2026.08.19", "https://youtu.be/x", "outdated", "yt-dlp could not read this page", "Unable to extract")
        assertTrue(text.startsWith("Yoinks 2.2.0 (Android)"))
        assertTrue(text.contains("yt-dlp: 2026.08.19"))
        assertTrue(text.contains("Link: https://youtu.be/x"))
        assertTrue(text.contains("Details: Unable to extract"))
        assertFalse(DebugReport.build("1", "d", null, null, "c", "m", "").contains("Details:"))
    }

    @Test fun healthJudgements() {
        val today = LocalDate.of(2026, 10, 3)
        assertEquals(30L, HealthRules.ytdlpAgeDays("2026.09.03", today))
        assertNull(HealthRules.ytdlpAgeDays("nightly", today))
        assertEquals(HealthStatus.FAIL, HealthRules.ytdlp(null, true).status)
        assertEquals(HealthStatus.WARN, HealthRules.ytdlp("2025.01.01", false, today).status)
        assertEquals(HealthStatus.OK, HealthRules.ytdlp("2025.01.01", true, today).status)
        assertEquals(HealthStatus.WARN, HealthRules.storage(500L * 1024 * 1024).status)
        assertEquals(HealthStatus.OK, HealthRules.storage(5L * 1024 * 1024 * 1024).status)
        assertEquals(HealthStatus.WARN, HealthRules.battery(10, false, pauseOnLow = true).status)
        assertEquals(HealthStatus.OK, HealthRules.battery(10, true, pauseOnLow = true).status)
    }

    @Test fun instagramPrivateIsRetriedLaterNotBlamedOnCookies() {
        val error = ErrorTranslator.translate("ERROR: [Instagram] x: Requested content is not available, rate-limit reached or login required.", Platform.INSTAGRAM)
        assertEquals("instagram-private", error.code)
        assertTrue(error.retryable)
        assertFalse(error.message.contains("cookies", ignoreCase = true))
    }
}
