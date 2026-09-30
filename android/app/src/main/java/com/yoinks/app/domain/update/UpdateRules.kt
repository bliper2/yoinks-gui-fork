package com.yoinks.app.domain.update

/**
 * Rules for app updates from GitHub releases. A release is tagged like
 * "v2.1.0" and carries one APK per CPU type named
 * "Yoinks-android-<version>-<abi>.apk" plus "…-universal.apk".
 */
object UpdateRules {
    /** "v2.1.0" or "2.1.0-debug" -> [2, 1, 0]; null when it is not a version. */
    fun parse(version: String): List<Int>? {
        val core = version.trim().removePrefix("v").substringBefore('-')
        val parts = core.split('.').map { it.toIntOrNull() ?: return null }
        return parts.takeIf { it.isNotEmpty() }
    }

    fun isNewer(tag: String, current: String): Boolean {
        val latest = parse(tag) ?: return false
        val installed = parse(current) ?: return false
        for (i in 0 until maxOf(latest.size, installed.size)) {
            val a = latest.getOrElse(i) { 0 }
            val b = installed.getOrElse(i) { 0 }
            if (a != b) return a > b
        }
        return false
    }

    /** The APK for this phone's CPU (in the order Android prefers), else the universal one. */
    fun pickApk(assetNames: List<String>, abis: List<String>): String? {
        val apks = assetNames.filter { it.startsWith("Yoinks-android-") && it.endsWith(".apk") }
        return abis.firstNotNullOfOrNull { abi -> apks.firstOrNull { it.endsWith("-$abi.apk") } }
            ?: apks.firstOrNull { it.endsWith("-universal.apk") }
    }
}
