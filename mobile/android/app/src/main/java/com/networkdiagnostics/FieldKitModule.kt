package com.networkdiagnostics

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.core.content.FileProvider
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import com.jcraft.jsch.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.*
import java.security.KeyStore
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class FieldKitModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val workers = Executors.newCachedThreadPool()
  private val main = Handler(Looper.getMainLooper())
  private val database: SQLiteDatabase by lazy {
    context.openOrCreateDatabase("fieldkit.db", Context.MODE_PRIVATE, null).apply {
      execSQL("PRAGMA journal_mode=WAL")
      execSQL("CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL)")
    }
  }
  private val dbLock = Any()
  private val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
  private val networkCallback = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: Network) { signalNetwork() }
    override fun onLost(network: Network) { signalNetwork() }
  }
  private var photoPromise: Promise? = null
  private var photoFile: File? = null
  private val activityListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != 6106) return
      val promise = photoPromise ?: return
      val file = photoFile
      photoPromise = null; photoFile = null
      if (resultCode != Activity.RESULT_OK || file == null || !file.exists()) {
        file?.delete(); promise.reject("CAMERA_CANCELLED", "Captura cancelada"); return
      }
      run(promise) {
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, options)
        var sample = 1
        while (maxOf(options.outWidth, options.outHeight) / sample > 1800) sample *= 2
        val bitmap = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: error("Foto no legible")
        val orientation = ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        val matrix = Matrix()
        when (orientation) {
          ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
          ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
          ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
          ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.preScale(-1f, 1f)
          ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.preScale(1f, -1f)
          ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.preScale(-1f, 1f) }
          ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(270f); matrix.preScale(-1f, 1f) }
        }
        val corrected = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        file.outputStream().use { corrected.compress(Bitmap.CompressFormat.JPEG, 80, it) }
        if (corrected !== bitmap) corrected.recycle()
        bitmap.recycle()
        Uri.fromFile(file).toString()
      }
    }
  }
  override fun getName() = "FieldKit"
  override fun initialize() {
    super.initialize()
    context.addActivityEventListener(activityListener)
    connectivity.registerDefaultNetworkCallback(networkCallback)
  }
  override fun invalidate() {
    try { connectivity.unregisterNetworkCallback(networkCallback) } catch (_: Exception) {}
    context.removeActivityEventListener(activityListener)
    photoPromise?.reject("CLOSED", "Actividad cerrada"); photoPromise = null
    workers.shutdownNow()
    super.invalidate()
  }
  @ReactMethod fun addListener(name: String) {}
  @ReactMethod fun removeListeners(count: Int) {}
  private fun signalNetwork() {
    if (context.hasActiveReactInstance()) context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("FieldKitNetworkChanged", null)
  }
  private fun run(promise: Promise, action: () -> Any?) {
    workers.execute { try { promise.resolve(action()) } catch (e: Exception) { promise.reject("FIELDKIT", e.message ?: "Error nativo", e) } }
  }
  private fun now() = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())
  @ReactMethod fun readState(promise: Promise) = run(promise) {
    synchronized(dbLock) { database.rawQuery("SELECT payload FROM state WHERE id=1", null).use { if (it.moveToFirst()) it.getString(0) else null } }
  }
  @ReactMethod fun commitState(payload: String, expectedRevision: Double, promise: Promise) = run(promise) {
    synchronized(dbLock) {
      val next = JSONObject(payload)
      require(next.getLong("revision") == expectedRevision.toLong() + 1) { "Revisión inválida" }
      database.beginTransaction()
      try {
        val revision = database.rawQuery("SELECT revision FROM state WHERE id=1", null).use { if (it.moveToFirst()) it.getLong(0) else 0L }
        check(revision == expectedRevision.toLong()) { "Conflicto de escritura local" }
        database.execSQL("INSERT OR REPLACE INTO state(id,revision,payload) VALUES(1,?,?)", arrayOf(next.getLong("revision"), payload))
        database.setTransactionSuccessful()
      } finally { database.endTransaction() }
    }
    true
  }
  private fun secretKey(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    return (store.getKey("fieldkit-v1", null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder("fieldkit-v1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  private val secretLock = Any()
  private fun secret(name: String): String? = synchronized(secretLock) {
    val encoded = context.getSharedPreferences("secrets", Context.MODE_PRIVATE).getString(name, null) ?: return@synchronized null
    val parts = encoded.split(":")
    Cipher.getInstance("AES/GCM/NoPadding").run {
      init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
      updateAAD(name.toByteArray(Charsets.UTF_8))
      String(doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8)
    }
  }
  @ReactMethod fun getSecret(name: String, promise: Promise) = run(promise) { secret(name) }
  @ReactMethod fun setSecret(name: String, value: String, promise: Promise) = run(promise) {
    synchronized(secretLock) {
      val preferences = context.getSharedPreferences("secrets", Context.MODE_PRIVATE)
      if (value.isEmpty()) preferences.edit().remove(name).commit()
      else {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, secretKey()); updateAAD(name.toByteArray(Charsets.UTF_8)) }
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        check(preferences.edit().putString(name, Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit())
      }
    }
    true
  }
  private fun ipv4(): Inet4Address {
    val interfaces = NetworkInterface.getNetworkInterfaces().toList().filter { it.isUp && !it.isLoopback }.sortedBy { if (it.name.startsWith("wlan") || it.name.startsWith("eth")) 0 else 1 }
    return interfaces.flatMap { it.inetAddresses.toList() }.filterIsInstance<Inet4Address>().firstOrNull { it.isSiteLocalAddress } ?: error("Conectate a una red Wi-Fi/LAN con IPv4 privada")
  }
  @ReactMethod fun networkInfo(promise: Promise) = run(promise) {
    val address = ipv4()
    JSONObject().put("ip", address.hostAddress).put("prefix", address.hostAddress!!.substringBeforeLast('.')).toString()
  }
  @ReactMethod fun scanSubnet(prefix: String, promise: Promise) = run(promise) {
    require(prefix == ipv4().hostAddress!!.substringBeforeLast('.')) { "Solo se permite el /24 local" }
    val pool = Executors.newFixedThreadPool(16)
    try {
      val tasks = (1..254).map { suffix -> pool.submit<JSONObject?> {
        val ip = "$prefix.$suffix"
        var alive = false
        for (port in intArrayOf(22, 80, 443)) {
          try { Socket().use { it.connect(InetSocketAddress(ip, port), 150) }; alive = true; break }
          catch (_: ConnectException) { alive = true; break }
          catch (_: Exception) {}
        }
        if (alive) JSONObject().put("ip", ip).put("source", "TCP").put("lastSeen", now()) else null
      } }
      val result = JSONArray()
      tasks.forEach { it.get()?.let { device -> result.put(device) } }
      result.toString()
    } finally { pool.shutdownNow() }
  }
  @Suppress("DEPRECATION")
  @ReactMethod fun discoverMdns(promise: Promise) = run(promise) {
    val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    val found = ConcurrentHashMap<String, JSONObject>()
    val active = AtomicBoolean(true)
    val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    val lock = wifi.createMulticastLock("fieldkit-mdns").apply { setReferenceCounted(false); acquire() }
    val listeners = mutableListOf<NsdManager.DiscoveryListener>()
    try {
      for (type in listOf("_ssh._tcp.", "_http._tcp.", "_workstation._tcp.", "_ipp._tcp.")) {
        val listener = object : NsdManager.DiscoveryListener {
          override fun onServiceFound(service: NsdServiceInfo) {
            if (!active.get()) return
            try { nsd.resolveService(service, object : NsdManager.ResolveListener {
              override fun onResolveFailed(info: NsdServiceInfo, error: Int) {}
              override fun onServiceResolved(info: NsdServiceInfo) {
                val address = info.host
                if (active.get() && address is Inet4Address) {
                  val ip = address.hostAddress ?: return
                  found[ip] = JSONObject().put("ip", ip).put("hostname", info.serviceName).put("source", "mDNS").put("lastSeen", now())
                }
              }
            }) } catch (_: Exception) {}
          }
          override fun onDiscoveryStarted(type: String) {}
          override fun onDiscoveryStopped(type: String) {}
          override fun onServiceLost(info: NsdServiceInfo) {}
          override fun onStartDiscoveryFailed(type: String, code: Int) { try { nsd.stopServiceDiscovery(this) } catch (_: Exception) {} }
          override fun onStopDiscoveryFailed(type: String, code: Int) {}
        }
        listeners.add(listener); nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, listener)
      }
      CountDownLatch(1).await(5, TimeUnit.SECONDS)
      JSONArray(found.values.toList()).toString()
    } finally {
      active.set(false)
      listeners.forEach { try { nsd.stopServiceDiscovery(it) } catch (_: Exception) {} }
      if (lock.isHeld) lock.release()
    }
  }
  @ReactMethod fun udpExchange(host: String, port: Int, packet: ReadableArray, timeoutMs: Int, promise: Promise) = run(promise) {
    require(port in 1..65535 && packet.size() in 1..65507)
    DatagramSocket().use { socket ->
      socket.soTimeout = timeoutMs.coerceIn(200, 10000)
      socket.connect(InetAddress.getByName(host), port)
      val data = ByteArray(packet.size()) { packet.getInt(it).toByte() }
      socket.send(DatagramPacket(data, data.size))
      val response = DatagramPacket(ByteArray(65535), 65535)
      socket.receive(response)
      Arguments.createArray().apply { for (i in 0 until response.length) pushInt(response.data[i].toInt() and 255) }
    }
  }
  private fun fingerprint(key: ByteArray) = "SHA256:" + Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(key), Base64.NO_WRAP).trimEnd('=')
  private class Pins(private val expected: String?, private val observe: (ByteArray) -> Unit) : HostKeyRepository {
    override fun check(host: String, key: ByteArray): Int { observe(key); return if (expected != null && expected == "SHA256:" + Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(key), Base64.NO_WRAP).trimEnd('=')) HostKeyRepository.OK else HostKeyRepository.CHANGED }
    override fun add(hostkey: HostKey, user: UserInfo?) {}
    override fun remove(host: String?, type: String?) {}
    override fun remove(host: String?, type: String?, key: ByteArray?) {}
    override fun getKnownHostsRepositoryID() = "FieldKit SHA256 pins"
    override fun getHostKey(): Array<HostKey> = emptyArray()
    override fun getHostKey(host: String?, type: String?): Array<HostKey> = emptyArray()
  }
  @ReactMethod fun sshFingerprint(host: String, port: Int, promise: Promise) = run(promise) {
    var observed: ByteArray? = null
    val jsch = JSch().apply { setHostKeyRepository(Pins(null) { observed = it }) }
    val session = jsch.getSession("fieldkit-probe", host, port).apply { setConfig("StrictHostKeyChecking", "yes"); timeout = 8000 }
    try { session.connect(8000) } catch (e: Exception) { if (observed == null) throw e } finally { session.disconnect() }
    fingerprint(observed ?: error("El servidor no presentó clave SSH"))
  }
  @ReactMethod fun executeSsh(host: String, port: Int, profile: String, pin: String, promise: Promise) = run(promise) {
    val commands = when (profile) {
      "linux" -> listOf("uptime", "ip -s link", "ip route")
      "routeros" -> listOf("/system resource print", "/interface print stats")
      "cisco" -> listOf("show version", "show interfaces", "show ip route")
      else -> error("Perfil SSH no permitido")
    }
    require(pin.startsWith("SHA256:")) { "Verificá la huella SSH antes de conectar" }
    val credentials = JSONObject(secret("ssh:$host:$port") ?: error("Guardá las credenciales SSH"))
    val jsch = JSch().apply { setHostKeyRepository(Pins(pin) {}) }
    val session = jsch.getSession(credentials.getString("username"), host, port)
    session.setPassword(credentials.getString("password"))
    session.setConfig("StrictHostKeyChecking", "yes")
    session.setConfig("PreferredAuthentications", "password,keyboard-interactive")
    session.timeout = 12000
    try {
      session.connect(12000)
      val result = JSONArray()
      for (command in commands) {
        val channel = session.openChannel("exec") as ChannelExec
        try {
          channel.setCommand(command); channel.setInputStream(null)
          val errors = object : ByteArrayOutputStream() {
            @Synchronized override fun write(data: ByteArray, offset: Int, length: Int) {
              val allowed = minOf(length, (65536 - size()).coerceAtLeast(0))
              if (allowed > 0) super.write(data, offset, allowed)
            }
            @Synchronized override fun write(value: Int) { if (size() < 65536) super.write(value) }
          }
          channel.setErrStream(errors)
          val input = channel.inputStream; val output = ByteArrayOutputStream()
          channel.connect(8000)
          val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15)
          val buffer = ByteArray(2048)
          while (true) {
            while (input.available() > 0) {
              check(System.nanoTime() < deadline) { "Timeout de comando SSH" }
              val read = input.read(buffer)
              if (read < 0) break
              require(output.size() + read <= 65536) { "Salida SSH supera 64 KiB" }
              output.write(buffer, 0, read)
            }
            if (channel.isClosed && input.available() == 0) break
            check(System.nanoTime() < deadline) { "Timeout de comando SSH" }
            Thread.sleep(30)
          }
          result.put(JSONObject().put("command", command).put("stdout", output.toString("UTF-8")).put("stderr", errors.toString("UTF-8").take(65536)).put("exitCode", channel.exitStatus))
        } finally { channel.disconnect() }
      }
      result.toString()
    } finally { session.disconnect() }
  }
  @Suppress("MissingPermission", "DEPRECATION")
  @ReactMethod fun getLocation(promise: Promise) {
    main.post {
      val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
      val settled = AtomicBoolean(false)
      lateinit var listener: LocationListener
      fun complete(location: Location?) {
        if (!settled.compareAndSet(false, true)) return
        manager.removeUpdates(listener)
        if (location == null) promise.reject("GPS", "Sin ubicación GPS. Activá ubicación y probá al aire libre.")
        else promise.resolve(JSONObject().put("latitude", location.latitude).put("longitude", location.longitude).put("accuracy", location.accuracy.toDouble()).put("capturedAt", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(location.time))).toString())
      }
      listener = object : LocationListener {
        override fun onLocationChanged(location: Location) { complete(location) }
        override fun onProviderEnabled(provider: String) {}
        override fun onProviderDisabled(provider: String) {}
        override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
      }
      try {
        val fine = context.checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
        val providers = (if (fine) listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER) else listOf(LocationManager.NETWORK_PROVIDER)).filter { manager.isProviderEnabled(it) }
        val recent = providers.mapNotNull { manager.getLastKnownLocation(it) }.filter { System.currentTimeMillis() - it.time in 0..120000 }.minByOrNull { it.accuracy }
        if (recent != null) complete(recent)
        else {
          check(providers.isNotEmpty()) { "Activá la ubicación del teléfono" }
          providers.forEach { manager.requestLocationUpdates(it, 1000L, 0f, listener, Looper.getMainLooper()) }
          main.postDelayed({ complete(null) }, 25000)
        }
      } catch (e: Exception) { if (settled.compareAndSet(false, true)) { try { manager.removeUpdates(listener) } catch (_: Exception) {}; promise.reject("GPS", e.message, e) } }
    }
  }
  @ReactMethod fun capturePhoto(promise: Promise) {
    main.post {
      try {
        check(photoPromise == null) { "Ya hay una captura en curso" }
        val activity = context.currentActivity ?: error("No hay actividad visible")
        val folder = File(context.filesDir, "evidence").apply { mkdirs() }
        val file = File.createTempFile("photo-", ".jpg", folder)
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply { putExtra(MediaStore.EXTRA_OUTPUT, uri); addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        photoFile = file; photoPromise = promise
        activity.startActivityForResult(intent, 6106)
      } catch (e: Exception) { photoPromise = null; photoFile?.delete(); photoFile = null; promise.reject("CAMERA", e.message, e) }
    }
  }
  @ReactMethod fun decodeBarcode(uri: String, promise: Promise) {
    try {
      val scanner = BarcodeScanning.getClient()
      scanner.process(InputImage.fromFilePath(context, Uri.parse(uri))).addOnSuccessListener { codes ->
        val code = codes.firstOrNull()?.rawValue
        if (code == null) promise.reject("BARCODE", "No se detectó un código. Acercá la cámara y repetí la foto.") else promise.resolve(code)
      }.addOnFailureListener { e -> promise.reject("BARCODE", e.message, e) }.addOnCompleteListener { scanner.close() }
    } catch (e: Exception) { promise.reject("BARCODE", e.message, e) }
  }
  private fun localFile(uri: String): File {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file") { "Solo archivos privados locales" }
    val file = File(parsed.path ?: error("URI inválida")).canonicalFile
    require(file.path.startsWith(context.filesDir.canonicalPath + File.separator)) { "Archivo fuera del almacenamiento privado" }
    return file
  }
  @ReactMethod fun fileInfo(uri: String, promise: Promise) = run(promise) {
    val file = localFile(uri)
    require(file.length() <= 20 * 1024 * 1024) { "Archivo demasiado grande" }
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input -> val buffer = ByteArray(8192); while (true) { val n = input.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) } }
    JSONObject().put("sha256", digest.digest().joinToString("") { "%02x".format(it) }).put("size", file.length()).toString()
  }
  @ReactMethod fun uploadFile(url: String, token: String, uri: String, contentType: String, sha: String, promise: Promise) = run(promise) {
    val target = URL(url)
    require(target.protocol == "https" || (target.protocol == "http" && InetAddress.getByName(target.host).let { it.isSiteLocalAddress || it.isLoopbackAddress })) { "HTTP permitido solo en LAN/laboratorio" }
    val file = localFile(uri); require(file.length() <= 20 * 1024 * 1024)
    val connection = target.openConnection() as HttpURLConnection
    try {
      connection.instanceFollowRedirects = false; connection.requestMethod = "PUT"; connection.doOutput = true
      connection.connectTimeout = 10000; connection.readTimeout = 20000
      connection.setRequestProperty("Authorization", "Bearer $token")
      connection.setRequestProperty("Content-Type", contentType)
      connection.setRequestProperty("X-Content-SHA256", sha)
      connection.setFixedLengthStreamingMode(file.length())
      connection.outputStream.use { output -> file.inputStream().use { it.copyTo(output) } }
      check(connection.responseCode == 200) { "Error de carga HTTP ${connection.responseCode}" }
      connection.inputStream.bufferedReader().use { it.readText() }
    } finally { connection.disconnect() }
  }
  @ReactMethod fun generatePdf(report: String, promise: Promise) = run(promise) { ReportPdf.create(context, JSONObject(report)) }
  @ReactMethod fun shareFile(uri: String, promise: Promise) {
    main.post {
      try {
        val file = localFile(uri)
        val shared = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val intent = Intent(Intent.ACTION_SEND).apply { type = "application/pdf"; putExtra(Intent.EXTRA_STREAM, shared); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        (context.currentActivity ?: error("No hay actividad visible")).startActivity(Intent.createChooser(intent, "Compartir reporte"))
        promise.resolve(true)
      } catch (e: Exception) { promise.reject("SHARE", e.message, e) }
    }
  }
}
