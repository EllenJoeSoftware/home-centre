package com.ellenjoe.homecentre.core

import android.content.Context
import coil.ImageLoader
import com.ellenjoe.homecentre.core.data.HomeCentreRepository
import com.ellenjoe.homecentre.core.discovery.ServerDiscovery
import com.ellenjoe.homecentre.core.image.HomeCentreImages
import com.ellenjoe.homecentre.core.settings.SettingsStore

/** Minimal service locator shared by the phone and TV apps. */
object HomeCentre {
    @Volatile private var repo: HomeCentreRepository? = null
    @Volatile private var images: ImageLoader? = null
    @Volatile private var discovery: ServerDiscovery? = null

    fun repository(context: Context): HomeCentreRepository =
        repo ?: synchronized(this) {
            repo ?: HomeCentreRepository(SettingsStore(context.applicationContext)).also { repo = it }
        }

    fun imageLoader(context: Context): ImageLoader =
        images ?: synchronized(this) {
            images ?: HomeCentreImages.create(context.applicationContext, repository(context)).also { images = it }
        }

    fun discovery(context: Context): ServerDiscovery =
        discovery ?: synchronized(this) {
            discovery ?: ServerDiscovery(context.applicationContext).also { discovery = it }
        }
}
