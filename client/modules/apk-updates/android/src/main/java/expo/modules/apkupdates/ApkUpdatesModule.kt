package expo.modules.apkupdates

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

class ApkUpdatesModule : Module() {
  private val busy = AtomicBoolean(false)
  private val cancelledRequest = AtomicReference<String?>(null)
  private val activeRequest = AtomicReference<String?>(null)
  private val destroyed = AtomicBoolean(false)
  @Volatile private var connection: HttpURLConnection? = null
  private val context get() = requireNotNull(appContext.reactContext)
  private val directory get() = File(context.cacheDir, "apk-updates").apply { mkdirs() }
  private val apk get() = File(directory, "update.apk")
  private val packageFlags get() = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES

  override fun definition() = ModuleDefinition {
    Name("ApkUpdates")
    Events("downloadProgress")

    Function("getIdentity") {
      val info = context.packageManager.getPackageInfo(context.packageName, 0)
      mapOf(
        "applicationId" to context.packageName,
        "buildNumber" to versionCode(info),
        "version" to info.versionName,
        "channel" to setting("channel"),
        "snapshot" to setting("snapshot"),
        "downloadOrigins" to setting("origins").split(',').filter { it.isNotBlank() }
      )
    }

    Function("cancelDownload") { requestId: String ->
      val active = activeRequest.get()
      if (active == null || active == requestId) {
        cancelledRequest.set(requestId)
        if (active == requestId) connection?.disconnect()
      }
    }

    AsyncFunction("download") { requestId: String, url: String, size: Long, sha256: String, buildNumber: Long ->
      check(busy.compareAndSet(false, true)) { "已有下载正在进行" }
      activeRequest.set(requestId)
      try {
        check(!isCancelled(requestId)) { "下载已取消" }
        apk.delete()
        check(size in 1L..536_870_912L && sha256.matches(Regex("[a-f0-9]{64}"))) { "安装包信息无效" }
        val target = URL(url)
        val origin = "https://${target.host.lowercase()}${if (target.port != -1 && target.port != 443) ":${target.port}" else ""}"
        check(target.protocol == "https" && target.userInfo == null && target.ref == null &&
          setting("origins").split(',').map { it.trim().lowercase() }.contains(origin)) { "安装包下载来源未授权" }
        check(directory.usableSpace > size + 32L * 1024 * 1024) { "存储空间不足，请释放空间后重试" }
        val request = target.openConnection() as HttpURLConnection
        connection = request
        request.instanceFollowRedirects = false
        request.connectTimeout = 15_000
        request.readTimeout = 30_000
        request.setRequestProperty("Accept-Encoding", "identity")
        check(request.responseCode == 200) { "下载失败或地址已失效，请重新检查更新" }
        check(request.contentLengthLong == -1L || request.contentLengthLong == size) { "安装包大小不匹配" }
        val digest = MessageDigest.getInstance("SHA-256")
        var received = 0L
        var lastEvent = 0L
        request.inputStream.use { input ->
          apk.outputStream().use { output ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
              check(!isCancelled(requestId)) { "下载已取消" }
              val count = input.read(buffer)
              if (count < 0) break
              received += count
              check(received <= size) { "安装包大小不匹配" }
              output.write(buffer, 0, count)
              digest.update(buffer, 0, count)
              val now = System.currentTimeMillis()
              if (now - lastEvent >= 200 || received == size) {
                sendEvent("downloadProgress", mapOf("requestId" to requestId, "received" to received, "total" to size))
                lastEvent = now
              }
            }
          }
        }
        check(!isCancelled(requestId)) { "下载已取消" }
        check(received == size && hex(digest.digest()) == sha256) { "安装包校验失败，请重新下载" }
        verifyPackage(buildNumber)
        check(!isCancelled(requestId)) { "下载已取消" }
      } catch (error: Exception) {
        apk.delete()
        if (isCancelled(requestId)) throw IllegalStateException("下载已取消")
        throw error
      } finally {
        connection?.disconnect()
        connection = null
        activeRequest.set(null)
        busy.set(false)
      }
    }

    AsyncFunction("install") { size: Long, sha256: String, buildNumber: Long ->
      check(busy.compareAndSet(false, true)) { "安装包仍在下载" }
      try {
        check(apk.exists() && apk.length() == size) { "安装包已失效，请重新下载" }
        val digest = MessageDigest.getInstance("SHA-256")
        apk.inputStream().use { input ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            digest.update(buffer, 0, count)
          }
        }
        check(hex(digest.digest()) == sha256) { "安装包校验失败，请重新下载" }
        verifyPackage(buildNumber)
        if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
          context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          "permissionRequired"
        } else {
          val uri = FileProvider.getUriForFile(context, "${context.packageName}.apk-updates", apk)
          context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION))
          "opened"
        }
      } finally {
        busy.set(false)
      }
    }

    OnDestroy {
      destroyed.set(true)
      connection?.disconnect()
    }
  }

  private fun isCancelled(requestId: String) = destroyed.get() || cancelledRequest.get() == requestId

  private fun setting(name: String): String = context.packageManager
    .getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
    .metaData?.getString("com.dietdigidose.updates.$name") ?: ""

  private fun versionCode(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

  private fun verifyPackage(buildNumber: Long) {
    val manager = context.packageManager
    val installed = manager.getPackageInfo(context.packageName, packageFlags)
    val candidate = manager.getPackageArchiveInfo(apk.absolutePath, packageFlags or PackageManager.GET_META_DATA)
    check(candidate != null && candidate.packageName == context.packageName &&
      versionCode(candidate) == buildNumber && buildNumber > versionCode(installed)) { "安装包与当前应用或版本不匹配" }
    val channel = setting("channel")
    check(channel in listOf("preview", "candidate", "production") &&
      candidate.applicationInfo?.metaData?.getString("com.dietdigidose.updates.channel") == channel) { "安装包发行渠道不匹配" }
    val currentSigners = if (Build.VERSION.SDK_INT >= 28) installed.signingInfo?.apkContentsSigners else installed.signatures
    val candidateSigners = if (Build.VERSION.SDK_INT >= 28) {
      candidate.signingInfo?.let { if (it.hasMultipleSigners()) it.apkContentsSigners else it.signingCertificateHistory }
    } else candidate.signatures
    check(!currentSigners.isNullOrEmpty() && !candidateSigners.isNullOrEmpty() &&
      currentSigners.all { signer -> candidateSigners.any { it == signer } }) { "安装包签名不匹配，请联系发布者" }
  }
}
