package com.yoinks.app.data.settings

import androidx.datastore.core.CorruptionException
import androidx.datastore.core.DataStore
import androidx.datastore.core.Serializer
import com.yoinks.app.domain.model.AppSettings
import com.yoinks.app.domain.settings.SettingsValidator
import com.yoinks.app.domain.settings.Validated
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import java.io.InputStream
import java.io.OutputStream
import javax.inject.Inject
import javax.inject.Singleton

/** Settings stored as one JSON document; repaired on read, validated on write. */
class AppSettingsSerializer(private val json: Json) : Serializer<AppSettings> {
    override val defaultValue = AppSettings()

    override suspend fun readFrom(input: InputStream): AppSettings = try {
        SettingsValidator.sanitize(json.decodeFromString(AppSettings.serializer(), input.readBytes().decodeToString()))
    } catch (e: SerializationException) {
        throw CorruptionException("Settings file is unreadable", e)
    }

    override suspend fun writeTo(t: AppSettings, output: OutputStream) {
        output.write(json.encodeToString(AppSettings.serializer(), t).encodeToByteArray())
    }
}

/** The single place settings are read and written. */
@Singleton
class SettingsRepository @Inject constructor(
    private val store: DataStore<AppSettings>,
    private val json: Json,
    appScope: CoroutineScope,
) {
    val settings: StateFlow<AppSettings> = store.data
        .map { SettingsValidator.sanitize(it) }
        .stateIn(appScope, SharingStarted.Eagerly, AppSettings())

    /** False until the stored settings have been read once (avoid flashing defaults). */
    val loaded: StateFlow<Boolean> = store.data.map { true }.stateIn(appScope, SharingStarted.Eagerly, false)

    suspend fun current(): AppSettings = store.data.first()

    /** Apply a change; invalid values keep their previous value. */
    suspend fun update(change: (AppSettings) -> AppSettings): Validated {
        var result = Validated(AppSettings(), emptyMap())
        store.updateData { previous ->
            result = SettingsValidator.validate(change(previous), previous)
            result.settings
        }
        return result
    }

    /** Back to defaults, keeping the terms acceptance and chosen folders' access. */
    suspend fun reset() {
        store.updateData { AppSettings(termsAccepted = it.termsAccepted) }
    }

    fun export(settings: AppSettings): String =
        json.encodeToString(AppSettings.serializer(), settings.copy(termsAccepted = 0, videoFolderUri = null, audioFolderUri = null))

    /** Import an exported JSON file. Terms acceptance and folders are not imported. */
    suspend fun import(text: String): Validated {
        val incoming = try {
            json.decodeFromString(AppSettings.serializer(), text)
        } catch (e: Exception) {
            return Validated(current(), mapOf("_" to "That file is not a Yoinks settings export."))
        }
        return update { previous ->
            incoming.copy(termsAccepted = previous.termsAccepted, videoFolderUri = previous.videoFolderUri, audioFolderUri = previous.audioFolderUri)
        }
    }
}
