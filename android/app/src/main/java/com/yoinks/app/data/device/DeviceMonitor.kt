package com.yoinks.app.data.device

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.os.BatteryManager
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/** Battery level and Data Saver, read when the queue decides whether to start a download. */
@Singleton
class DeviceMonitor @Inject constructor(@ApplicationContext private val context: Context) {
    private fun battery(): Intent? = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))

    /** 0..100, or null when the phone does not say. */
    fun batteryPercent(): Int? {
        val intent = battery() ?: return null
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        return if (level >= 0 && scale > 0) level * 100 / scale else null
    }

    fun charging(): Boolean = (battery()?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0) != 0

    fun dataSaverOn(): Boolean =
        context.getSystemService(ConnectivityManager::class.java).restrictBackgroundStatus == ConnectivityManager.RESTRICT_BACKGROUND_STATUS_ENABLED
}
