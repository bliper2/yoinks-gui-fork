package com.yoinks.app.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.core.DataStoreFactory
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import androidx.room.Room
import com.yoinks.app.data.engine.YtDlpEngine
import com.yoinks.app.data.history.HistoryDao
import com.yoinks.app.data.history.HistoryDatabase
import com.yoinks.app.data.settings.AppSettingsSerializer
import com.yoinks.app.domain.engine.MediaEngine
import com.yoinks.app.domain.model.AppSettings
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    /** Lives as long as the process: the queue and settings run here. */
    @Provides @Singleton
    fun appScope(): CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    @Provides @Singleton
    fun json(): Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        coerceInputValues = true
        isLenient = true
    }

    @Provides @Singleton
    fun okHttp(): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    @Provides @Singleton
    fun settingsStore(@ApplicationContext context: Context, json: Json, scope: CoroutineScope): DataStore<AppSettings> =
        DataStoreFactory.create(
            serializer = AppSettingsSerializer(json),
            corruptionHandler = ReplaceFileCorruptionHandler { AppSettings() },
            scope = scope,
            produceFile = { File(context.filesDir, "datastore/settings.json") },
        )

    @Provides @Singleton
    fun historyDb(@ApplicationContext context: Context): HistoryDatabase =
        Room.databaseBuilder(context, HistoryDatabase::class.java, "history.db").build()

    @Provides
    fun historyDao(db: HistoryDatabase): HistoryDao = db.history()
}

@Module
@InstallIn(SingletonComponent::class)
abstract class EngineModule {
    @Binds @Singleton
    abstract fun engine(impl: YtDlpEngine): MediaEngine
}
