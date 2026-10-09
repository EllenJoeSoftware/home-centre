package com.ellenjoe.homecentre

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import com.ellenjoe.homecentre.core.HomeCentre

class HomeCentreApp : Application(), ImageLoaderFactory {
    override fun newImageLoader(): ImageLoader = HomeCentre.imageLoader(this)
}
