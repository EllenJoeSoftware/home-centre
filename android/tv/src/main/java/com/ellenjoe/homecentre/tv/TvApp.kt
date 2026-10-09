package com.ellenjoe.homecentre.tv

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import com.ellenjoe.homecentre.core.HomeCentre

class TvApp : Application(), ImageLoaderFactory {
    override fun newImageLoader(): ImageLoader = HomeCentre.imageLoader(this)
}
