package com.ellenjoe.homecentre.core.image

import android.content.Context
import coil.ImageLoader
import coil.disk.DiskCache
import coil.memory.MemoryCache
import com.ellenjoe.homecentre.core.data.HomeCentreRepository

/** Coil loader that shares the authenticated OkHttp client (Bearer header + `?token=` URLs). */
object HomeCentreImages {
    fun create(context: Context, repository: HomeCentreRepository): ImageLoader =
        ImageLoader.Builder(context)
            .okHttpClient { repository.okHttp }
            .memoryCache { MemoryCache.Builder(context).maxSizePercent(0.20).build() }
            .diskCache {
                DiskCache.Builder()
                    .directory(context.cacheDir.resolve("images"))
                    .maxSizeBytes(150L * 1024 * 1024)
                    .build()
            }
            .crossfade(true)
            .respectCacheHeaders(false)
            .build()
}
