package com.yoinks.app

import com.yoinks.app.domain.update.UpdateRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateRulesTest {
    @Test fun comparesVersions() {
        assertTrue(UpdateRules.isNewer("v2.0.1", "2.0.0"))
        assertTrue(UpdateRules.isNewer("v2.1", "2.0.9-debug"))
        assertTrue(UpdateRules.isNewer("v10.0.0", "9.9.9"))
        assertFalse(UpdateRules.isNewer("v2.0.0", "2.0.0-debug"))
        assertFalse(UpdateRules.isNewer("v1.9.9", "2.0.0"))
        assertFalse("not a version", UpdateRules.isNewer("latest", "2.0.0"))
    }

    @Test fun picksApkForThisPhone() {
        val assets = listOf(
            "Yoinks-2.1.0-x64-setup.exe",
            "Yoinks-android-2.1.0-armeabi-v7a.apk",
            "Yoinks-android-2.1.0-arm64-v8a.apk",
            "Yoinks-android-2.1.0-universal.apk",
        )
        assertEquals("Yoinks-android-2.1.0-arm64-v8a.apk", UpdateRules.pickApk(assets, listOf("arm64-v8a", "armeabi-v7a")))
        assertEquals("Yoinks-android-2.1.0-armeabi-v7a.apk", UpdateRules.pickApk(assets, listOf("armeabi-v7a")))
        assertEquals("Yoinks-android-2.1.0-universal.apk", UpdateRules.pickApk(assets, listOf("x86_64")))
        assertNull(UpdateRules.pickApk(listOf("Yoinks-2.1.0-x64-setup.exe"), listOf("arm64-v8a")))
    }
}
