package com.yoinks.app

import com.yoinks.app.domain.link.LinkExtractor
import com.yoinks.app.domain.model.LinkRules
import com.yoinks.app.domain.model.Platform
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LinkAndPlatformTest {
    @Test fun extractsLinkFromTikTokCaption() {
        val text = "Check out this video! #fyp #funny https://vm.tiktok.com/ZMabc123/ via @someone"
        assertEquals("https://vm.tiktok.com/ZMabc123/", LinkExtractor.first(text))
    }

    @Test fun extractsSnapchatShareWithTrailingPunctuation() {
        assertEquals("https://www.snapchat.com/t/AbCdEf", LinkExtractor.first("Look at this Spotlight: https://www.snapchat.com/t/AbCdEf."))
    }

    @Test fun addsSchemeToBareShortLinks() {
        assertEquals("https://youtu.be/dQw4w9WgXcQ", LinkExtractor.first("watch youtu.be/dQw4w9WgXcQ now"))
        assertEquals("https://vt.tiktok.com/ZS123/", LinkExtractor.first("vt.tiktok.com/ZS123/"))
    }

    @Test fun keepsBracketsThatBelongToTheUrl() {
        assertEquals("https://en.wikipedia.org/wiki/Song_(music)", LinkExtractor.first("see https://en.wikipedia.org/wiki/Song_(music)"))
    }

    @Test fun rejectsNonWebLinks() {
        assertNull(LinkExtractor.first("file:///sdcard/secret.txt"))
        assertNull(LinkExtractor.first("javascript:alert(1)"))
        assertNull(LinkExtractor.first("--exec rm -rf"))
        assertNull(LinkExtractor.normalize("https://user:pass@example.com/x"))
        assertNull(LinkExtractor.first(null))
    }

    @Test fun findsSeveralLinksOnce() {
        val text = "https://youtu.be/a\nhttps://youtu.be/b\nhttps://youtu.be/a"
        assertEquals(listOf("https://youtu.be/a", "https://youtu.be/b"), LinkExtractor.extractAll(text))
    }

    @Test fun detectsPlatforms() {
        assertEquals(Platform.TIKTOK, Platform.detect("https://vm.tiktok.com/ZM1/"))
        assertEquals(Platform.YOUTUBE_MUSIC, Platform.detect("https://music.youtube.com/watch?v=x"))
        assertEquals(Platform.YOUTUBE, Platform.detect("https://m.youtube.com/shorts/x"))
        assertEquals(Platform.SNAPCHAT, Platform.detect("https://www.snapchat.com/spotlight/x"))
        assertEquals(Platform.X, Platform.detect("https://x.com/a/status/1"))
        assertEquals(Platform.REDDIT, Platform.detect("https://v.redd.it/abc"))
        assertEquals(Platform.SPOTIFY, Platform.detect("https://open.spotify.com/track/x"))
        assertEquals(Platform.OTHER, Platform.detect("https://example.com/video"))
    }

    @Test fun linkRules() {
        assertTrue(LinkRules.isShortLink("https://vm.tiktok.com/ZM1/"))
        assertTrue(LinkRules.isShortLink("https://www.snapchat.com/t/abc"))
        assertTrue(LinkRules.isShortLink("https://www.reddit.com/r/videos/s/abc"))
        assertFalse(LinkRules.isShortLink("https://www.tiktok.com/@a/video/1"))
        assertTrue(LinkRules.isPlaylistLink("https://www.youtube.com/playlist?list=PL1"))
        assertTrue(LinkRules.hasPlaylistParam("https://www.youtube.com/watch?v=a&list=PL1"))
        assertFalse(LinkRules.isPlaylistLink("https://www.youtube.com/watch?v=a"))
        assertTrue(LinkRules.isSnapchatPublic("https://www.snapchat.com/spotlight/abc"))
        assertFalse(LinkRules.isSnapchatPublic("https://www.snapchat.com/t/abc"))
        assertTrue(LinkRules.isTikTokSlideshow("https://www.tiktok.com/@a/photo/123"))
    }
}
