package com.yoinks.app.domain.model

enum class JobPhase {
    QUEUED,
    WAITING_FOR_NETWORK,
    PREPARING,
    DOWNLOADING,
    PROCESSING,
    SAVING,
    PAUSED,
    FAILED,
    ;

    val isActive get() = this == PREPARING || this == DOWNLOADING || this == PROCESSING || this == SAVING
    val isPending get() = this == QUEUED || this == WAITING_FOR_NETWORK
}

/** A download in the queue. Finished jobs leave the queue and go to history. */
data class DownloadJob(
    val id: String,
    val request: DownloadRequest,
    val platform: Platform,
    val phase: JobPhase = JobPhase.QUEUED,
    val progress: EngineProgress? = null,
    val status: String? = null,
    val attempts: Int = 0,
    val error: YoinksError? = null,
    val retryAtMillis: Long = 0,
    val createdAt: Long = System.currentTimeMillis(),
) {
    val title: String get() = request.title.ifBlank { request.url }
}
