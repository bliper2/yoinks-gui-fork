package com.yoinks.app

import com.yoinks.app.data.engine.ProgressParser
import com.yoinks.app.data.engine.YtDlpArgs
import com.yoinks.app.data.history.HistoryEntity
import com.yoinks.app.domain.errors.ErrorTranslator
import com.yoinks.app.domain.model.AppSettings
import com.yoinks.app.domain.model.Clip
import com.yoinks.app.domain.model.DownloadRequest
import com.yoinks.app.domain.model.Platform
import com.yoinks.app.domain.model.SponsorBlock
import com.yoinks.app.domain.settings.SettingsValidator
import com.yoinks.app.ui.history.HistorySearch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** 3.0.0: SponsorBlock, the proxy and history search (same rules as the desktop app). */
class V3FeaturesTest {
    private fun download(settings: AppSettings, clip: Clip? = null) =
        YtDlpArgs.download(DownloadRequest("https://youtu.be/x", "t", format = "720", clip = clip), settings, Platform.YOUTUBE, File("/out"), null)

    @Test fun sponsorBlockRemovesTheChosenCategoriesButNeverFromClips() {
        val sponsors = download(AppSettings(sponsorBlock = SponsorBlock.SPONSOR))
        assertEquals("sponsor", sponsors[sponsors.indexOf("--sponsorblock-remove") + 1])
        val most = download(AppSettings(sponsorBlock = SponsorBlock.MOST))
        assertEquals("sponsor,selfpromo,interaction,intro,outro", most[most.indexOf("--sponsorblock-remove") + 1])
        assertFalse(download(AppSettings()).contains("--sponsorblock-remove"))
        assertFalse(download(AppSettings(sponsorBlock = SponsorBlock.MOST), Clip(1.0, 5.0)).contains("--sponsorblock-remove"))
    }

    @Test fun theProxyReachesEveryOnlineCall() {
        val settings = AppSettings(proxy = "socks5://127.0.0.1:1080")
        listOf(download(settings), YtDlpArgs.probe(false, settings, null), YtDlpArgs.searchVideos(settings, null), YtDlpArgs.searchMusic(3, settings, null)).forEach { args ->
            assertEquals("socks5://127.0.0.1:1080", args[args.indexOf("--proxy") + 1])
        }
        assertFalse(download(AppSettings()).contains("--proxy"))
    }

    @Test fun proxyIsEmptyOrSchemeHostPort() {
        listOf("", "socks5://127.0.0.1:1080", "http://proxy.example.com:8080", "socks5h://user:pa55@host:1080", " https://h:443/ ").forEach {
            assertTrue(it, SettingsValidator.validate(AppSettings(proxy = it)).errors.isEmpty())
        }
        listOf("127.0.0.1:1080", "ftp://h:21", "http://h", "http://h:80/path", "--exec=x").forEach {
            val result = SettingsValidator.validate(AppSettings(proxy = it))
            assertTrue(it, result.errors.containsKey("proxy"))
            assertEquals("", result.settings.proxy)
        }
        assertEquals("https://h:443/", SettingsValidator.validate(AppSettings(proxy = " https://h:443/ ")).settings.proxy)
    }

    @Test fun proxyFailuresAndSponsorBlockLines() {
        assertEquals("proxy", ErrorTranslator.translate("ERROR: Unable to download webpage: Unable to connect to proxy").code)
        assertTrue(ProgressParser().update(-1f, 0, "[SponsorBlock] Found 2 segments in the SponsorBlock database").processing)
    }

    @Test fun historySearchMatchesEveryWord() {
        fun entry(id: Long, title: String, platform: String = "YOUTUBE") =
            HistoryEntity(id, title, "https://x", "content://x/$id", "$title.mp4", "video/mp4", 1, platform, false, null, "Movies", "best", id)
        val items = listOf(entry(1, "Lofi beats to study"), entry(2, "Boom bap instrumental", "SOUNDCLOUD"), entry(3, "Study music"))
        assertEquals(items, HistorySearch.filter(items, "  "))
        assertEquals(listOf(1L, 3L), HistorySearch.filter(items, "study").map { it.id })
        assertEquals(listOf(1L), HistorySearch.filter(items, "STUDY lofi").map { it.id })
        assertEquals(listOf(2L), HistorySearch.filter(items, "soundcloud").map { it.id })
        assertTrue(HistorySearch.filter(items, "nothing here").isEmpty())
    }
}
