package com.yoinks.app.ui.preview

import com.yoinks.app.data.history.HistoryEntity
import com.yoinks.app.domain.model.DownloadJob
import com.yoinks.app.domain.model.DownloadRequest
import com.yoinks.app.domain.model.EngineProgress
import com.yoinks.app.domain.model.FormatOption
import com.yoinks.app.domain.model.ItemProgress
import com.yoinks.app.domain.model.JobPhase
import com.yoinks.app.domain.model.MediaInfo
import com.yoinks.app.domain.model.MediaKind
import com.yoinks.app.domain.model.MusicCandidate
import com.yoinks.app.domain.model.Platform
import com.yoinks.app.domain.model.SpotifyEntity
import com.yoinks.app.domain.model.SpotifyLookup
import com.yoinks.app.domain.model.SpotifyTrack
import com.yoinks.app.domain.model.YoinksError

/** Sample data for @Preview functions only. */
object PreviewData {
    val media = MediaInfo(
        url = "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        platform = Platform.YOUTUBE,
        title = "Me at the zoo",
        uploader = "jawed",
        durationSeconds = 19,
        thumbnail = null,
        isPlaylist = false,
        playlistCount = null,
        formats = listOf(
            FormatOption(MediaKind.VIDEO, "1080p", 1080, true, "mp4", 48_200_000),
            FormatOption(MediaKind.VIDEO, "720p", 720, true, "mp4", 22_000_000),
            FormatOption(MediaKind.AUDIO, "Audio only", null, false, "mp3", 3_100_000),
        ),
        defaultIndex = 0,
    )

    private val tracks = listOf(
        SpotifyTrack("1", "Never Gonna Give You Up", listOf("Rick Astley"), 213_573, "Whenever You Need Somebody", 1),
        SpotifyTrack("2", "Whenever You Need Somebody", listOf("Rick Astley"), 233_666, "Whenever You Need Somebody", 2),
        SpotifyTrack("3", "Together Forever", listOf("Rick Astley"), 205_000, "Whenever You Need Somebody", 3),
    )

    val spotify = SpotifyLookup(
        SpotifyEntity("album", "Whenever You Need Somebody", listOf("Rick Astley"), null, "1987", tracks),
        listOf(
            listOf(MusicCandidate("https://music.youtube.com/watch?v=a", "Never Gonna Give You Up", "Rick Astley", "Whenever You Need Somebody", 214, 96)),
            listOf(MusicCandidate("https://music.youtube.com/watch?v=b", "Whenever You Need Somebody (Live)", "Rick Astley", null, 250, 52)),
            emptyList(),
        ),
    )

    val jobs = listOf(
        DownloadJob("1", DownloadRequest("https://www.tiktok.com/@a/video/1", "Beach sunset timelapse", format = "best"), Platform.TIKTOK, JobPhase.DOWNLOADING, EngineProgress(0.42f, 12, "2.1MiB/s")),
        DownloadJob("2", DownloadRequest("https://music.youtube.com/playlist?list=x", "Calm night songs", format = "audio", playlist = true), Platform.YOUTUBE_MUSIC, JobPhase.DOWNLOADING, EngineProgress(0.1f, null, "900KiB/s", item = ItemProgress(3, 20))),
        DownloadJob("3", DownloadRequest("https://www.youtube.com/watch?v=b", "A long video title that wraps onto two lines in the queue", format = "1080"), Platform.YOUTUBE, JobPhase.PAUSED),
        DownloadJob("4", DownloadRequest("https://www.instagram.com/reel/x", "Private reel", format = "best"), Platform.INSTAGRAM, JobPhase.FAILED, error = YoinksError("private", "This video is private.", false)),
    )

    val history = listOf(
        HistoryEntity(1, "Me at the zoo", "https://youtube.com/watch?v=jNQXAC9IVRw", "content://media/1", "Me at the zoo.mp4", "video/mp4", 440_000, "YOUTUBE", false, null, "Movies/Yoinks", "best", System.currentTimeMillis() - 60_000),
        HistoryEntity(2, "Never Gonna Give You Up", "https://open.spotify.com/track/x", "content://media/2", "Rick Astley - Never Gonna Give You Up.mp3", "audio/mpeg", 6_540_000, "SPOTIFY", true, null, "Music/Yoinks", "audio", System.currentTimeMillis() - 3_600_000),
    )
}
