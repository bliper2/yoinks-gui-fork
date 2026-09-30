package com.yoinks.app

import com.yoinks.app.data.cookies.CookieStore
import com.yoinks.app.data.engine.ProgressParser
import com.yoinks.app.data.engine.YtDlpArgs
import com.yoinks.app.domain.errors.ErrorTranslator
import com.yoinks.app.domain.format.FilenameTemplate
import com.yoinks.app.domain.format.FormatPicker
import com.yoinks.app.domain.match.MatchScorer
import com.yoinks.app.domain.model.AppSettings
import com.yoinks.app.domain.model.AudioFormat
import com.yoinks.app.domain.model.Clip
import com.yoinks.app.domain.model.DownloadRequest
import com.yoinks.app.domain.model.FormatOption
import com.yoinks.app.domain.model.MediaKind
import com.yoinks.app.domain.model.MusicCandidate
import com.yoinks.app.domain.model.Platform
import com.yoinks.app.domain.model.SpotifyTrack
import com.yoinks.app.domain.settings.SettingsValidator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class EngineLogicTest {
    @Test fun friendlyErrors() {
        assertEquals("private", ErrorTranslator.translate("ERROR: [youtube] x: Private video. Sign in if you have been granted access").code)
        assertEquals("age", ErrorTranslator.translate("ERROR: Sign in to confirm your age. This video may be inappropriate for some users.").code)
        val net = ErrorTranslator.translate("ERROR: Unable to download webpage: <urlopen error [Errno 7] No address associated with hostname>")
        assertEquals("network", net.code)
        assertTrue(net.retryable)
        assertEquals("No internet connection, or the connection dropped. Check your network and try again.", ErrorTranslator.translate(java.net.UnknownHostException("x")).message)
        assertEquals("snapchat-private", ErrorTranslator.translate("ERROR: Unsupported URL: https://snapchat.com/t/x", Platform.SNAPCHAT).code)
        val unknown = ErrorTranslator.translate("ERROR: [generic] something odd happened")
        assertEquals("something odd happened", unknown.message)
    }

    @Test fun filenameTemplates() {
        assertNull(FilenameTemplate.validate("{artist} - {title}"))
        assertEquals("has an unknown part {nope}", FilenameTemplate.validate("{nope}"))
        assertTrue(FilenameTemplate.validate("a/b {title}")!!.startsWith("cannot contain"))
        assertEquals("Rick Astley - Never Gonna Give You Up.mp3", FilenameTemplate.preview("{artist} - {title}", "mp3").getOrThrow())
        assertEquals(
            "%(playlist_title,playlist|Playlist).80B/%(playlist_index)03d - %(title).120B.%(ext)s",
            FilenameTemplate.toYtdlp("{title}", playlist = true, folder = true, numbered = true),
        )
    }

    @Test fun settingsValidation() {
        val bad = AppSettings(concurrency = 9, speedLimitMbps = -2f, filenameTemplate = "{x}", subsLang = "english!", ytdlpUpdateDays = 3, videoFolderUri = "/sdcard/Movies")
        val result = SettingsValidator.validate(bad)
        assertEquals(2, result.settings.concurrency)
        assertEquals(0f, result.settings.speedLimitMbps)
        assertEquals("{title}", result.settings.filenameTemplate)
        assertEquals("en", result.settings.subsLang)
        assertEquals(7, result.settings.ytdlpUpdateDays)
        assertNull(result.settings.videoFolderUri)
        assertEquals(setOf("concurrency", "speedLimitMbps", "filenameTemplate", "subsLang", "ytdlpUpdateDays", "folder"), result.errors.keys)
        assertTrue(SettingsValidator.validate(AppSettings()).errors.isEmpty())
    }

    @Test fun formatPicking() {
        val options = listOf(
            FormatOption(MediaKind.VIDEO, "1080p", 1080, true, "mp4"),
            FormatOption(MediaKind.VIDEO, "720p", 720, true, "mp4"),
            FormatOption(MediaKind.VIDEO, "360p", 360, true, "mp4"),
            FormatOption(MediaKind.AUDIO, "Audio only", null, false, "mp3"),
        )
        assertEquals(0, FormatPicker.pick(options, "best"))
        assertEquals(1, FormatPicker.pick(options, "720"))
        assertEquals(2, FormatPicker.pick(options, "480"))
        assertEquals(2, FormatPicker.pick(options, "144"))
        assertEquals(3, FormatPicker.pick(options, "audio"))
    }

    @Test fun ytdlpArguments() {
        val settings = AppSettings(audioFormat = AudioFormat.FLAC, speedLimitMbps = 2f, embedSubs = true, subsLang = "de")
        val audio = YtDlpArgs.download(DownloadRequest("https://youtu.be/x", "t", format = "audio"), settings, Platform.YOUTUBE, File("/out"), null)
        assertTrue(audio.containsAll(listOf("-x", "--audio-format", "flac", "--audio-quality", "0", "--limit-rate", "2.0M", "--no-mtime")))
        assertFalse("subs are for videos only", audio.contains("--embed-subs"))

        val video = YtDlpArgs.download(DownloadRequest("https://x", "t", format = "720", exactHeight = true, clip = Clip(5.0, 9.0)), settings, Platform.YOUTUBE, File("/out"), null)
        assertTrue(video.contains("--embed-subs"))
        assertTrue(video.containsAll(listOf("--download-sections", "*5.0-9.0")))
        assertTrue(video.last().endsWith("(clip 0m05s-0m09s).%(ext)s"))

        val tiktok = YtDlpArgs.format(DownloadRequest("https://tiktok.com/@a/video/1", "t", format = "best"), AppSettings(), Platform.TIKTOK)
        assertTrue(tiktok[1].contains("[format_note!*=watermark]"))

        assertTrue("links are never part of the argument list", video.none { it == "https://x" })
        assertEquals(emptyList<String>(), YtDlpArgs.cookies(AppSettings(useCookies = true), File("/does/not/exist")))
    }

    @Test fun progressLines() {
        val parser = ProgressParser()
        val p = parser.update(42.3f, 5, "[download]  42.3% of   10.00MiB at    1.20MiB/s ETA 00:05")
        assertEquals(0.423f, p.fraction!!, 0.001f)
        assertEquals("1.20MiB/s", p.speed)
        assertEquals(5L, p.etaSeconds)
        parser.update(42.3f, 5, "[download] Downloading item 3 of 20")
        val merging = parser.update(100f, 0, "[Merger] Merging formats into \"x.mp4\"")
        assertTrue(merging.processing)
        assertEquals(3, merging.item!!.index)
        assertNull(parser.update(-1f, -1, "[info] x").speed)
    }

    @Test fun spotifyMatchScores() {
        val track = SpotifyTrack("1", "Never Gonna Give You Up", listOf("Rick Astley"), 213_573, null, null)
        val right = MusicCandidate("u", "Never Gonna Give You Up", "Rick Astley", null, 214)
        val live = MusicCandidate("u", "Never Gonna Give You Up (Live)", "Rick Astley", null, 250)
        val other = MusicCandidate("u", "Together Forever", "Rick Astley", null, 206)
        val ranked = MatchScorer.rank(track, listOf(other, live, right))
        assertEquals("Never Gonna Give You Up", ranked.first().title)
        assertTrue(ranked.first().confidence >= 80)
        assertTrue(MatchScorer.score(track, live) < MatchScorer.score(track, right))
    }

    @Test fun cookiesFileFormat() {
        val netscape = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tHSID\tdef\n"
        assertEquals(2, CookieStore.countCookies(netscape))
        assertEquals(0, CookieStore.countCookies("{\"not\": \"cookies\"}"))
    }
}
