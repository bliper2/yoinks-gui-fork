package com.yoinks.app.data.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject
import javax.inject.Singleton

data class NetworkState(val online: Boolean, val unmetered: Boolean)

/** Live connectivity, for "Wi-Fi only" and for waiting until the network is back. */
@Singleton
class NetworkMonitor @Inject constructor(@ApplicationContext context: Context, appScope: CoroutineScope) {
    private val manager = context.getSystemService(ConnectivityManager::class.java)

    private fun read(): NetworkState {
        val caps = manager.getNetworkCapabilities(manager.activeNetwork)
        return NetworkState(
            online = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true,
            unmetered = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true,
        )
    }

    val state: StateFlow<NetworkState> = callbackFlow {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { trySend(read()) }
            override fun onLost(network: Network) { trySend(read()) }
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) { trySend(read()) }
        }
        trySend(read())
        manager.registerDefaultNetworkCallback(callback)
        awaitClose { manager.unregisterNetworkCallback(callback) }
    }.distinctUntilChanged().stateIn(appScope, SharingStarted.Eagerly, read())
}
