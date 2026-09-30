package com.yoinks.app.ui.share

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.yoinks.app.data.link.LinkResolver
import com.yoinks.app.data.queue.DownloadQueue
import com.yoinks.app.data.settings.SettingsRepository
import com.yoinks.app.data.spotify.SpotifyRepository
import com.yoinks.app.domain.engine.MediaEngine
import com.yoinks.app.domain.errors.ErrorTranslator
import com.yoinks.app.domain.format.FormatPicker
import com.yoinks.app.domain.link.LinkExtractor
import com.yoinks.app.domain.model.AppSettings
import com.yoinks.app.domain.model.Clip
import com.yoinks.app.domain.model.DownloadRequest
import com.yoinks.app.domain.model.FormatOption
import com.yoinks.app.domain.model.LinkRules
import com.yoinks.app.domain.model.MediaInfo
import com.yoinks.app.domain.model.Platform
import com.yoinks.app.domain.model.ShareBehavior
import com.yoinks.app.domain.model.SpotifyLookup
import com.yoinks.app.domain.model.SpotifyPick
import com.yoinks.app.domain.model.YoinksError
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** What the share bottom sheet shows. */
sealed interface SheetState {
    data object Hidden : SheetState
    data class Working(val url: String, val status: String) : SheetState
    data class Media(val info: MediaInfo) : SheetState
    data class Spotify(val url: String, val lookup: SpotifyLookup) : SheetState
    data class Failed(val url: String?, val error: YoinksError) : SheetState
}

/** One-off messages for a snackbar ("Added to the queue"). */
data class UiMessage(val id: Long, val text: String)

/**
 * The share flow: text from another app (or the Home field or clipboard)
 * -> link -> short link resolved -> platform -> lookup -> sheet.
 */
