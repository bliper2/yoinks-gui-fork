package com.yoinks.app.domain.model

/** A user-facing error: plain message plus whether retrying could help. */
data class YoinksError(
    val code: String,
    val message: String,
    val retryable: Boolean,
    val detail: String = "",
)

/** Thrown inside the app with an already-translated message. */
class YoinksException(val error: YoinksError, cause: Throwable? = null) : Exception(error.message, cause)
