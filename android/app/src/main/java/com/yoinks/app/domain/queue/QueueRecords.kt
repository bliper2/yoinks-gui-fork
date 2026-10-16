package com.yoinks.app.domain.queue

import com.yoinks.app.domain.model.JobPhase

/**
 * How an unfinished job is written to queue.json.
 * A download that was running comes back paused. A failure stays failed.
 * A retry that is still waiting keeps its wait, so it does not start at once.
 */
object QueueRecords {
    const val FAILED = "failed"
    const val RETRY = "retry"
    const val PAUSED = "paused"

    fun storedPhase(phase: JobPhase, retryAtMillis: Long): String = when {
        phase == JobPhase.FAILED -> FAILED
        phase == JobPhase.QUEUED && retryAtMillis > 0L -> RETRY
        else -> PAUSED
    }

    fun restoredPhase(stored: String): JobPhase = when (stored) {
        FAILED -> JobPhase.FAILED
        RETRY -> JobPhase.QUEUED
        else -> JobPhase.PAUSED
    }
}