@HiltViewModel
class ShareViewModel @Inject constructor(
    private val engine: MediaEngine,
    private val resolver: LinkResolver,
    private val spotify: SpotifyRepository,
    private val queue: DownloadQueue,
    private val settingsRepo: SettingsRepository,
) : ViewModel() {
    private val _sheet = MutableStateFlow<SheetState>(SheetState.Hidden)
    val sheet: StateFlow<SheetState> = _sheet.asStateFlow()

    private val _message = MutableStateFlow<UiMessage?>(null)
    val message: StateFlow<UiMessage?> = _message.asStateFlow()

    /** A link waiting for the terms to be accepted. */
    private var pending: Pair<String, Boolean>? = null
    private var lookup: Job? = null
    private var lastClipboardLink: String? = null

    private val settings: AppSettings get() = settingsRepo.settings.value

    /** Text shared into the app, or typed/pasted on Home. */
    fun onIncoming(text: String?, fromShare: Boolean) {
        val url = LinkExtractor.first(text)
        if (url == null) {
            _sheet.value = SheetState.Failed(null, YoinksError("no-link", "No link found in what was shared. Share the post or video itself.", false))
            return
        }
        viewModelScope.launch {
            // Wait for the stored settings (a share can arrive during app start).
            val current = settingsRepo.current()
            if (current.termsAccepted < AppSettings.TERMS_VERSION) {
                pending = url to fromShare
                return@launch
            }
            start(url, instant = fromShare && current.shareBehavior == ShareBehavior.INSTANT)
        }
    }

    /** Called after the terms are accepted: continue a share that arrived first. */
    fun resumePending() {
        val (url, fromShare) = pending ?: return
        pending = null
        start(url, instant = fromShare && settings.shareBehavior == ShareBehavior.INSTANT)
    }

    /** Clipboard text seen when the app came to the front (setting, off by default). */
    fun onClipboard(text: String?): String? {
        if (!settings.clipboardDetection) return null
        val url = LinkExtractor.first(text) ?: return null
        if (url == lastClipboardLink) return null
        lastClipboardLink = url
        return url
    }

    private fun start(url: String, instant: Boolean) {
        lookup?.cancel()
        lookup = viewModelScope.launch {
            try {
                _sheet.value = SheetState.Working(url, "Opening link…")
                val real = resolver.resolve(url)
                val platform = Platform.detect(real)
                if (platform == Platform.SPOTIFY) {
                    // Always show Spotify matches first, even in instant mode.
                    _sheet.value = SheetState.Working(real, "Reading Spotify…")
                    val result = spotify.lookup(real, settings) { done, total ->
                        _sheet.value = SheetState.Working(real, if (total > 1) "Finding songs on YouTube Music ($done/$total)…" else "Finding it on YouTube Music…")
                    }
                    _sheet.value = SheetState.Spotify(real, result)
                    return@launch
                }
                if (instant) {
                    enqueueDefault(real, title = "", thumbnail = null)
                    return@launch
                }
                _sheet.value = SheetState.Working(real, "Looking up ${platform.displayName}…")
                val info = engine.probe(real, playlist = false, settings = settings)
                if (settings.alwaysUseFormat && info.formats.isNotEmpty()) {
                    val option = info.formats[FormatPicker.pick(info.formats, defaultFormatFor(info.platform)).coerceAtLeast(0)]
                    download(info, option, clip = null)
                } else {
                    _sheet.value = SheetState.Media(info)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                _sheet.value = SheetState.Failed(url, ErrorTranslator.translate(e, Platform.detect(url)))
            }
        }
    }

    fun wholePlaylist(url: String) {
        lookup?.cancel()
        lookup = viewModelScope.launch {
            try {
                _sheet.value = SheetState.Working(url, "Reading playlist…")
                _sheet.value = SheetState.Media(engine.probe(url, playlist = true, settings = settings))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                _sheet.value = SheetState.Failed(url, ErrorTranslator.translate(e, Platform.detect(url)))
            }
        }
    }

    fun retry(url: String) = start(url, instant = false)

    fun download(info: MediaInfo, option: FormatOption, clip: Clip?) {
        queue.enqueue(
            listOf(
                DownloadRequest(
                    url = info.url,
                    title = info.title,
                    thumbnail = info.thumbnail,
                    format = FormatPicker.formatOf(option),
                    exactHeight = option.exact,
                    playlist = info.isPlaylist,
                    clip = if (info.isPlaylist) null else clip,
                ),
            ),
        )
        close()
        say("Added “${info.title}” to the queue")
    }

    /** [selections]: per track, the chosen candidate index or -1 to skip. */
    fun downloadSpotify(url: String, result: SpotifyLookup, selections: List<Int>) {
        val entity = result.entity
        val picks = entity.tracks.mapIndexedNotNull { i, track ->
            val candidate = result.candidates.getOrNull(i)?.getOrNull(selections.getOrElse(i) { -1 }) ?: return@mapIndexedNotNull null
            SpotifyPick(
                track = track,
                candidateUrl = candidate.url,
                cover = if (entity.type == "playlist") null else entity.cover,
                year = if (entity.type == "playlist") null else entity.year,
                collectionTitle = if (entity.type == "track") null else entity.title,
                index = i,
                albumArtists = if (entity.type == "album") entity.artists else emptyList(),
            )
        }
        if (picks.isEmpty()) return
        queue.enqueue(listOf(DownloadRequest(url = url, title = entity.title, thumbnail = entity.cover, format = "audio", spotify = picks)))
        close()
        say("Added ${picks.size} song${if (picks.size == 1) "" else "s"} to the queue")
    }

    /** Several links at once (Home "batch", text file import). */
    fun enqueueBatch(text: String): Int {
        val urls = LinkExtractor.extractAll(text).take(500)
        if (urls.isEmpty()) {
            say("No links found. Put one link per line.")
            return 0
        }
        viewModelScope.launch {
            val requests = urls.map { raw ->
                val url = resolver.resolve(raw)
                DownloadRequest(url = url, title = "", format = defaultFormatFor(Platform.detect(url)), playlist = LinkRules.isPlaylistLink(url))
            }
            queue.enqueue(requests)
        }
        say("Added ${urls.size} link${if (urls.size == 1) "" else "s"} to the queue")
        return urls.size
    }

    private fun enqueueDefault(url: String, title: String, thumbnail: String?) {
        queue.enqueue(listOf(DownloadRequest(url = url, title = title, thumbnail = thumbnail, format = defaultFormatFor(Platform.detect(url)), playlist = LinkRules.isPlaylistLink(url))))
        close()
        say("Downloading with your default format")
    }

    private fun defaultFormatFor(platform: Platform) = if (platform.isMusic) "audio" else settings.defaultFormat.key

    fun close() {
        lookup?.cancel()
        _sheet.value = SheetState.Hidden
    }

    fun say(text: String) {
        _message.value = UiMessage(System.nanoTime(), text)
    }

    fun messageShown() {
        _message.value = null
    }
}
