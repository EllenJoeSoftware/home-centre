package com.ellenjoe.homecentre.tv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.ellenjoe.homecentre.tv.ui.TvNavHost
import com.ellenjoe.homecentre.tv.ui.TvTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TvTheme { TvNavHost() }
        }
    }
}
