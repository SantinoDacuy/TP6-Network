package com.networkdiagnostics

import android.content.Context
import android.graphics.*
import android.graphics.pdf.PdfDocument
import android.net.Uri
import org.json.JSONObject
import java.io.File

object ReportPdf {
  fun create(context: Context, report: JSONObject): String {
    val document = PdfDocument()
    var page: PdfDocument.Page? = null
    var pageNumber = 0
    var y = 0f
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    fun start() {
      page?.let { document.finishPage(it) }
      pageNumber++
      page = document.startPage(PdfDocument.PageInfo.Builder(595, 842, pageNumber).create())
      val canvas = page!!.canvas
      paint.color = Color.rgb(15, 30, 49); canvas.drawRect(0f, 0f, 595f, 90f, paint)
      paint.color = Color.WHITE; paint.textSize = 20f; paint.typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      canvas.drawText("NETWORK / FIELD REPORT", 36f, 44f, paint)
      paint.textSize = 10f; paint.typeface = Typeface.DEFAULT
      canvas.drawText("Network Diagnostics Suite · TP6 · ${report.getString("id")}", 36f, 67f, paint)
      paint.color = Color.GRAY; canvas.drawText("${report.getString("createdAt")}    |    Página $pageNumber", 36f, 817f, paint)
      y = 118f
    }
    fun line(value: String, bold: Boolean = false) {
      paint.textSize = if (bold) 13f else 10f
      paint.typeface = Typeface.create(Typeface.DEFAULT, if (bold) Typeface.BOLD else Typeface.NORMAL)
      paint.color = if (bold) Color.rgb(0, 112, 105) else Color.rgb(30, 41, 59)
      for (raw in value.split('\n')) {
        var remaining = raw.replace('\t', ' ')
        if (remaining.isEmpty()) { y += 14f; continue }
        while (remaining.isNotEmpty()) {
          if (y > 778f) start()
          val count = paint.breakText(remaining, true, 523f, null).coerceAtLeast(1)
          page!!.canvas.drawText(remaining.substring(0, count), 36f, y, paint)
          y += if (bold) 21f else 15f
          remaining = remaining.substring(count)
        }
      }
    }
    fun location(point: JSONObject): String = "GPS ${point.getDouble("latitude")}, ${point.getDouble("longitude")} | precisión ±${point.getDouble("accuracy").toInt()} m | ${point.getString("capturedAt")}" 
    try {
      start()
      line("Instalación: ${report.getString("site")}", true)
      line("Técnico: ${report.optString("technician", "Sin especificar")}")
      val device = report.getJSONObject("device")
      line("Equipo: ${device.optString("hostname", device.getString("ip"))} · ${device.getString("ip")}")
      line("MAC: ${device.optString("mac", "No disponible")} | Código: ${device.optString("barcode", "Sin código")}")
      line(location(report.getJSONObject("location")))
      y += 10f; line("Notas técnicas", true); line(report.getString("notes")); y += 10f
      line("Diagnósticos adjuntos", true)
      val diagnostics = report.getJSONArray("diagnostics")
      if (diagnostics.length() == 0) line("Sin diagnósticos guardados para este equipo.")
      for (i in 0 until diagnostics.length()) {
        val diagnostic = diagnostics.getJSONObject(i)
        line("${diagnostic.getString("protocol")} · ${diagnostic.getString("createdAt")}", true)
        line(diagnostic.getJSONObject("result").toString(2)); y += 8f
      }
      val photos = report.getJSONArray("photos")
      for (i in 0 until photos.length()) {
        start(); line("Evidencia fotográfica ${i + 1} / ${photos.length()}", true)
        val photo = photos.getJSONObject(i)
        line(location(photo.getJSONObject("location"))); y += 8f
        val file = File(Uri.parse(photo.getString("uri")).path ?: error("Foto inválida")).canonicalFile
        require(file.path.startsWith(context.filesDir.canonicalPath + File.separator))
        val image = BitmapFactory.decodeFile(file.path) ?: error("No se pudo abrir foto")
        val scale = minOf(523f / image.width, 560f / image.height)
        val width = image.width * scale; val height = image.height * scale
        page!!.canvas.drawBitmap(image, null, RectF(36f, y, 36f + width, y + height), null)
        image.recycle()
      }
      page?.let { document.finishPage(it) }; page = null
      val folder = File(context.filesDir, "reports").apply { mkdirs() }
      val file = File(folder, "${report.getString("id")}.pdf")
      file.outputStream().use { document.writeTo(it) }
      return Uri.fromFile(file).toString()
    } finally { document.close() }
  }
}
