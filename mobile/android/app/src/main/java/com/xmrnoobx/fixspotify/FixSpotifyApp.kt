package com.xmrnoobx.fixspotify

import android.app.Application
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform

/**
 * Starts the embedded CPython interpreter.
 *
 * This must happen in Application.onCreate, before any component touches
 * Python — Chaquopy's interpreter is process-wide and can only be started once.
 */
class FixSpotifyApp : Application() {
    override fun onCreate() {
        super.onCreate()
        if (!Python.isStarted()) {
            Python.start(AndroidPlatform(this))
        }
    }
}
