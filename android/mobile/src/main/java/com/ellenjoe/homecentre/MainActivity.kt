package com.ellenjoe.homecentre

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.ellenjoe.homecentre.ui.HomeCentreNavHost
import com.ellenjoe.homecentre.ui.theme.HomeCentreTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            HomeCentreTheme {
                HomeCentreNavHost()
            }
        }
    }
}
