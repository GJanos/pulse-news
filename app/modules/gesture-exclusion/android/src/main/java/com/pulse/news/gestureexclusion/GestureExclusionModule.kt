package com.pulse.news.gestureexclusion

import android.graphics.Rect
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class GestureExclusionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GestureExclusion")

    // Apply (or clear) system-gesture-exclusion rects on the left & right edges
    // so an edge swipe is less likely to trigger the OS back gesture. The OS
    // caps the excludable height at ~200dp per edge (API 29+); we clamp to that.
    Function("setEdgeExclusion") { enabled: Boolean ->
      val activity = appContext.currentActivity ?: return@Function
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return@Function
      activity.runOnUiThread {
        val root = activity.window?.decorView?.rootView ?: return@runOnUiThread
        if (!enabled) {
          root.systemGestureExclusionRects = emptyList()
          return@runOnUiThread
        }
        val height = root.height
        val width = root.width
        if (height <= 0 || width <= 0) return@runOnUiThread
        val density = root.resources.displayMetrics.density
        val capPx = (200 * density).toInt() // OS cap per edge
        val band = minOf(height, capPx)
        val edgePx = (40 * density).toInt() // width of the excluded strip — must match EDGE_WIDTH in ArticleReader.tsx
        val top = (height - band) / 2
        root.systemGestureExclusionRects = listOf(
          Rect(0, top, edgePx, top + band),
          Rect(width - edgePx, top, width, top + band),
        )
      }
    }
  }
}
